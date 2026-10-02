import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeHandler } from '../supabase/functions/employee-management/handler.mjs';

function harness() {
    const profiles = new Map([
        ['main', {role:'Admin',canManageEmployees:true,fullName:'Main',emailAddress:'main@test.invalid'}],
        ['staff', {role:'Admin',fullName:'Staff',emailAddress:'staff@test.invalid'}],
        ['disabled', {role:'Admin',active:false,canManageEmployees:true}],
        ['other-main', {role:'Admin',canManageEmployees:true}],
    ]);
    const created = [], deleted = [], emails = [], writes = [];
    let beforeTransaction, createError, emailError = false, commitError = false;
    let authTime = Math.floor(Date.now()/1000), targetUser = {email:'staff@test.invalid',disabled:false,metadata:{lastSignInTime:'2026-10-01'},providerData:[{providerId:'password'}]};
    const ref = id => ({id, get: async () => snapshot(id)});
    const snapshot = id => ({id,exists:profiles.has(id),data:()=>profiles.get(id)});
    const db = {
        collection: () => ({doc:ref,orderBy:()=>{
            let cursor = '';
            const query={limit:()=>query,startAfter:value=>{cursor=value;return query;},get:async()=>({docs:[...profiles.keys()].sort().filter(id=>id>cursor).slice(0,51).map(snapshot)})};return query;
        }}),
        runTransaction: async callback => {
            beforeTransaction?.();
            const operations = [];
            const result = await callback({get:async target=>snapshot(target.id),create:(target,data)=>operations.push([target.id,data]),update:(target,data)=>operations.push([target.id,{...profiles.get(target.id),...data}])});
            if (commitError) throw Error('private upstream details');
            for (const [id,data] of operations) {profiles.set(id,data);writes.push(id);}
            return result;
        },
    };
    const auth = {
        verifyIdToken: async value => {if(value==='bad')throw Error('secret token');return {uid:value,auth_time:authTime,firebase:{sign_in_provider:value==='anonymous'?'anonymous':'password'}};},
        getUser: async()=>targetUser,
        createUser: async data=>{if(createError)throw createError;created.push(data);return {uid:'new-staff'};},
        deleteUser: async uid=>deleted.push(uid),
    };
    const handler=createEmployeeHandler({auth,db,timestamp:()=>({toMillis:()=>Date.now()}),documentId:()=> '__name__',sendSetupEmail:async email=>{emails.push(email);if(emailError)throw Error('secret upstream');}});
    async function request(body,token='main',method='POST') {
        const response=await handler(new Request('https://test.invalid', {method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:['GET','OPTIONS'].includes(method)?undefined:JSON.stringify(body)}));
        return {status:response.status,data:response.status===204?null:await response.json()};
    }
    return {request,profiles,created,deleted,emails,writes,set authTime(value){authTime=value;},set targetUser(value){targetUser=value;},set beforeTransaction(fn){beforeTransaction=fn;},set createError(error){createError=error;},set emailError(value){emailError=value;},set commitError(value){commitError=value;}};
}
const create={action:'create',fullName:' New Employee ',emailAddress:'NEW@test.invalid',officeName:' PIO '};
test('anonymous, invalid, resident, ordinary and disabled admins cannot manage accounts',async()=>{
    const h=harness();
    for(const [token,status] of [[null,401],['bad',401],['resident',403],['staff',403],['disabled',403],['anonymous',403]]) {
        assert.equal((await h.request(create,token)).status,status);
    }
    assert.equal(h.created.length,0);assert.equal(h.writes.length,0);
    assert.equal((await h.request({},null,'OPTIONS')).status,204);
});
test('creates only ordinary employees, sends email, and exposes no password',async()=>{
    const h=harness();const result=await h.request(create);
    assert.equal(result.status,200);assert.equal(result.data.emailSent,true);
    const data=h.profiles.get('new-staff');
    assert.equal(data.role,'Admin');assert.equal(data.canManageEmployees,false);assert.equal(data.active,true);
    assert.equal(data.createdBy,'main');assert.equal(data.emailAddress,'new@test.invalid');assert.equal(data.officeName,'PIO');
    assert.equal(h.created[0].password.length,72);assert.equal('password' in data,false);
    assert.equal(JSON.stringify(result).includes(h.created[0].password),false);
    assert.deepEqual(h.emails,['new@test.invalid']);
});
test('extra privilege fields, malformed input and existing emails do not grant access',async()=>{
    const h=harness();
    for (const body of [{...create,canManageEmployees:true},{...create,role:'Admin'},{...create,fullName:' '},{...create,emailAddress:'bad'}]) assert.equal((await h.request(body)).status,400);
    h.createError={code:'auth/email-already-exists'};assert.equal((await h.request(create)).status,409);
    assert.equal(h.writes.length,0);assert.equal(h.deleted.length,0);
});
test('rechecks main-admin permission inside writes and cleans up unprovisioned new identity',async()=>{
    const h=harness();h.beforeTransaction=()=>h.profiles.set('main',{role:'Admin',canManageEmployees:false});
    assert.equal((await h.request(create)).status,403);
    assert.deepEqual(h.deleted,['new-staff']);assert.equal(h.profiles.has('new-staff'),false);assert.equal(h.emails.length,0);
});
test('failed profile write rolls back Auth identity; failed email preserves account for resend',async()=>{
    const h=harness();h.commitError=true;
    const result=await h.request(create);assert.equal(result.status,503);assert.ok(!JSON.stringify(result).includes('private upstream'));
    assert.deepEqual(h.deleted,['new-staff']);
    const retry=harness();retry.emailError=true;
    const response=await retry.request(create);assert.equal(response.status,200);assert.equal(response.data.emailSent,false);
    assert.equal(retry.profiles.has('new-staff'),true);assert.equal(retry.deleted.length,0);
});
test('can disable/re-enable ordinary employees but cannot modify any main admin',async()=>{
    const h=harness();
    for (const uid of ['main','other-main','disabled']) assert.equal((await h.request({action:'set-active',uid,active:false})).status,403);
    assert.equal((await h.request({action:'set-active',uid:'staff',active:false})).status,200);
    assert.equal(h.profiles.get('staff').active,false);assert.equal(h.profiles.get('staff').updatedBy,'main');
    assert.equal((await h.request({action:'send-setup',uid:'staff'})).status,403);
    assert.equal((await h.request({action:'set-active',uid:'staff',active:true})).status,200);
    assert.equal(h.profiles.get('staff').active,true);
});
test('setup emails are employee-only, throttled, and never return password reset links',async()=>{
    const h=harness();
    assert.equal((await h.request({action:'send-setup',uid:'other-main'})).status,403);
    assert.equal((await h.request({action:'send-setup',uid:'staff'})).status,200);
    assert.equal((await h.request({action:'send-setup',uid:'staff'})).status,429);
    assert.deepEqual(h.emails,['staff@test.invalid']);
});
test('list is paginated, returns only display fields, and rechecks revoked access',async()=>{
    const h=harness();for(let i=0;i<70;i++)h.profiles.set('employee'+String(i).padStart(3,'0'),{role:'Admin',createdBy:'private'});
    const result=await h.request({action:'list'});assert.equal(result.status,200);assert.equal(result.data.employees.length,50);assert.ok(result.data.cursor);
    assert.equal('createdBy' in result.data.employees[0],false);
    const next=await h.request({action:'list',cursor:result.data.cursor});assert.equal(next.data.cursor,null);
    assert.equal(new Set([...result.data.employees,...next.data.employees].map(item=>item.uid)).size,74);
});

const edit={action:'edit',uid:'staff',fullName:' Updated Name ',officeName:' Engineering ',expectedFullName:'Staff',expectedOfficeName:''};
const transfer={action:'transfer',uid:'staff',confirmation:'TRANSFER'};
test('profile editing changes only name and office, trims input, and rejects stale values',async()=>{
    const h=harness();assert.equal((await h.request(edit)).status,200);
    const profile=h.profiles.get('staff');assert.equal(profile.fullName,'Updated Name');assert.equal(profile.officeName,'Engineering');
    assert.equal(profile.role,'Admin');assert.equal(profile.emailAddress,'staff@test.invalid');assert.equal(profile.canManageEmployees,undefined);
    assert.equal((await h.request(edit)).status,409);
    assert.equal((await h.request({...edit,uid:'main'})).status,403);
    assert.equal((await h.request({...edit,emailAddress:'other@test.invalid'})).status,400);
    assert.equal((await h.request({...edit,canManageEmployees:true})).status,400);
    assert.equal((await h.request({...edit,fullName:' '})).status,400);
    assert.equal((await h.request(edit,'staff')).status,403);
});
test('handover promotes destination and demotes caller atomically; old manager can no longer act',async()=>{
    const h=harness();const result=await h.request(transfer);assert.equal(result.status,200);
    assert.equal(h.profiles.get('staff').canManageEmployees,true);assert.equal(h.profiles.get('main').canManageEmployees,false);
    assert.equal(h.profiles.get('main').role,'Admin');assert.equal(h.profiles.get('staff').updatedBy,'main');
    assert.deepEqual(h.writes,['staff','main']);
    assert.equal((await h.request({action:'list'})).status,403);
    assert.equal((await h.request({action:'list'},'staff')).status,200);
});
test('handover requires recent auth_time, not a refreshed token alone or client-supplied time',async()=>{
    for (const authTime of [undefined,null,'123',Math.floor(Date.now()/1000)-301,Math.floor(Date.now()/1000)+60]) {
        const h=harness();h.authTime=authTime;assert.equal((await h.request(transfer)).status,401);assert.equal(h.writes.length,0);
    }
    const h=harness();assert.equal((await h.request({...transfer,auth_time:Date.now()})).status,400);
    assert.equal((await h.request({...transfer,confirmation:'yes'})).status,400);
});
test('handover rejects self, protected, disabled, missing and unready destinations',async()=>{
    for (const uid of ['main','other-main','disabled','missing']) {
        const h=harness();const result=await h.request({...transfer,uid});assert.ok([403,404].includes(result.status));assert.equal(h.writes.length,0);
    }
    for (const targetUser of [{disabled:true},{metadata:{}},{metadata:{lastSignInTime:'today'},providerData:[]},{email:'mismatch@test.invalid',metadata:{lastSignInTime:'today'},providerData:[{providerId:'password'}]}]) {
        const h=harness();h.targetUser=targetUser;assert.equal((await h.request(transfer)).status,409);assert.equal(h.writes.length,0);
    }
    const h=harness();h.profiles.get('staff').active=false;assert.equal((await h.request(transfer)).status,409);
});
test('failed or racing handovers cannot leave a partially promoted or demoted profile',async()=>{
    const h=harness();h.commitError=true;assert.equal((await h.request(transfer)).status,503);
    assert.equal(h.profiles.get('main').canManageEmployees,true);assert.equal(h.profiles.get('staff').canManageEmployees,undefined);
    const revoked=harness();revoked.beforeTransaction=()=>{revoked.profiles.get('main').canManageEmployees=false;};
    assert.equal((await revoked.request(transfer)).status,403);assert.equal(revoked.writes.length,0);
    const disabled=harness();disabled.beforeTransaction=()=>{disabled.profiles.get('staff').active=false;};
    assert.equal((await disabled.request(transfer)).status,409);assert.equal(disabled.writes.length,0);
});
