import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTextReport, REPORT_CATEGORIES, sortReports, validPin, googleMapsLink } from '../firebase/report-model.mjs';
const input = { issueCategory: REPORT_CATEGORIES[0], barangayArea: 'Dapawan', locationDescription: ' Near school ', issueDescription: ' Broken pavement ' };
test('creates only agreed fields with authenticated owner and server timestamps', () => {
    const stamp = {};
    const data = buildTextReport(input, 'resident-a', stamp);
    assert.equal(data.submitterID, 'resident-a');
    assert.equal(data.reportStatus, 'Received');
    assert.equal(data.locationDescription, 'Near school');
    assert.equal(data.issueDescription, 'Broken pavement');
    assert.equal(data.timestamp, stamp);
    assert.equal(data.updatedAt, stamp);
    assert.equal(Object.keys(data).length, 8);
});
test('rejects invalid, blank and oversized content', () => {
    for (const patch of [
        {issueCategory:'Other'}, {barangayArea:'Unknown'}, {locationDescription:' \n\t '},
        {issueDescription:''}, {issueDescription:23}, {locationDescription:'x'.repeat(501)},
        {issueDescription:'x'.repeat(5001)},
    ]) assert.throws(() => buildTextReport({...input,...patch}, 'a', {}));
    assert.throws(() => buildTextReport(input, '', {}));
});
test('rejects client-supplied ownership, processing, photo and coordinate fields', () => {
    for (const key of ['submitterID','reportStatus','priorityLevel','routingLevel','referredTo','timestamp','updatedAt','geoLocation','supportingImageURL']) {
        assert.throws(() => buildTextReport({...input,[key]:'spoof'}, 'a', {}));
    }
});
test('orders newest reports first without mutating snapshot results', () => {
    const items = [{id:'old',timestamp:{toMillis:()=>1}}, {id:'new',timestamp:{toMillis:()=>3}}];
    assert.deepEqual(sortReports(items).map(x=>x.id), ['new','old']);
    assert.equal(items[0].id, 'old');
});
// Execute the real browser service with only its network SDK imports replaced.
async function serviceHarness({ upload = async()=>{} } = {}) {
    const auth = { currentUser: {uid:'a',isAnonymous:false} };
    let authCallback, writeResolve, writeReject;
    const listeners = [], writes = [], notifications = [];
    const source = (await readFile(new URL('../firebase/reports.js', import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
    const deps = {
        readOffline:()=>null, saveOffline:()=>true, removeOffline:()=>{},
        getServices: async()=>({auth,db:{}}), validateReportPhoto:()=>{}, uploadReportPhoto:upload,
        onAuthStateChanged: (_,cb)=>{authCallback=cb;cb(auth.currentUser);return ()=>{};},
        collection: (_,name)=>name, doc: ()=>({id:'new-report'}),
        writeBatch: ()=>({set:(ref,data)=>{(data.kind ? notifications : writes).push({ref,data});},commit:()=>new Promise((resolve,reject)=>{writeResolve=resolve;writeReject=reject;})}),
        query: (collection,filter)=>({collection,filter}), where: (...args)=>args,
        onSnapshot: (query,options,next,error)=>{const entry={query,next,error,stopped:false};listeners.push(entry);return ()=>entry.stopped=true;},
        serverTimestamp: ()=>({server:true}), buildTextReport, sortReports, validPin,
        GeoPoint: class { constructor(latitude,longitude){this.latitude=latitude;this.longitude=longitude;} },
        navigator:{onLine:true},
    };
    const service = new Function(...Object.keys(deps),source+'; return {createTextReport,watchOwnReports};')(...Object.values(deps));
    return {...service,auth,listeners,writes,notifications,deps,resolve:()=>writeResolve(),reject:error=>writeReject(error),
        change:user=>{auth.currentUser=user;authCallback(user);}};
}
const snapshot = (id, pending=false)=>({docs:[{id,data:()=>({timestamp:null}),metadata:{hasPendingWrites:pending}}],metadata:{fromCache:false}});
test('queries only owner; cancels old subscriptions and ignores stale results after account change/signout', async()=>{
    const h=await serviceHarness(), results=[];
    const stop=await h.watchOwnReports((items,meta)=>results.push({items,meta}),()=>{});
    assert.deepEqual(h.listeners[0].query.filter,['submitterID','==','a']);
    h.listeners[0].next(snapshot('a-report',true));
    assert.equal(results.at(-1).items[0].pending,true);
    h.change({uid:'b'});
    assert.equal(h.listeners[0].stopped,true);
    assert.equal(results.at(-1).items.length,0);
    const count=results.length;
    h.listeners[0].next(snapshot('leak'));
    assert.equal(results.length,count);
    assert.deepEqual(h.listeners[1].query.filter,['submitterID','==','b']);
    h.change(null);
    h.listeners[1].next(snapshot('leak'));
    assert.equal(results.at(-1).meta.state,'signed-out');
    stop();
});
test('waits for server confirmation before successful submission',async()=>{
    const h=await serviceHarness();
    let finished=false;
    const saving=h.createTextReport(input).then(result=>{finished=true;return result;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(finished,false);
    assert.equal(h.writes[0].data.submitterID,'a');
    h.resolve();
    assert.deepEqual(await saving,{id:'new-report',uid:'a'});
});
test('propagates denied writes and blocks offline/anonymous submissions',async()=>{
    const h=await serviceHarness();
    const saving=h.createTextReport(input);
    await new Promise(resolve=>setImmediate(resolve));
    h.reject(Object.assign(new Error('denied'),{code:'permission-denied'}));
    await assert.rejects(saving,{code:'permission-denied'});
    h.deps.navigator.onLine=false;
    await assert.rejects(h.createTextReport(input),/offline/);
    h.auth.currentUser.isAnonymous=true;
    await assert.rejects(h.createTextReport(input),/sign in/);
    assert.equal(h.writes.length,1);
});
test('report page contains referenced elements and no obsolete mock handlers',async()=>{
    const html=await readFile(new URL('../interface/tracking_reports.html',import.meta.url),'utf8');
    const js=await readFile(new URL('../interface/form_panel.js',import.meta.url),'utf8');
    for(const [,id] of js.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(html.includes('id="'+id+'"'),id);
    assert.match(html,/<script type="module" src="form_panel.js">/);
    assert.doesNotMatch(html,/processForm|showSelectedImage|saveDescription|rep_000001/);
    assert.doesNotMatch(js,/innerHTML/);
});

async function pageHarness() {
    class Node {
        constructor() {
            this.children=[]; this.style={}; this.value=''; this.textContent=''; this.hidden=false;
            this.classList={add(){},remove(){}};
            this.events={};
        }
        append(...nodes){this.children.push(...nodes);}
        replaceChildren(...nodes){this.children=nodes;}
        add(node){this.append(node);}
        addEventListener(name,fn){this.events[name]=fn;}
        querySelector(){return null;}
        focus(){}
        removeAttribute(name){delete this[name];}
    }
    const html=await readFile(new URL('../interface/tracking_reports.html',import.meta.url),'utf8');
    const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Node()]));
    const form=nodes.report_form;
    const disabledPhoto=new Node();disabledPhoto.disabled=true;
    form.elements=[nodes.category,nodes.location,nodes.location_description,nodes.description,disabledPhoto];
    form.reportValidity=()=>true;
    form.reset=()=>{ form.events.reset?.(); form.elements.forEach(node=>node.value=''); };
    const timeline=new Node();
    const document={getElementById:id=>nodes[id],createElement:()=>new Node(),querySelector:()=>timeline,activeElement:null};
    const window=new Node(), auth={currentUser:{uid:'a'}};
    let onData,onError,resolve,reject,writes=0, submittedPhoto;
    const revoked=[];
    const source=(await readFile(new URL('../interface/form_panel.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
    const deps={
        document,window,getServices:async()=>({auth}), googleMapsLink,
        createReportPhotoViewer:()=>({set(){},clear(){}}), validateReportPhoto:file=>{if(file.invalid) throw new Error('Invalid photo');},
        URL:{createObjectURL:file=>'blob:'+file.name,revokeObjectURL:url=>revoked.push(url)},
        createReportMap:()=>({show(){},reset(){},setBusy(){},getPin:()=>null}),
        createTextReport:(_input,_pin,photo)=>{submittedPhoto=photo;writes++;return new Promise((yes,no)=>{resolve=yes;reject=no;});},
        watchOwnReports:async(data,error)=>{onData=data;onError=error;data([],{uid:'a',state:'loading'});return ()=>{};},
        REPORT_CATEGORIES,REPORT_BARANGAYS:['Dapawan'],
        reportDate:()=> 'date',reportError:error=>error.message,
        Option:class extends Node{},requestAnimationFrame:fn=>fn(),clearTimeout(){},setTimeout:()=>1,
    };
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(deps),source)(...Object.values(deps));
    return {nodes,form,auth,timeline,window,disabledPhoto,revoked,photo:()=>submittedPhoto,
        data:(items,uid='a')=>onData(items,{uid,state:'ready',fromCache:false}),
        error:onError,resolve:()=>resolve({uid:'a',id:'saved'}),reject:()=>reject(new Error('Denied')),
        writeCount:()=>writes};
}
test('page prevents duplicate sends, waits for acknowledgement and keeps deferred controls disabled',async()=>{
    const h=await pageHarness();
    h.nodes.description.value='A draft';
    const sending=h.form.events.submit({preventDefault(){}});
    await h.form.events.submit({preventDefault(){}});
    assert.equal(h.writeCount(),1);
    assert.doesNotMatch(h.nodes.form_feedback.textContent,/Report submitted/);
    assert.equal(h.nodes.description.disabled,true);
    h.resolve();await sending;
    assert.match(h.nodes.form_feedback.textContent,/Report submitted/);
    assert.equal(h.nodes.description.value,'');
    assert.equal(h.nodes.description.disabled,false);
    assert.equal(h.disabledPhoto.disabled,true);
});
test('page preserves failed drafts and clears private cards/details on account switch',async()=>{
    const h=await pageHarness();
    h.nodes.description.value='Keep my draft';
    const sending=h.form.events.submit({preventDefault(){}});
    h.reject();await sending;
    assert.equal(h.nodes.description.value,'Keep my draft');
    assert.equal(h.nodes.form_feedback.textContent,'Denied');
    h.data([{id:'a-report',issueCategory:'<img onerror=alert(1)>',barangayArea:'Dapawan',locationDescription:'School',issueDescription:'Private',reportStatus:'Received'}]);
    const card=h.nodes.reports_list.children[0];
    assert.equal(card.children[0].children[0].children[0].textContent,'<img onerror=alert(1)>');
    card.children[0].children[1].children[1].onclick();
    assert.equal(h.nodes.detail_description.textContent,'Private');
    h.auth.currentUser={uid:'b'};
    h.data([],'b');
    assert.equal(h.nodes.reports_list.children.length,0);
    assert.equal(h.nodes.detail_description.textContent,'');
    assert.equal(h.nodes.description.value,'');
});
test('late submission success cannot display the previous account reference',async()=>{
    const h=await pageHarness();
    const sending=h.form.events.submit({preventDefault(){}});
    h.auth.currentUser={uid:'b'};h.data([],'b');
    h.resolve();await sending;
    assert.equal(h.nodes.form_feedback.hidden,true);
    assert.doesNotMatch(h.nodes.form_feedback.textContent,/Reference: saved/);
});

test('submission stores only a supplied valid pin as a GeoPoint', async()=>{
    const h=await serviceHarness();
    const saving=h.createTextReport(input,{latitude:12.4,longitude:121.98});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.writes[0].data.geoLocation.latitude,12.4);
    assert.equal(h.writes[0].data.geoLocation.longitude,121.98);
    h.resolve(); await saving;
    await assert.rejects(h.createTextReport(input,{latitude:91,longitude:122}),/valid map pin/);
    assert.equal(h.writes.length,1);
});

test('photo upload starts only after report acknowledgement; failure returns saved report instead of throwing',async()=>{
    let uploads=0;
    const h=await serviceHarness({upload:async()=>{uploads++;throw new Error('network');}});
    const saving=h.createTextReport(input,null,{type:'image/png',size:9});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(uploads,0);
    assert.equal(h.writes[0].data.supportingImageURL,'a/new-report/image');
    h.resolve();
    assert.deepEqual(await saving,{id:'new-report',uid:'a',photoFailed:true});
    assert.equal(h.writes.length,1);assert.equal(uploads,1);
});
test('a rejected report never uploads a photo',async()=>{
    let uploads=0;
    const h=await serviceHarness({upload:async()=>{uploads++;}});
    const saving=h.createTextReport(input,null,{type:'image/png',size:9});
    await new Promise(resolve=>setImmediate(resolve));
    h.reject(new Error('denied'));await assert.rejects(saving,/denied/);assert.equal(uploads,0);
});

test('camera and file selection preview locally, replace and remove safely, and upload only on submit', async () => {
    const h = await pageHarness();
    const first = {name:'camera.jpg'}, second = {name:'gallery.png'};
    h.nodes.report_camera.files = [first]; h.nodes.report_camera.events.change();
    assert.equal(h.nodes.report_photo_preview.src, 'blob:camera.jpg');
    assert.equal(h.writeCount(), 0);
    h.nodes.report_photo.files = [second]; h.nodes.report_photo.events.change();
    assert.deepEqual(h.revoked, ['blob:camera.jpg']);
    h.nodes.report_camera.files = [{name:'bad',invalid:true}]; h.nodes.report_camera.events.change();
    assert.equal(h.nodes.report_photo_preview.src, 'blob:gallery.png');
    const sending = h.form.events.submit({preventDefault(){}});
    assert.equal(h.photo(), second);
    h.resolve(); await sending;
    assert.equal(h.nodes.report_photo_preview.hidden, true);
    assert.deepEqual(h.revoked, ['blob:camera.jpg','blob:gallery.png']);
    h.nodes.report_camera.files = [first]; h.nodes.report_camera.events.change();
    h.nodes.remove_photo.events.click();
    assert.equal(h.nodes.report_photo_preview.hidden, true);
    h.nodes.report_camera.files = [first]; h.nodes.report_camera.events.change();
    h.data([], 'other');
    assert.equal(h.nodes.report_photo_preview.hidden, true);
});

test('report creation batches a matching admin notification with the report', async () => {
    const h = await serviceHarness();
    const pending = h.createTextReport(input); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.writes.length,1); assert.equal(h.notifications.length,1);
    assert.equal(h.notifications[0].data.reportId,h.writes[0].ref.id);
    assert.equal(h.notifications[0].data.kind,'new-report');
    assert.equal(h.notifications[0].data.recipient,'admins');
    h.resolve(); await pending;
});
