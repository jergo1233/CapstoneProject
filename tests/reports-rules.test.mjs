// Run only against a local Firestore emulator started with this repo's firestore.rules.
// No cloud requests, real credentials or third-party test dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error('Set FIRESTORE_EMULATOR_HOST to a local emulator (for example 127.0.0.1:8085).');
}
const project = 'demo-capstone-reports';
const database = 'projects/'+project+'/databases/(default)';
const base = 'http://'+host+'/v1/'+database+'/documents';
function token(uid, provider='password') {
    const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    return encode({alg:'none',typ:'JWT'})+'.'+encode({
        iss:'https://securetoken.google.com/'+project,aud:project,sub:uid,user_id:uid,
        iat:now,exp:now+3600,auth_time:now,
        firebase:{sign_in_provider:provider,identities:{}},
    })+'.';
}
const a=token('resident-a'), b=token('resident-b'), admin=token('admin-a');
async function request(path,method='GET',body,credential=a) {
    const headers={'Content-Type':'application/json'};
    if(credential) headers.Authorization='Bearer '+credential;
    return fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function expectStatus(response,status) {
    const body=await response.text();
    assert.equal(response.status,status,body);
    return body?JSON.parse(body):null;
}
function field(value) {
    if(typeof value==='string') return {stringValue:value};
    if(typeof value==='number') return {integerValue:String(value)};
    return value;
}
const valid={
    submitterID:'resident-a',issueCategory:'Road and public infrastructure damage',
    barangayArea:'Dapawan',locationDescription:'Near school',issueDescription:'Broken pavement',
    reportStatus:'Received',
};
let sequence=0;
async function create(patch={},credential=a,omit=[],transforms=true,id='test-'+(++sequence)) {
    const data={...valid,...patch};
    omit.forEach(key=>delete data[key]);
    const write={
        update:{name:database+'/documents/reports/'+id,fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,field(value)]))},
        currentDocument:{exists:false},
    };
    if(transforms) write.updateTransforms=['timestamp','updatedAt'].map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}));
    return request(':commit','POST',{writes:[write]},credential);
}
await expectStatus(await request('/residents/resident-a','PATCH',{fields:{role:field('Resident')}},'owner'),200);
await expectStatus(await request('/residents/resident-b','PATCH',{fields:{role:field('Resident')}},'owner'),200);
await expectStatus(await request('/admins/admin-a','PATCH',{fields:{role:field('Admin')}},'owner'),200);

test('resident can submit a valid report with server timestamps',async()=>{
    await expectStatus(await create({},a,[],true,'owned-report'),200);
    const result=await expectStatus(await request('/reports/owned-report'),200);
    assert.equal(result.fields.reportStatus.stringValue,'Received');
    assert.ok(result.fields.timestamp.timestampValue);
    assert.equal(result.fields.timestamp.timestampValue,result.fields.updatedAt.timestampValue);
});
test('only owner and designated admin can read a report',async()=>{
    await expectStatus(await request('/reports/owned-report','GET',undefined,a),200);
    await expectStatus(await request('/reports/owned-report','GET',undefined,admin),200);
    await expectStatus(await request('/reports/owned-report','GET',undefined,b),403);
    await expectStatus(await request('/reports/owned-report','GET',undefined,null),403);
});
test('owner query succeeds; unfiltered and other-owner queries fail',async()=>{
    const query={from:[{collectionId:'reports'}]};
    await expectStatus(await request(':runQuery','POST',{structuredQuery:{...query,where:{fieldFilter:{field:{fieldPath:'submitterID'},op:'EQUAL',value:field('resident-a')}}}}),200);
    await expectStatus(await request(':runQuery','POST',{structuredQuery:query}),403);
    await expectStatus(await request(':runQuery','POST',{structuredQuery:{...query,where:{fieldFilter:{field:{fieldPath:'submitterID'},op:'EQUAL',value:field('resident-b')}}}}),403);
});
test('unauthenticated, anonymous and missing-resident-profile writes fail',async()=>{
    await expectStatus(await create({},null),403);
    await expectStatus(await create({},token('resident-a','anonymous')),403);
    await expectStatus(await create({submitterID:'outsider'},token('outsider')),403);
});
test('spoofed owner and initial status fail',async()=>{
    await expectStatus(await create({submitterID:'resident-b'}),403);
    await expectStatus(await create({reportStatus:'Resolved'}),403);
});
test('admin-only fields and deferred images/coordinates cannot be injected',async()=>{
    for(const key of ['priorityLevel','routingLevel','referredTo','supportingImageURL','geoLocation']) {
        await expectStatus(await create({[key]:'spoof'}),403);
    }
});
test('missing required text and malformed text fail',async()=>{
    for(const key of ['issueCategory','barangayArea','locationDescription','issueDescription']) {
        await expectStatus(await create({},a,[key]),403);
    }
    for(const patch of [
        {issueCategory:'Other'},{barangayArea:'Unknown'},{issueDescription:42},
        {issueDescription:' \n\t '},{locationDescription:''},
        {locationDescription:'x'.repeat(501)},{issueDescription:'x'.repeat(5001)},
    ]) await expectStatus(await create(patch),403);
});
test('multiline descriptions and maximum text lengths are accepted',async()=>{
    await expectStatus(await create({issueDescription:'Line 1\nLine 2'}),200);
    await expectStatus(await create({locationDescription:'x'.repeat(500),issueDescription:'x'.repeat(5000)}),200);
});
test('missing or client-invented timestamps fail',async()=>{
    await expectStatus(await create({},a,[],false),403);
    await expectStatus(await create({timestamp:{timestampValue:'2020-01-01T00:00:00Z'},updatedAt:{timestampValue:'2020-01-01T00:00:00Z'}},a,[],false),403);
});
test('residents cannot update reports and nobody can delete them',async()=>{
    for(const credential of [a,b]) {
        await expectStatus(await request('/reports/owned-report','PATCH',{fields:{reportStatus:field('Resolved')}},credential),403);
        await expectStatus(await request('/reports/owned-report','DELETE',undefined,credential),403);
    }
});

async function update(patch, credential=admin, transforms=true, id='owned-report') {
    const write={
        update:{name:database+'/documents/reports/'+id, fields:Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,field(value)]))},
        updateMask:{fieldPaths:Object.keys(patch)}, currentDocument:{exists:true},
    };
    if(transforms) write.updateTransforms=[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}];
    return request(':commit','POST',{writes:[write]},credential);
}
test('admin can query all reports and save every supported status with processing fields',async()=>{
    await expectStatus(await request(':runQuery','POST',{structuredQuery:{from:[{collectionId:'reports'}]}},admin),200);
    const original=await expectStatus(await request('/reports/owned-report'),200);
    for(const status of ['For Verification','Referred','Ongoing','Resolved','Not Within LGU Jurisdiction','Received']) {
        await expectStatus(await update({reportStatus:status,priorityLevel:'High',routingLevel:'Municipal',referredTo:'Engineering office'}),200);
    }
    const saved=await expectStatus(await request('/reports/owned-report'),200);
    assert.equal(saved.fields.timestamp.timestampValue,original.fields.timestamp.timestampValue);
    assert.equal(saved.fields.issueDescription.stringValue,original.fields.issueDescription.stringValue);
    assert.equal(saved.fields.submitterID.stringValue,'resident-a');
});
test('admin cannot change resident fields, forge timestamps, add images or delete reports',async()=>{
    for(const patch of [
        {submitterID:'resident-b'}, {issueDescription:'rewritten'}, {barangayArea:'Mayha'},
        {issueCategory:'Improper waste disposal'}, {locationDescription:'changed'},
        {timestamp:{timestampValue:'2020-01-01T00:00:00Z'}},
        {geoLocation:{geoPointValue:{latitude:12.4,longitude:122}}},
        {supportingImageURL:'https://example.com/image'},
    ]) await expectStatus(await update(patch),403);
    await expectStatus(await update({reportStatus:'Ongoing'},admin,false),403);
    await expectStatus(await request('/reports/owned-report','DELETE',undefined,admin),403);
});
test('processing enums and referral lengths are enforced; optional values may be cleared',async()=>{
    for(const patch of [{reportStatus:'Rejected'},{priorityLevel:'Urgent'},{routingLevel:'Automatic'},{referredTo:' '},{referredTo:'x'.repeat(201)}]) {
        await expectStatus(await update(patch),403);
    }
    await expectStatus(await update({priorityLevel:{nullValue:null},routingLevel:{nullValue:null},referredTo:{nullValue:null}}),200);
});
test('residents cannot use a valid admin update payload',async()=>{
    for(const credential of [a,b,null]) await expectStatus(await update({reportStatus:'Ongoing',priorityLevel:'Low'},credential),403);
});
test('optional coordinates require a GeoPoint and remain private and immutable',async()=>{
    await expectStatus(await create({geoLocation:{geoPointValue:{latitude:12.4,longitude:121.98}}},a,[],true,'pinned-report'),200);
    const saved=await expectStatus(await request('/reports/pinned-report'),200);
    assert.equal(saved.fields.geoLocation.geoPointValue.latitude,12.4);
    await expectStatus(await request('/reports/pinned-report','GET',undefined,b),403);
    await expectStatus(await update({geoLocation:{geoPointValue:{latitude:12.5,longitude:122}}},a,true,'pinned-report'),403);
    await expectStatus(await create({geoLocation:{mapValue:{fields:{latitude:field(12),longitude:field(122)}}}}),403);
    await expectStatus(await create({geoLocation:{nullValue:null}}),403);
});

test('photo reference must belong to this owner and exact report',async()=>{
    await expectStatus(await create({supportingImageURL:'resident-a/photo-report/image'},a,[],true,'photo-report'),200);
    for(const credential of [a,admin]) await expectStatus(await request('/reports/photo-report','GET',undefined,credential),200);
    await expectStatus(await request('/reports/photo-report','GET',undefined,b),403);
    for(const value of ['resident-b/photo-report/image','resident-a/other/image','https://example.com/photo','../photo/image']) {
        await expectStatus(await create({supportingImageURL:value}),403);
    }
});
test('submitted photo reference cannot be changed or removed by owner or admin',async()=>{
    for(const credential of [a,admin]) {
        await expectStatus(await update({supportingImageURL:'resident-a/other/image'},credential,true,'photo-report'),403);
        await expectStatus(await request(':commit','POST',{writes:[{
            update:{name:database+'/documents/reports/photo-report',fields:{}},
            updateMask:{fieldPaths:['supportingImageURL']},
            updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],
        }]},credential),403);
    }
});
test('revoking admin role blocks subsequent reads and updates',async()=>{
    await expectStatus(await request('/admins/admin-a','DELETE',undefined,'owner'),200);
    await expectStatus(await request('/reports/owned-report','GET',undefined,admin),403);
    await expectStatus(await update({reportStatus:'Resolved'}),403);
});

function eventWrite(id, data) {
    return {update:{name:database+'/documents/notifications/'+id,fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,field(value)]))},
        currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]};
}
const newEvent={kind:'new-report',reportId:'notified-report',recipient:'admins',category:valid.issueCategory,barangay:valid.barangayArea};
test('new-report event requires matching atomic report creation; admin-only reads',async()=>{
    await expectStatus(await request('/admins/admin-a','PATCH',{fields:{role:field('Admin')}},'owner'),200);
    await expectStatus(await request(':commit','POST',{writes:[eventWrite('notified-report',newEvent)]}),403);
    const write={update:{name:database+'/documents/reports/notified-report',fields:Object.fromEntries(Object.entries(valid).map(([k,v])=>[k,field(v)]))},currentDocument:{exists:false},updateTransforms:['timestamp','updatedAt'].map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))};
    await expectStatus(await request(':commit','POST',{writes:[write,eventWrite('notified-report',newEvent)]}),200);
    await expectStatus(await request('/notifications/notified-report','GET',undefined,admin),200);
    await expectStatus(await request('/notifications/notified-report','GET',undefined,a),403);
    await expectStatus(await request('/notifications/notified-report','GET',undefined,null),403);
});
test('report-update events must match a real admin change and are private to the resident',async()=>{
    const event={kind:'report-update',reportId:'notified-report',recipient:'resident-a',category:valid.issueCategory,barangay:valid.barangayArea,reportStatus:'Ongoing',referredTo:{nullValue:null}};
    const update={update:{name:database+'/documents/reports/notified-report',fields:{reportStatus:field('Ongoing'),referredTo:{nullValue:null}}},updateMask:{fieldPaths:['reportStatus','referredTo']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]};
    await expectStatus(await request(':commit','POST',{writes:[update,eventWrite('update-spoof',{...event,recipient:'resident-b'})]},admin),403);
    await expectStatus(await request(':commit','POST',{writes:[update,eventWrite('update-owner',event)]},a),403);
    await expectStatus(await request(':commit','POST',{writes:[update,eventWrite('update-owner',event)]},admin),200);
    await expectStatus(await request('/notifications/update-owner','GET',undefined,a),200);
    await expectStatus(await request('/notifications/update-owner','GET',undefined,b),403);
    await expectStatus(await request(':commit','POST',{writes:[eventWrite('replay-update',event)]},admin),403);
});
test('notification queries are owner/kind scoped and read receipts cannot affect other accounts',async()=>{
    const query={from:[{collectionId:'notifications'}],where:{compositeFilter:{op:'AND',filters:[['kind','report-update'],['recipient','resident-a']].map(([key,value])=>({fieldFilter:{field:{fieldPath:key},op:'EQUAL',value:field(value)}}))}}};
    await expectStatus(await request(':runQuery','POST',{structuredQuery:query},a),200);
    await expectStatus(await request(':runQuery','POST',{structuredQuery:query},b),403);
    await expectStatus(await request(':runQuery','POST',{structuredQuery:{from:[{collectionId:'notifications'}],where:{fieldFilter:{field:{fieldPath:'kind'},op:'EQUAL',value:field('new-report')}}}},admin),200);
    const receipt=uid=>({update:{name:database+'/documents/notificationUsers/'+uid+'/reads/update-owner',fields:{}},updateTransforms:[{fieldPath:'readAt',setToServerValue:'REQUEST_TIME'}]});
    await expectStatus(await request(':commit','POST',{writes:[receipt('resident-a')]},a),200);
    await expectStatus(await request(':commit','POST',{writes:[receipt('resident-a')]},b),403);
    await expectStatus(await request(':commit','POST',{writes:[receipt('resident-b')]},b),403);
    await expectStatus(await request('/notificationUsers/resident-a/reads/update-owner','GET',undefined,b),403);
    await expectStatus(await request('/notifications/update-owner','PATCH',{fields:{recipient:field('resident-b')}},a),403);
});

test('disabled admins lose report/profile/notification access; clients cannot elevate or re-enable themselves',async()=>{
    await expectStatus(await request('/admins/admin-a','PATCH',{fields:{role:field('Admin'),active:{booleanValue:false}}},'owner'),200);
    await expectStatus(await request('/reports/owned-report','GET',undefined,admin),403);
    await expectStatus(await request('/residents/resident-a','GET',undefined,admin),403);
    await expectStatus(await request('/notifications/notified-report','GET',undefined,admin),403);
    await expectStatus(await update({reportStatus:'Resolved'}),403);
    await expectStatus(await request('/admins/admin-a','GET',undefined,admin),200);
    for(const credential of [a,admin]) {
        await expectStatus(await request('/admins/admin-a','PATCH',{fields:{role:field('Admin'),active:{booleanValue:true},canManageEmployees:{booleanValue:true}}},credential),403);
    }
    await expectStatus(await request('/admins/admin-a','PATCH',{fields:{role:field('Admin'),active:{booleanValue:true}}},'owner'),200);
    await expectStatus(await request('/reports/owned-report','GET',undefined,admin),200);
});
