import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const text=await readFile(new URL('../interface/report-photo.js',import.meta.url),'utf8');
class Element {
    constructor(){this.children=[];this.style={};this.events={};this.textContent='';}
    replaceChildren(...nodes){this.children=nodes;}
    append(...nodes){this.children.push(...nodes);}
    setAttribute(){}
    addEventListener(name,fn){this.events[name]=fn;}
}
async function setup(options) {
    const container=new Element(),auth={currentUser:{uid:'owner'}},requests=[],revoked=[];
    let authCallback, unsubscribed = false;
    const dependencies={
        document:{createElement:()=>new Element()},getServices:async()=>({auth}),
        onAuthStateChanged:(_,fn)=>{authCallback=fn;return()=>{unsubscribed=true;};},
        downloadReportPhoto:(id,uid,signal)=>new Promise((resolve,reject)=>requests.push({id,uid,signal,resolve,reject})),
        uploadReportPhoto:async()=>{},AbortController,
        URL:{createObjectURL:()=> 'blob:private-photo',revokeObjectURL:value=>revoked.push(value)},
    };
    const create=new Function(...Object.keys(dependencies),text.replace(/^import .*;\n/gm,'').replace(/export /g,'')+';return createReportPhotoViewer;')(...Object.values(dependencies));
    const viewer=create(container, options);await tick();
    return {viewer,container,requests,revoked,unsubscribed:()=>unsubscribed,authChanged:uid=>{auth.currentUser=uid?{uid}:null;authCallback(auth.currentUser);}};
}
const report={id:'report1',submitterID:'owner',supportingImageURL:'owner/report1/image'};
test('viewer loads through authenticated helper, reuses a loaded photo and revokes it on close',async()=>{
    const h=await setup();h.viewer.set(report);await tick();
    assert.equal(h.requests[0].uid,'owner');h.requests[0].resolve(new Blob(['image']));await tick();
    assert.equal(h.container.children[1].src,'blob:private-photo');
    h.viewer.set(report);assert.equal(h.requests.length,1);
    h.viewer.clear();assert.deepEqual(h.revoked,['blob:private-photo']);assert.equal(h.container.children.length,0);
});
test('signout aborts pending reads and late bytes never become visible',async()=>{
    const h=await setup();h.viewer.set(report);await tick();
    h.authChanged(null);
    assert.equal(h.requests[0].signal.aborted,true);
    h.requests[0].resolve(new Blob(['image']));await tick();
    assert.equal(h.container.children.length,0);assert.equal(h.revoked.length,0);
});
test('missing photo offers owner retry while an access-denied error does not expose upload controls',async()=>{
    const h=await setup();h.viewer.set(report);await tick();
    h.requests[0].reject({status:404});await tick();
    assert.ok(h.container.children[2].children.some(child => child.type === 'file'));
    h.viewer.clear();h.viewer.set(report);await tick();
    h.requests[1].reject({status:403});await tick();
    assert.equal(h.container.children.length,2);
    h.viewer.clear();h.viewer.set({id:'text-only'});await tick();
    assert.equal(h.requests.length,2);assert.equal(h.container.textContent,'No photo attached.');
});

test('card preview hides upload controls and disposal releases its auth subscription', async () => {
    const h = await setup({preview:true});
    h.viewer.set(report); await tick();
    h.requests[0].reject({status:404}); await tick();
    assert.equal(h.container.children.length, 2);
    h.viewer.dispose();
    assert.equal(h.unsubscribed(), true);
    assert.equal(h.requests[0].signal.aborted, true);
    h.viewer.set(report); await tick();
    assert.equal(h.requests.length, 1);
    assert.equal(h.container.children.length, 0);
});
