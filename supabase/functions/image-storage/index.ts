// Firebase verifies the ID token remotely; its Firestore rules then enforce the
// profile read. No decoded-but-unverified JWT, custom claims, or Firebase admin key.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
};
class RequestError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function reply(status, data) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function readImage(request) {
    const contentType = request.headers.get('content-type')?.toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) throw new RequestError(400, 'Choose a JPEG, PNG, or WebP image.');
    if (Number(request.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new RequestError(413, 'Image must be at most 5 MB.');
    if (!request.body) throw new RequestError(400, 'Choose an image.');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new RequestError(413, 'Image must be at most 5 MB.');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const matches = contentType === 'image/jpeg'
        ? size >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : contentType === 'image/png'
            ? size >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
            : size >= 12 && [82, 73, 70, 70].every((byte, i) => bytes[i] === byte)
                && [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte);
    if (!matches) throw new RequestError(400, 'The file does not match its image type.');
    return { bytes, contentType };
}
export function createImageHandler(config, fetcher = fetch) {
    async function remote(url, options) {
        try { return await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }
        catch { throw new RequestError(503, 'An image service could not be reached. Please retry.'); }
    }
    async function requireUser(token) {
        const identity = await remote(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.firebaseApiKey)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
        });
        if (!identity.ok) {
            if (identity.status >= 500 || identity.status === 429) throw new RequestError(503, 'Sign-in verification is temporarily unavailable.');
            throw new RequestError(401, 'Your sign-in could not be verified. Please sign in again.');
        }
        const user = (await identity.json()).users?.[0];
        if (!user?.localId || user.disabled || !user.providerUserInfo?.some(provider => provider.providerId === 'password')) {
            throw new RequestError(403, 'An enabled email/password account is required.');
        }
        return user;
    }
    async function requireAdmin(token) {
        const user = await requireUser(token);
        const profile = await remote(`https://firestore.googleapis.com/v1/projects/${config.firebaseProjectId}/databases/(default)/documents/admins/${encodeURIComponent(user.localId)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (profile.status === 401) throw new RequestError(401, 'Your sign-in could not be verified.');
        if (profile.status === 403 || profile.status === 404) throw new RequestError(403, 'Admin access is required to manage announcement images.');
        if (!profile.ok) throw new RequestError(503, 'Admin access could not be checked. Please retry.');
        const data = (await profile.json()).fields;
        if (data?.role?.stringValue !== 'Admin' || data?.active?.booleanValue === false) throw new RequestError(403, 'Admin access is required to manage announcement images.');
    }
    async function reportImage(request, token, id) {
        if (!['GET', 'POST'].includes(request.method)) throw new RequestError(405, 'Report photos cannot be deleted or replaced.');
        const user = await requireUser(token);
        // Firebase applies the live report owner/admin read rule to this request.
        const base = `https://firestore.googleapis.com/v1/projects/${config.firebaseProjectId}/databases/(default)/documents`;
        const report = await remote(`${base}/reports/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (report.status === 401 || report.status === 403 || report.status === 404) throw new RequestError(403, 'Report photo access was denied.');
        if (!report.ok) throw new RequestError(503, 'Report access could not be checked. Please retry.');
        const fields = (await report.json()).fields;
        const owner = fields?.submitterID?.stringValue;
        if (!owner || !ID_PATTERN.test(owner)) throw new RequestError(403, 'Invalid report owner.');
        const path = `${owner}/${id}/image`;
        if (fields?.supportingImageURL?.stringValue !== path) throw new RequestError(404, 'This report has no photo attachment.');
        const headers = { Authorization: `Bearer ${config.serviceRoleKey}`, apikey: config.serviceRoleKey };
        if (request.method === 'POST') {
            if (owner !== user.localId) throw new RequestError(403, 'Only the report owner can upload its photo.');
            const profile = await remote(`${base}/residents/${encodeURIComponent(user.localId)}`, { headers: { Authorization: `Bearer ${token}` } });
            if (profile.status === 401 || profile.status === 403 || profile.status === 404) throw new RequestError(403, 'A resident account is required.');
            if (!profile.ok) throw new RequestError(503, 'Resident access could not be checked.');
            if ((await profile.json()).fields?.role?.stringValue !== 'Resident') throw new RequestError(403, 'A resident account is required.');
            const { bytes, contentType } = await readImage(request);
            const result = await remote(`${config.supabaseUrl}/storage/v1/object/report-images/${path}`, {
                method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes,
            });
            if (!result.ok) throw new RequestError(502, 'Photo upload was not confirmed. Reload the photo before retrying; existing photos cannot be replaced.');
            return reply(200, { ok: true });
        }
        const result = await remote(`${config.supabaseUrl}/storage/v1/object/authenticated/report-images/${path}`, { headers });
        // Supabase may return 400 for a missing object, so classify its error code too.
        if (!result.ok) {
            const body = await result.json().catch(() => ({}));
            if (result.status === 404 || body.code === 'NoSuchKey' || body.error === 'not_found') {
                throw new RequestError(404, 'The report photo has not uploaded yet.');
            }
            throw new RequestError(503, 'The report photo could not load. Please retry.');
        }
        const { bytes, contentType } = await readImage(result);
        return new Response(bytes, { headers: { ...CORS, 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' } });
    }
    return async request => {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        try {
            if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new RequestError(405, 'Method not allowed.');
            if (!config.supabaseUrl || !config.serviceRoleKey || !config.firebaseApiKey || !config.firebaseProjectId) {
                throw new RequestError(503, 'Image storage server configuration is incomplete.');
            }
            const url = new URL(request.url);
            const id = url.searchParams.get('id');
            const kind = url.searchParams.get('kind');
            // Only the explicit report route is added; arbitrary bucket/path selection is forbidden.
            if (!id || !ID_PATTERN.test(id) || (kind !== null && kind !== 'report')
                || url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('kind').length > 1
                || [...url.searchParams.keys()].some(key => !['id', 'kind'].includes(key))) throw new RequestError(400, 'Invalid image request.');
            const match = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '');
            if (!match || match[1].length > 16384) throw new RequestError(401, 'A Firebase sign-in is required.');
            if (kind === 'report') return await reportImage(request, match[1], id);
            if (request.method === 'GET') throw new RequestError(405, 'Method not allowed.');
            await requireAdmin(match[1]);
            const headers = { Authorization: `Bearer ${config.serviceRoleKey}`, apikey: config.serviceRoleKey };
            const path = `${id}/image`;
            let result;
            if (request.method === 'POST') {
                const { bytes, contentType } = await readImage(request);
                result = await remote(`${config.supabaseUrl}/storage/v1/object/announcement-images/${path}`, {
                    method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'false' }, body: bytes,
                });
            } else {
                result = await remote(`${config.supabaseUrl}/storage/v1/object/announcement-images`, {
                    method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }),
                });
            }
            if (!result.ok) throw new RequestError(502, 'Image storage could not complete the operation. Check bucket setup and retry.');
            return reply(200, { ok: true });
        } catch (error) {
            // Never return or log bearer tokens, upstream response bodies or keys.
            return reply(error instanceof RequestError ? error.status : 503, {
                error: error instanceof RequestError ? error.message : 'Image storage is temporarily unavailable. Please retry.',
            });
        }
    };
}

// Supabase provides these server-only environment variables automatically.
if (typeof Deno !== 'undefined') {
    Deno.serve(createImageHandler({
        supabaseUrl: Deno.env.get('SUPABASE_URL'),
        serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
        firebaseProjectId: 'capstone-reporting-system',
        firebaseApiKey: 'AIzaSyBHsFoXKJLb9bBU4PDvSGrDWA29cnrvdcw',
    }));
}
