import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(key,value){this.attrs[key]=value;}
 addEventListener(name,fn){this.events[name]=fn;}
 contains(node){return node===this || this.children.some(child=>child.contains?.(node));}
 focus(){}
}
async function setup(admin=false){
 const header=new Element(),listeners=[],writes=[],location={pathname:admin?'/admin/dashboard':'/interface/home.html',origin:'https://example.test',assign(url){this.destination=url;},reload(){}};
 let authChange;const auth={currentUser:{uid:'user'}};
 const deps={document:{querySelector:selector=>selector.includes(',')?header:admin?header:null,createElement:tag=>new Element(tag),addEventListener(){}},
 window:{events:{},addEventListener(name,fn){this.events[name]=fn;}},location,navigator:{onLine:true},URL,
 getServices:async()=>({auth,db:{}}),onAuthStateChanged:(_,fn)=>{authChange=fn;fn(auth.currentUser);return()=>{};},
 collection:(_, ...path)=>path.join('/'),doc:(_, ...path)=>path.join('/'),query:(ref,...filters)=>({ref,filters}),where:(...args)=>args,
 onSnapshot:(ref,...args)=>{const entry={ref,next:args.at(-2),error:args.at(-1),stopped:false};listeners.push(entry);return()=>entry.stopped=true;},
 setDoc:async(ref,data)=>writes.push({ref,data}),serverTimestamp:()=>({server:true})};
 const code=(await readFile(new URL('../firebase/notifications-ui.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('import.meta.url',"'https://example.test/firebase/notifications-ui.js'");
 new Function(...Object.keys(deps),code)(...Object.values(deps));await tick();
 const widget=header.children[0],bell=widget.children[0],panel=widget.children[1];
 return {listeners,writes,bell,panel,list:panel.children[2],location,change:uid=>{auth.currentUser=uid?{uid}:null;authChange(auth.currentUser);},deps};
}
const snapshot=items=>({docs:items.map(item=>({id:item.id,data:()=>item,metadata:{hasPendingWrites:false}})),metadata:{fromCache:false}});
const event={id:'event',kind:'report-update',reportId:'report',recipient:'user',category:'Road',barangay:'Dapawan',reportStatus:'Ongoing'};
test('resident notifications query only owned updates; click saves own read receipt and opens report',async()=>{
 const h=await setup();
 assert.deepEqual(h.listeners[0].ref.filters,[['kind','==','report-update'],['recipient','==','user']]);
 h.listeners[0].next(snapshot([event]));h.listeners[1].next(snapshot([]));
 assert.equal(h.bell.children[0].textContent,'1');
 await h.list.children[0].children[0].events.click();
 assert.equal(h.writes[0].ref,'notificationUsers/user/reads/event');
 assert.equal(h.location.destination,'https://example.test/interface/tracking_reports.html#report=report');
 h.listeners[1].next(snapshot([{id:'event'}]));assert.equal(h.bell.children[0].hidden,true);
 h.change(null);h.listeners[0].next(snapshot([event]));assert.equal(h.list.children.length,0);
});
test('admin waits for role verification and clears events on revocation, ignoring queued callbacks',async()=>{
 const h=await setup(true);
 assert.equal(h.listeners.length,1);
 h.listeners[0].next({metadata:{fromCache:true},exists:()=>true,data:()=>({role:'Admin'})});assert.equal(h.listeners.length,1);
 h.listeners[0].next({metadata:{fromCache:false},exists:()=>true,data:()=>({role:'Admin'})});
 assert.deepEqual(h.listeners[1].ref.filters,[['kind','==','new-report']]);
 h.listeners[1].next(snapshot([{...event,kind:'new-report'}]));h.listeners[2].next(snapshot([]));assert.equal(h.list.children.length,1);
 h.listeners[0].next({metadata:{fromCache:false},exists:()=>false});
 assert.equal(h.list.children.length,0);assert.ok(h.listeners.every(item=>item.stopped));
 h.listeners[1].next(snapshot([event]));assert.equal(h.list.children.length,0);
});

test('disabling an admin clears notification data even while their role remains Admin', async()=>{
 const h=await setup(true);
 h.listeners[0].next({metadata:{fromCache:false},exists:()=>true,data:()=>({role:'Admin'})});
 h.listeners[1].next(snapshot([{...event,kind:'new-report'}]));h.listeners[2].next(snapshot([]));
 assert.equal(h.list.children.length,1);
 h.listeners[0].next({metadata:{fromCache:false},exists:()=>true,data:()=>({role:'Admin',active:false})});
 assert.equal(h.list.children.length,0);
 h.listeners[1].next(snapshot([event]));assert.equal(h.list.children.length,0);
});
