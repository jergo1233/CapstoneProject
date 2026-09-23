import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
test('each short admin route serves an existing page with resolvable local assets', async () => {
    assert.equal(config.rewrites.length, 5);
    for (const {source, destination} of config.rewrites) {
        const html = await readFile(new URL(destination.slice(1), root), 'utf8');
        const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
        for (const pathname of [source, destination, '/CapstoneProject' + destination]) {
            let base;
            vm.runInNewContext(script, {location:{pathname}, document:{createElement:()=>({}),head:{append:node=>base=node.href}}});
            if (pathname === source) assert.ok(base);
            else assert.equal(base, undefined);
            const documentURL = new URL(base || pathname, 'https://example.test');
            for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
                if (reference.startsWith('#') || reference.startsWith('https:')) continue;
                const asset = new URL(reference, documentURL);
                const path = decodeURIComponent(asset.pathname).replace(/^\/CapstoneProject\//, '/');
                await access(new URL(path.slice(1), root));
            }
        }
        assert.ok(config.redirects.some(route => route.source === source + '/' && route.destination === source));
    }
});
test('short-route navigation and logout use short URLs, direct-file navigation remains supported', async () => {
    const source = (await readFile(new URL('admin_interface/admin_login/login_as_admin.js', root), 'utf8')).replace(/^import .*;\n/gm, '');
    for (const pathname of ['/admin/reports', '/admin_interface/report_management.html']) {
        let redirected;
        const link = {value:'dashboard.html',getAttribute(){return this.value;},setAttribute(_,value){this.value=value;}};
        const window = {location:{pathname,replace:value=>redirected=value}};
        const document = {getElementById:()=>null,querySelectorAll:()=>[link],body:{hasAttribute:()=>true}};
        const run = Object.getPrototypeOf(async function(){}).constructor;
        await new run('window','document','logout',source)(window,document,async()=>{});
        await window.handleLogout();
        assert.equal(link.value, pathname.startsWith('/admin/') ? '/admin/dashboard' : 'dashboard.html');
        assert.equal(redirected, pathname.startsWith('/admin/') ? '/admin' : 'admin_login/admin.html');
    }
});
