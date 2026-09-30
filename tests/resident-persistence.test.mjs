import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const storage = () => { const data = new Map(); return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
const source = await readFile(new URL('../firebase/offline-cache.mjs',import.meta.url),'utf8');
function cache(local, session) {
    return new Function('localStorage','sessionStorage', source.replace(/export /g,'') + ';return {configureOfflinePersistence,setOfflineOwner,readOffline,saveOffline,clearOfflinePrivate};')(local,session);
}
test('opted-in cache survives a fresh app session but requires the restored owner and clears on logout',()=>{
    const local=storage(), first=cache(local,storage());
    first.configureOfflinePersistence('resident',true);
    first.saveOffline('resident','reports',[{id:'private'}]);
    const reopened=cache(local,storage());
    assert.equal(reopened.readOffline('resident','reports'),null);
    reopened.setOfflineOwner('resident');
    assert.equal(reopened.readOffline('resident','reports')[0].id,'private');
    reopened.clearOfflinePrivate();
    const again=cache(local,storage());again.setOfflineOwner('resident');
    assert.equal(again.readOffline('resident','reports'),null);
});
test('session-only data does not survive restart; changing owner or opting out removes remembered data',()=>{
    const local=storage(), first=cache(local,storage());
    first.configureOfflinePersistence('a',false);first.saveOffline('a','profile',{fullName:'Private'});
    const fresh=cache(local,storage());fresh.setOfflineOwner('a');assert.equal(fresh.readOffline('a','profile'),null);
    first.configureOfflinePersistence('a',true);first.saveOffline('a','profile',{});
    fresh.setOfflineOwner('b');fresh.setOfflineOwner('a');assert.equal(fresh.readOffline('a','profile'),null);
    first.configureOfflinePersistence('a',true);first.saveOffline('a','profile',{});
    first.configureOfflinePersistence('a',false);
    const after=cache(local,storage());after.setOfflineOwner('a');assert.equal(after.readOffline('a','profile'),null);
});
test('only an opted-in resident login enables persistent auth after role verification',async()=>{
    const code=(await readFile(new URL('../firebase/auth.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
    for(const [role,remember,valid] of [['Resident',true,true],['Resident',false,true],['Admin',true,true],['Resident',true,false]]) {
        const calls=[];
        const deps={clearOfflinePrivate:()=>calls.push('clear'),configureOfflinePersistence:(uid,p)=>calls.push(['cache',uid,p]),getServices:async()=>({auth:{},db:{}}),
            signInWithEmailAndPassword:async()=>({user:{uid:'u'}}),signOut:async()=>calls.push('signout'),setPersistence:async(_,p)=>calls.push(p),browserSessionPersistence:'session',browserLocalPersistence:'local',
            doc:()=>({}),getDoc:async()=>({exists:()=>valid,data:()=>({role})})};
        const login=new Function(...Object.keys(deps),code+';return login;')(...Object.values(deps));
        if(valid) await login('user@example.com','password',role,remember);else await assert.rejects(login('user@example.com','password',role,remember));
        assert.equal(calls[0],'session');
        assert.equal(calls.includes('local'),valid && role==='Resident' && remember);
        if(!valid) assert.ok(calls.includes('signout'));
    }
});
