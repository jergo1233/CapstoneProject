import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setOfflineOwner, readOffline, saveOffline, clearOfflinePrivate, removeOffline } from '../firebase/offline-cache.mjs';
import { sortReports } from '../firebase/report-model.mjs';
function storage() {
    const values = new Map();
    globalThis.sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    clearOfflinePrivate();
}
test('snapshots survive same-account restoration, preserve dates, and clear on logout/account change', () => {
    storage(); setOfflineOwner('a');
    saveOffline('a', 'reports', [{ id: 'one', timestamp: { toMillis: () => 1234 } }]);
    setOfflineOwner('a');
    assert.equal(readOffline('a', 'reports')[0].timestamp.toDate().getTime(), 1234);
    assert.equal(readOffline('b', 'reports'), null);
    setOfflineOwner('b');
    assert.equal(saveOffline('a', 'profile', { fullName: 'Late response' }), false);
    assert.equal(readOffline('b', 'reports'), null);
    setOfflineOwner('a'); assert.equal(readOffline('a', 'reports'), null);
    saveOffline('a', 'profile', { fullName: 'Test' });
    removeOffline('a', 'profile'); assert.equal(readOffline('a', 'profile'), null);
    saveOffline('a', 'profile', {}); clearOfflinePrivate(); setOfflineOwner('a');
    assert.equal(readOffline('a', 'profile'), null);
});
test('disabled or full storage never breaks online data operations', () => {
    globalThis.sessionStorage = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
    setOfflineOwner('a'); assert.equal(saveOffline('a', 'reports', []), false); assert.equal(readOffline('a', 'reports'), null);
});
test('report listener retains saved reports over empty memory cache, replaces on server confirmation, purges on denial', async () => {
    storage(); setOfflineOwner('a'); saveOffline('a', 'reports', [{ id: 'saved', submitterID: 'a' }]);
    let next, error;
    const auth = { currentUser: { uid: 'a' } };
    const deps = { readOffline, saveOffline, removeOffline, sortReports, getServices: async () => ({ auth, db: {} }),
        onAuthStateChanged: (_, fn) => { fn(auth.currentUser); return () => {}; },
        collection: () => ({}), query: () => ({}), where: () => ({}),
        onSnapshot: (_, options, cb, fail) => { next = cb; error = fail; return () => {}; } };
    const source = (await readFile(new URL('../firebase/reports.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/export /g, '');
    const watch = new Function(...Object.keys(deps), source + ';return watchOwnReports;')(...Object.values(deps));
    const results = []; await watch((rows, meta) => results.push({ rows, meta }), () => {});
    assert.equal(results.at(-1).rows[0].id, 'saved');
    next({ docs: [], metadata: { fromCache: true } });
    assert.equal(results.at(-1).rows[0].id, 'saved');
    next({ docs: [], metadata: { fromCache: false, hasPendingWrites: false } });
    assert.deepEqual(readOffline('a', 'reports'), []);
    error({ code: 'permission-denied' }); assert.equal(readOffline('a', 'reports'), null);
});
async function workerHarness() {
    const listeners = {}, entries = new Map();
    const cache = { addAll: async requests => { for (const r of requests) entries.set(r.url, new Response('cached')); },
        match: async r => entries.get(typeof r === 'string' ? r : r.url)?.clone(), put: async (r, response) => entries.set(r.url, response),
        keys: async () => [...entries.keys()].map(url => new Request(url)), delete: async r => entries.delete(r.url) };
    const deleted = [];
    const context = vm.createContext({ self: { registration: { scope: 'https://example.test/project/interface/' }, location: { href: 'https://example.test/project/interface/sw.js' },
        addEventListener: (name, fn) => listeners[name] = fn, skipWaiting: async () => {}, clients: { claim: async () => {} } },
        caches: { open: async () => cache, keys: async () => ['unrelated-app', 'muni-app-v2'], delete: async key => deleted.push(key) },
        URL, Request, Response, Set, AbortController, AbortSignal, setTimeout, clearTimeout, fetch: async () => { throw Error('offline'); } });
    await vm.runInContext(await readFile(new URL('../interface/sw.js', import.meta.url), 'utf8'), context);
    return { listeners, entries, deleted };
}
test('worker preloads shell/SDK; bypasses private APIs, auth, map tiles and other origins; preserves unrelated caches', async () => {
    const h = await workerHarness(); let pending;
    h.listeners.install({ waitUntil: promise => pending = promise }); await pending;
    assert.ok(h.entries.has('https://example.test/project/interface/home.html'));
    assert.ok(h.entries.has('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'));
    for (const url of ['https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', 'https://identitytoolkit.googleapis.com/v1/accounts:lookup',
        'https://lpcmwrdizcistkxylsps.supabase.co/functions/v1/image-storage?kind=report&id=x', 'https://tile.openstreetmap.org/1/2/3.png',
        'https://lpcmwrdizcistkxylsps.supabase.co/storage/v1/object/authenticated/report-images/a/b/image']) {
        let handled = false; h.listeners.fetch({ request: new Request(url), respondWith: () => handled = true }); assert.equal(handled, false, url);
    }
    h.listeners.fetch({ request: new Request('https://example.test/project/interface/home.html'), respondWith: response => pending = response });
    assert.equal(await (await pending).text(), 'cached');
    h.listeners.activate({ waitUntil: promise => pending = promise }); await pending;
    assert.deepEqual(h.deleted, ['muni-app-v2']);
});
test('all precached local files exist and include local module dependencies and install icons', async () => {
    const h = await workerHarness(); let pending;
    h.listeners.install({ waitUntil: p => pending = p }); await pending;
    const local = [...h.entries.keys()].filter(url => url.startsWith('https://example.test/project/'));
    for (const url of local) {
        const relative = decodeURIComponent(new URL(url).pathname.slice('/project/'.length));
        const body = await readFile(new URL('../' + relative, import.meta.url));
        if (/\.(js|mjs)$/.test(relative)) {
            for (const [, dependency] of body.toString().matchAll(/from\s+['"]([^'"]+)['"]/g)) {
                const target = new URL(dependency, url).href;
                assert.ok(h.entries.has(target), `${relative} requires ${target}`);
            }
        }
    }
    const manifest = JSON.parse(await readFile(new URL('../interface/manifest.webmanifest', import.meta.url), 'utf8'));
    for (const icon of manifest.icons) assert.ok(h.entries.has(new URL(icon.src, 'https://example.test/project/interface/').href));
});
test('history snapshots are hidden before leaving and remain hidden during restored-session reload', async () => {
    const events = {}, root = { style: {} }; let reloads = 0;
    const context = vm.createContext({
        document: { documentElement: root, createElement: () => ({ setAttribute() {} }), querySelector: () => ({ prepend() {} }) },
        navigator: { onLine: true },
        window: { addEventListener: (name, handler) => events[name] = handler, location: { reload: () => reloads++ } }
    });
    vm.runInContext(await readFile(new URL('../interface/offline.js', import.meta.url), 'utf8'), context);
    events.pageshow({ persisted: false });
    assert.equal(root.style.visibility, undefined); assert.equal(reloads, 0);
    events.pagehide(); assert.equal(root.style.visibility, 'hidden');
    events.pageshow({ persisted: true });
    assert.equal(root.style.visibility, 'hidden'); assert.equal(reloads, 1);
});
