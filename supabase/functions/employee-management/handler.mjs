// Narrow server API. Never return credentials, password links, or upstream errors.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
};
export class RequestError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const activeAdmin = data => data?.role === 'Admin' && data.active !== false;
const manager = data => activeAdmin(data) && data.canManageEmployees === true;
function requireManager(data) {
    if (!manager(data)) throw new RequestError(403, 'Only the main admin can manage employee accounts.');
}
function employee(data, target, caller) {
    if (!data || data.role !== 'Admin') throw new RequestError(404, 'Employee account not found.');
    if (target === caller || data.canManageEmployees === true) throw new RequestError(403, 'Main-admin accounts cannot be changed here.');
}
function fields(body, allowed) {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestError(400, 'Unsupported account fields.');
}
function text(value, limit) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new RequestError(400, 'Check the employee details.');
    return value.trim();
}
async function readBody(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(400, 'JSON is required.');
    const reader = request.body?.getReader();
    if (!reader) throw new RequestError(400, 'Missing request.');
    let size = 0; const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); throw new RequestError(413, 'Request is too large.'); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try {
        const body = JSON.parse(new TextDecoder().decode(bytes));
        if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
        return body;
    } catch { throw new RequestError(400, 'Invalid request.'); }
}
export function createEmployeeHandler({ auth, db, timestamp, documentId, sendSetupEmail }) {
    const profiles = () => db.collection('admins');
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    async function authorize(token) {
        let identity;
        try { identity = await auth.verifyIdToken(token, true); }
        catch { throw new RequestError(401, 'Sign in again to manage employee accounts.'); }
        if (identity.firebase?.sign_in_provider !== 'password') throw new RequestError(403, 'An email/password main-admin account is required.');
        requireManager((await profiles().doc(identity.uid).get()).data());
        return identity;
    }
    async function send(email) {
        try { await sendSetupEmail(email); return true; } catch { return false; }
    }
    return async request => {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        try {
            if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed.');
            const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
            if (!token || token.length > 16384) throw new RequestError(401, 'Sign in with a main-admin account.');
            const identity = await authorize(token);
            const uid = identity.uid;
            const body = await readBody(request);
            if (body.action === 'list') {
                fields(body, ['action', 'cursor']);
                if (body.cursor !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(body.cursor)) throw new RequestError(400, 'Invalid page.');
                let query = profiles().orderBy(documentId()).limit(51);
                if (body.cursor) query = query.startAfter(body.cursor);
                const snapshot = await query.get();
                // Recheck after the query before returning personal data.
                requireManager((await profiles().doc(uid).get()).data());
                const rows = snapshot.docs.slice(0, 50).map(item => {
                    const data = item.data();
                    return { uid: item.id, fullName: data.fullName || '', emailAddress: data.emailAddress || '', officeName: data.officeName || '',
                        active: data.active !== false, mainAdmin: data.canManageEmployees === true };
                });
                return respond(200, { employees: rows, cursor: snapshot.docs.length > 50 ? rows.at(-1).uid : null });
            }
            if (body.action === 'create') {
                fields(body, ['action', 'fullName', 'emailAddress', 'officeName']);
                const fullName = text(body.fullName, 200), officeName = text(body.officeName, 200);
                const emailAddress = text(body.emailAddress, 254).toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new RequestError(400, 'Enter a valid work email.');
                let user;
                try {
                    user = await auth.createUser({ email: emailAddress, displayName: fullName,
                        password: crypto.randomUUID() + crypto.randomUUID(), emailVerified: false });
                } catch (error) {
                    if (error.code === 'auth/email-already-exists') throw new RequestError(409, 'This email already has an account. It was not changed or granted admin access. Use a separate work email.');
                    throw error;
                }
                const target = profiles().doc(user.uid);
                try {
                    await db.runTransaction(async tx => {
                        requireManager((await tx.get(profiles().doc(uid))).data());
                        if ((await tx.get(target)).exists) throw new RequestError(409, 'An account profile already exists.');
                        tx.create(target, { fullName, emailAddress, officeName, role: 'Admin', active: true,
                            canManageEmployees: false, createdBy: uid, dateCreated: timestamp(), updatedBy: uid, updatedAt: timestamp() });
                    });
                } catch (error) {
                    // A timeout can mean the transaction committed. Never blindly delete that user.
                    let saved;
                    try { saved = await target.get(); }
                    catch { throw new RequestError(503, 'Account setup could not be confirmed. Refresh the list before retrying; contact the project administrator if it is missing.'); }
                    if (!saved.exists) {
                        try { await auth.deleteUser(user.uid); }
                        catch { throw new RequestError(503, 'Account setup is incomplete. Ask the project administrator to check Firebase Authentication before retrying.'); }
                        throw error;
                    }
                    throw new RequestError(503, 'Account may already be created. Refresh the list and use Send setup email instead of creating it again.');
                }
                const emailSent = await send(emailAddress);
                return respond(200, { ok: true, emailSent, message: emailSent
                    ? 'Employee created. A password setup email was sent.'
                    : 'Employee created, but the setup email could not be sent. Use Send setup email to retry.' });
            }
            if (body.action === 'edit' || body.action === 'transfer') {
                fields(body, body.action === 'edit'
                    ? ['action', 'uid', 'fullName', 'officeName', 'expectedFullName', 'expectedOfficeName']
                    : ['action', 'uid', 'confirmation']);
                if (typeof body.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.uid)) throw new RequestError(400, 'Invalid employee.');
                const target = profiles().doc(body.uid);
                if (body.action === 'edit') {
                    const fullName = text(body.fullName, 200), officeName = text(body.officeName, 200);
                    if (['expectedFullName', 'expectedOfficeName'].some(key => typeof body[key] !== 'string' || body[key].length > 200)) throw new RequestError(400, 'Reload the employee details before editing.');
                    await db.runTransaction(async tx => {
                        requireManager((await tx.get(profiles().doc(uid))).data());
                        const data = (await tx.get(target)).data();
                        employee(data, body.uid, uid);
                        if ((data.fullName || '') !== body.expectedFullName || (data.officeName || '') !== body.expectedOfficeName) throw new RequestError(409, 'Employee details changed. Close this form, refresh the list, and reopen it.');
                        tx.update(target, { fullName, officeName, updatedBy: uid, updatedAt: timestamp() });
                    });
                    return respond(200, { ok: true, message: 'Employee details updated.' });
                }
                const recentSignIn = () => {
                    const age = Date.now() / 1000 - identity.auth_time;
                    if (!Number.isFinite(identity.auth_time) || age < -30 || age > 300) throw new RequestError(401, 'Confirm your password again before transferring main-admin access.');
                };
                recentSignIn();
                if (body.confirmation !== 'TRANSFER') throw new RequestError(400, 'Type TRANSFER to confirm the handover.');
                // Check the destination before any role write. Auth and Firestore are separate
                // services; console deletion/disable during this operation is outside this flow.
                let recipient;
                try { recipient = await auth.getUser(body.uid); }
                catch (error) {
                    if (error.code === 'auth/user-not-found') throw new RequestError(404, 'The employee sign-in account no longer exists.');
                    throw error;
                }
                if (recipient.disabled || !recipient.metadata?.lastSignInTime || !recipient.providerData?.some(provider => provider.providerId === 'password')) {
                    throw new RequestError(409, 'Choose an enabled employee who has already signed in with their password.');
                }
                await db.runTransaction(async tx => {
                    recentSignIn();
                    const caller = profiles().doc(uid);
                    requireManager((await tx.get(caller)).data());
                    const data = (await tx.get(target)).data();
                    employee(data, body.uid, uid);
                    if (!activeAdmin(data)) throw new RequestError(409, 'Re-enable this employee before transferring access.');
                    if (!recipient.email || recipient.email.toLowerCase() !== data.emailAddress?.toLowerCase()) throw new RequestError(409, 'The employee email does not match their sign-in account. Contact the project administrator.');
                    // Both writes commit together or neither does; concurrent handovers conflict.
                    tx.update(target, { canManageEmployees: true, updatedBy: uid, updatedAt: timestamp() });
                    tx.update(caller, { canManageEmployees: false, updatedBy: uid, updatedAt: timestamp() });
                });
                return respond(200, { ok: true, message: 'Main-admin access transferred. Your account is now an ordinary admin.' });
            }
            if (body.action === 'set-active' || body.action === 'send-setup') {
                fields(body, body.action === 'set-active' ? ['action', 'uid', 'active'] : ['action', 'uid']);
                if (typeof body.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.uid)) throw new RequestError(400, 'Invalid employee.');
                if (body.action === 'set-active' && typeof body.active !== 'boolean') throw new RequestError(400, 'Choose an account status.');
                const target = profiles().doc(body.uid);
                const email = await db.runTransaction(async tx => {
                    requireManager((await tx.get(profiles().doc(uid))).data());
                    const data = (await tx.get(target)).data();
                    employee(data, body.uid, uid);
                    if (body.action === 'set-active') {
                        tx.update(target, { active: body.active, updatedBy: uid, updatedAt: timestamp() });
                    } else {
                        if (!activeAdmin(data)) throw new RequestError(403, 'Re-enable this employee before sending a setup email.');
                        if (data.lastSetupEmailAt?.toMillis() > Date.now() - 60000) throw new RequestError(429, 'Wait a minute before sending another setup email.');
                        tx.update(target, { lastSetupEmailAt: timestamp() });
                    }
                    return data.emailAddress;
                });
                if (body.action === 'send-setup') {
                    const emailSent = await send(email);
                    return respond(200, { ok: true, emailSent, message: emailSent ? 'Password setup email sent.' : 'Email could not be sent. Wait a minute and retry.' });
                }
                return respond(200, { ok: true, message: body.active ? 'Employee admin access enabled.' : 'Employee admin access disabled.' });
            }
            throw new RequestError(400, 'Unknown action.');
        } catch (error) {
            return respond(error instanceof RequestError ? error.status : 503, { error: error instanceof RequestError ? error.message : 'Employee service unavailable. Refresh the list before retrying.' });
        }
    };
}
