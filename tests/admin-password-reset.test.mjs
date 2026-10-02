import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../login/password-reset.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function setup(send = async () => {}, saved = 0, resident = false) {
    const nodes = Object.fromEntries(['passwordReset', 'passwordResetForm', 'resetEmail', 'resetSubmit', 'resetMessage', 'admin_email'].map(id => [id, {value:'', dataset:{}, addEventListener(type, fn){this[type] = fn;}, reportValidity:()=>true}]));
    if (resident) { nodes.email = nodes.admin_email; delete nodes.admin_email; }
    nodes.resetEmail.value = ' staff@example.test ';
    let calls = 0, now = 100000, stored;
    const navigator = {onLine:true};
    vm.runInNewContext(source, {document:{getElementById:id=>nodes[id]}, navigator,
        sessionStorage:{getItem:()=>saved, setItem:(_, value)=>stored=value},
        Date:{now:()=>now}, setInterval:()=>{}, getServices:async()=>({auth:'firebase-auth'}),
        sendPasswordResetEmail:async(auth,email)=>{calls++; assert.equal(auth,'firebase-auth'); assert.equal(email,'staff@example.test'); await send();}});
    return {nodes, navigator, submit:()=>nodes.passwordResetForm.submit({preventDefault(){}}), calls:()=>calls, stored:()=>stored, advance:()=>now+=61000};
}
test('existing and missing accounts receive the same message and cooldown', async () => {
    const existing = setup();
    const missing = setup(async()=>{throw {code:'auth/user-not-found'};});
    await existing.submit(); await missing.submit();
    assert.equal(existing.nodes.resetMessage.textContent, missing.nodes.resetMessage.textContent);
    assert.equal(existing.nodes.resetMessage.dataset.state, 'success');
    await existing.submit(); assert.equal(existing.calls(),1);
    assert.equal(existing.stored(),'160000');
    existing.advance(); await existing.submit(); assert.equal(existing.calls(),2);
});
test('in-flight submissions are not duplicated', async () => {
    let release;
    const state = setup(()=>new Promise(resolve=>release=resolve));
    const pending = state.submit();
    await Promise.resolve();
    await state.submit(); assert.equal(state.calls(),1);
    release(); await pending;
});
test('offline and network errors do not claim an email was sent or reveal raw errors', async () => {
    const state = setup(async()=>{throw Error('secret upstream details');});
    state.navigator.onLine=false; await state.submit(); assert.equal(state.calls(),0);
    assert.match(state.nodes.resetMessage.textContent,/Connect/);
    state.navigator.onLine=true; await state.submit();
    assert.equal(state.nodes.resetMessage.dataset.state,'error');
    assert.doesNotMatch(state.nodes.resetMessage.textContent,/secret/);
});
test('reload cooldown and invalid form prevent requests', async () => {
    const state = setup(undefined,160000); await state.submit(); assert.equal(state.calls(),0);
    state.advance(); state.nodes.passwordResetForm.reportValidity=()=>false;
    await state.submit(); assert.equal(state.calls(),0);
});

// The same implementation is loaded by both sign-in pages.
test('resident and admin login expose recovery separately from password sign-in', async () => {
    for (const path of ['../index.html', '../admin_interface/admin_login/admin.html']) {
        const html = await readFile(new URL(path, import.meta.url), 'utf8');
        assert.match(html, /<details class="password_reset"/);
        assert.match(html, /<form id="passwordResetForm">/);
        assert.ok(html.indexOf('</form>') < html.indexOf('id="passwordResetForm"'));
    }
    const wrapper = await readFile(new URL('../admin_interface/admin_login/password-reset.js', import.meta.url), 'utf8');
    assert.match(wrapper, /import '..\/..\/login\/password-reset.js'/);
});

test('resident recovery prefills from resident email without a password', () => {
    const state = setup(undefined, 0, true);
    state.nodes.email.value = 'resident@example.test';
    state.nodes.resetEmail.value = '';
    state.nodes.passwordReset.open = true;
    state.nodes.passwordReset.toggle();
    assert.equal(state.nodes.resetEmail.value, 'resident@example.test');
});
