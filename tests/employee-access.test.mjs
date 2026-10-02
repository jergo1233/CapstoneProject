import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('employee navigation requires live main-admin permission; account switches/revocation clear it',async()=>{
 const link={hidden:true},states=[],listeners=[],events={};let authChanged;
 const user={uid:'main'};
 const dependencies={
  document:{querySelectorAll:()=>[link]},window:{addEventListener:(name,fn)=>events[name]=fn,location:{reload(){}}},
  getServices:async()=>({auth:{},db:{}}),onAuthStateChanged:(_,fn)=>{authChanged=fn;fn(user);return()=>{};},doc:(_,kind,uid)=>uid,
  onSnapshot:(id,options,next,fail)=>{listeners.push({next,fail});return()=>{};},
 };
 const source=(await readFile(new URL('../admin_interface/employee-access.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function','function');
 const subscribe=new Function(...Object.keys(dependencies),source+';return onEmployeeAccess;')(...Object.values(dependencies));
 subscribe((allowed,user)=>states.push({allowed,uid:user?.uid}));await tick();
 const emit=(data,cached=false,index=0)=>listeners[index].next({exists:()=>true,data:()=>data,metadata:{fromCache:cached}});
 emit({role:'Admin',canManageEmployees:true},true);assert.equal(link.hidden,true);
 emit({role:'Admin'});assert.equal(link.hidden,true);
 emit({role:'Admin',canManageEmployees:true});assert.equal(link.hidden,false);
 emit({role:'Admin',canManageEmployees:true,active:false});assert.equal(link.hidden,true);
 emit({role:'Admin',canManageEmployees:true});authChanged({uid:'staff'});assert.equal(link.hidden,true);
 emit({role:'Admin',canManageEmployees:true});assert.equal(link.hidden,true);
 emit({role:'Admin'},false,1);assert.equal(states.at(-1).allowed,false);
 events.pagehide();emit({role:'Admin',canManageEmployees:true},false,1);assert.equal(link.hidden,true);
});
