import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageHandler } from '../supabase/functions/image-storage/index.ts';

const config = {
    supabaseUrl: 'https://storage.example.test', serviceRoleKey: 'server-only-test-key',
    firebaseProjectId: 'capstone-reporting-system', firebaseApiKey: 'public-test-key',
};
const png = new Uint8Array([137,80,78,71,13,10,26,10,0]);
const identity = { users: [{ localId: 'admin-uid', providerUserInfo: [{ providerId: 'password' }] }] };
const admin = { fields: { role: { stringValue: 'Admin' } } };
function setup({ identityStatus = 200, identityBody = identity, profileStatus = 200, profileBody = admin, storageStatus = 200, networkFailure = false } = {}) {
    const calls = [];
    const handler = createImageHandler(config, async (url, options) => {
        calls.push({ url, ...options });
        if (networkFailure) throw Error('network failure with sensitive info');
        if (url.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json(identityBody, { status: identityStatus });
        if (url.startsWith('https://firestore.googleapis.com/')) return Response.json(profileBody, { status: profileStatus });
        return Response.json({ message: 'sensitive upstream details' }, { status: storageStatus });
    });
    return { handler, calls, storageCalls: () => calls.filter(call => call.url.startsWith(config.supabaseUrl)) };
}
function request({ method = 'POST', token = 'firebase-token', id = 'announcement123', type = 'image/png', body = png, extra = '' } = {}) {
    return new Request(`https://function.example.test/image-storage?id=${encodeURIComponent(id)}${extra}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type },
        body: method === 'POST' ? body : undefined,
    });
}
test('valid upload verifies Firebase and current admin before bounded Storage operation', async () => {
    const { handler, calls, storageCalls } = setup();
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[0].body), { idToken: 'firebase-token' });
    assert.match(calls[1].url, /\/admins\/admin-uid$/);
    assert.equal(calls[1].headers.Authorization, 'Bearer firebase-token');
    assert.equal(storageCalls()[0].url, `${config.supabaseUrl}/storage/v1/object/announcement-images/announcement123/image`);
    assert.equal(storageCalls()[0].headers['x-upsert'], 'false');
    assert.equal(storageCalls()[0].headers.Authorization, `Bearer ${config.serviceRoleKey}`);
    assert.equal((await response.text()).includes(config.serviceRoleKey), false);
});
test('missing sign-in is denied before contacting services', async () => {
    const { handler, calls } = setup();
    assert.equal((await handler(request({ token: '' }))).status, 401);
    assert.equal(calls.length, 0);
});
for (const status of [400, 401, 403]) {
    test(`Firebase token rejection ${status} cannot access Storage`, async () => {
        const { handler, storageCalls } = setup({ identityStatus: status });
        assert.equal((await handler(request())).status, 401);
        assert.equal(storageCalls().length, 0);
    });
}
for (const [name, identityBody] of [
    ['disabled account', { users: [{ ...identity.users[0], disabled: true }] }],
    ['anonymous account', { users: [{ localId: 'anon' }] }],
    ['empty identity response', {}],
]) {
    test(`${name} is denied`, async () => {
        const { handler, storageCalls } = setup({ identityBody });
        assert.equal((await handler(request())).status, 403);
        assert.equal(storageCalls().length, 0);
    });
}
for (const status of [403, 404, 503]) {
    test(`admin lookup ${status} fails closed`, async () => {
        const { handler, storageCalls } = setup({ profileStatus: status });
        assert.equal((await handler(request())).status, status === 503 ? 503 : 403);
        assert.equal(storageCalls().length, 0);
    });
}
test('resident role is denied even with a valid Firebase token', async () => {
    const { handler, storageCalls } = setup({ profileBody: { fields: { role: { stringValue: 'Resident' } } } });
    assert.equal((await handler(request())).status, 403);
    assert.equal(storageCalls().length, 0);
});
test('removing admin profile affects the next request (no cached admin grant)', async () => {
    let count = 0;
    const handler = createImageHandler(config, async url => {
        if (url.includes('identitytoolkit')) return Response.json(identity);
        if (url.includes('firestore.googleapis')) return Response.json(++count === 1 ? admin : {}, { status: count === 1 ? 200 : 404 });
        return Response.json({});
    });
    assert.equal((await handler(request())).status, 200);
    assert.equal((await handler(request({ method: 'DELETE' }))).status, 403);
});
for (const options of [{ id: '../report-images/private' }, { extra: '&bucket=report-images' }, { id: '' }]) {
    test(`reject arbitrary paths/buckets: ${JSON.stringify(options)}`, async () => {
        const { handler, calls } = setup();
        assert.equal((await handler(request(options))).status, 400);
        assert.equal(calls.length, 0);
    });
}
for (const options of [
    { type: 'image/svg+xml' }, { body: new Uint8Array() },
    { body: new TextEncoder().encode('<script>not an image</script>') },
]) {
    test(`invalid image ${JSON.stringify(options)} never uploads`, async () => {
        const { handler, storageCalls } = setup();
        assert.equal((await handler(request(options))).status, 400);
        assert.equal(storageCalls().length, 0);
    });
}
test('oversized body is rejected even without Content-Length', async () => {
    const { handler, storageCalls } = setup();
    assert.equal((await handler(request({ body: new Uint8Array(5 * 1024 * 1024 + 1) }))).status, 413);
    assert.equal(storageCalls().length, 0);
});
test('deletion only targets the selected announcement image', async () => {
    const { handler, storageCalls } = setup();
    assert.equal((await handler(request({ method: 'DELETE' }))).status, 200);
    assert.deepEqual(JSON.parse(storageCalls()[0].body), { prefixes: ['announcement123/image'] });
});
test('upstream failures return safe errors and no success', async () => {
    const { handler } = setup({ storageStatus: 500 });
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /sensitive upstream/);
});
test('network failures fail closed without exposing upstream details', async () => {
    const { handler, storageCalls } = setup({ networkFailure: true });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /sensitive/);
    assert.equal(storageCalls().length, 0);
});
test('CORS preflight does not need credentials or mutate data', async () => {
    const { handler, calls } = setup();
    const response = await handler(request({ method: 'OPTIONS', token: '' }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(calls.length, 0);
});
test('server without its secret fails closed', async () => {
    const handler = createImageHandler({ ...config, serviceRoleKey: '' }, () => { throw Error('Must not call'); });
    assert.equal((await handler(request())).status, 503);
});

test('disabled admin profile cannot upload or delete announcement images', async () => {
    const { handler, storageCalls } = setup({ profileBody: { fields: { role: { stringValue: 'Admin' }, active: { booleanValue: false } } } });
    assert.equal((await handler(request())).status, 403);
    assert.equal((await handler(request({ method: 'DELETE' }))).status, 403);
    assert.equal(storageCalls().length, 0);
});
