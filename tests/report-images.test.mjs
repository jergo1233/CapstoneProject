import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageHandler } from '../supabase/functions/image-storage/index.ts';
const config={supabaseUrl:'https://storage.test',serviceRoleKey:'secret-test-key',firebaseProjectId:'demo',firebaseApiKey:'public'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);
const fields={submitterID:{stringValue:'owner'},supportingImageURL:{stringValue:'owner/report1/image'}};
function setup({uid='owner',reportStatus=200,reportFields=fields,storageStatus=200,storageBody,profileRole='Resident',identityStatus=200}={}) {
    const calls=[];
    return {calls,handler:createImageHandler(config,async(url,options)=>{
        calls.push({url,...options});
        if(url.includes('identitytoolkit')) return Response.json({users:[{localId:uid,providerUserInfo:[{providerId:'password'}]}]},{status:identityStatus});
        if(url.includes('/reports/')) return Response.json({fields:reportFields},{status:reportStatus});
        if(url.includes('/residents/')) return Response.json({fields:{role:{stringValue:profileRole}}});
        if(storageStatus!==200) return Response.json(storageBody||{error:'failure'},{status:storageStatus});
        if(url.includes('/authenticated/')) return new Response(png,{headers:{'Content-Type':'image/png'}});
        return Response.json({ok:true});
    })};
}
function req(method='GET',extra='',body=png,type='image/png',token='token'){
    return new Request('https://function.test/image-storage?kind=report&id=report1'+extra,{
        method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':type},
        ...(method==='POST'?{body}:{}),
    });
}
test('private reads return image bytes with no-store after live Firebase verification',async()=>{
    for(const uid of ['owner','admin']) {
        const h=setup({uid}),r=await h.handler(req());
        assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
        assert.equal(r.headers.get('Content-Type'),'image/png');
        assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
        assert.equal(h.calls[1].headers.Authorization,'Bearer token');
        assert.equal(h.calls[2].url,'https://storage.test/storage/v1/object/authenticated/report-images/owner/report1/image');
    }
});
test('denied, missing, revoked or unavailable report access never reaches Storage',async()=>{
    for(const reportStatus of [401,403,404,503]) {
        const h=setup({reportStatus});
        assert.ok((await h.handler(req())).status>=400);
        assert.equal(h.calls.filter(x=>x.url.startsWith(config.supabaseUrl)).length,0);
    }
});
test('missing and invalid credentials fail before report or Storage access',async()=>{
    const h=setup();assert.equal((await h.handler(req('GET','',png,'image/png',''))).status,401);assert.equal(h.calls.length,0);
    const invalid=setup({identityStatus:400});assert.equal((await invalid.handler(req())).status,401);assert.equal(invalid.calls.length,1);
});
test('owner upload uses a fixed private path and never enables overwrite',async()=>{
    const h=setup();assert.equal((await h.handler(req('POST'))).status,200);
    assert.equal(h.calls.at(-1).url,'https://storage.test/storage/v1/object/report-images/owner/report1/image');
    assert.equal(h.calls.at(-1).headers['x-upsert'],'false');
});
test('admin read permission does not allow uploading someone else’s photo',async()=>{
    const h=setup({uid:'admin'});
    assert.equal((await h.handler(req('POST'))).status,403);
    assert.equal(h.calls.length,2);
});
test('upload requires a current resident profile and matching reserved reference',async()=>{
    for(const options of [{profileRole:'Admin'},{reportFields:{submitterID:{stringValue:'owner'}}},{reportFields:{...fields,supportingImageURL:{stringValue:'other/report1/image'}}}]) {
        const h=setup(options);assert.ok((await h.handler(req('POST'))).status>=400);
        assert.equal(h.calls.filter(x=>x.url.startsWith(config.supabaseUrl)).length,0);
    }
});
test('reject path injection, unknown operations, duplicate parameters and report deletion',async()=>{
    for(const extra of ['&bucket=announcement-images','&path=other','&kind=report','&id=other']) {
        const h=setup();assert.equal((await h.handler(req('GET',extra))).status,400);assert.equal(h.calls.length,0);
    }
    const h=setup();assert.equal((await h.handler(req('DELETE'))).status,405);assert.equal(h.calls.length,0);
});
test('reject invalid, empty and oversized photo bodies before Storage upload',async()=>{
    for(const [body,type] of [[png,'image/svg+xml'],[new Uint8Array(),'image/png'],[new Uint8Array([1,2]),'image/png'],[new Uint8Array(5*1024*1024+1),'image/png']]) {
        const h=setup();assert.ok((await h.handler(req('POST','',body,type))).status>=400);
        assert.equal(h.calls.filter(x=>x.url.startsWith(config.supabaseUrl)).length,0);
    }
});
test('missing Storage photo is recoverable but upstream errors and duplicate uploads do not claim success',async()=>{
    const missing=setup({storageStatus:400,storageBody:{code:'NoSuchKey'}});
    assert.equal((await missing.handler(req())).status,404);
    const outage=setup({storageStatus:503});
    assert.equal((await outage.handler(req())).status,503);
    const conflict=setup({storageStatus:409});
    const r=await conflict.handler(req('POST'));assert.equal(r.status,502);
    assert.doesNotMatch(await r.text(),/secret-test-key/);
});
