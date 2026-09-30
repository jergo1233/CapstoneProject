import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildProcessingUpdate, validPin, googleMapsLink, REPORT_BARANGAYS, REPORT_STATUSES, REPORT_PRIORITIES, REPORT_ROUTING, sortReports } from '../firebase/report-model.mjs';
import { BARANGAY_CENTERS } from '../interface/barangay-centers.mjs';
const source = async path => (await readFile(new URL(path,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('processing values validate enums, trim referrals, normalize unassigned fields and reject resident fields',()=>{
    assert.deepEqual(buildProcessingUpdate({reportStatus:'Referred',referredTo:' Engineering '}),{reportStatus:'Referred',referredTo:'Engineering',priorityLevel:null,routingLevel:null});
    for(const patch of [{reportStatus:'Rejected'},{priorityLevel:'Urgent'},{routingLevel:'Auto'},{referredTo:5},{referredTo:'x'.repeat(201)},{submitterID:'other'},{geoLocation:{}}]) {
        assert.throws(()=>buildProcessingUpdate({reportStatus:'Ongoing',...patch}));
    }
});
test('coordinates are finite and Google links contain only the saved coordinates',()=>{
    const pin={latitude:12.4,longitude:121.98};
    assert.equal(new URL(googleMapsLink(pin)).searchParams.get('query'),'12.4,121.98');
    for(const value of [null,{}, {latitude:NaN,longitude:1},{latitude:91,longitude:1},{latitude:1,longitude:181},{latitude:'12',longitude:122}]) {
        assert.ok(!validPin(value)); assert.equal(googleMapsLink(value),null);
    }
    assert.deepEqual(Object.keys(BARANGAY_CENTERS).sort(),[...REPORT_BARANGAYS].sort());
});
async function serviceHarness() {
    const auth={currentUser:{uid:'admin',isAnonymous:false}}, listeners=[], writes=[], notifications=[];
    let authChanged, reportVersion=1, currentRole='Admin';
    const deps={
        getServices:async()=>({auth,db:{}}), onAuthStateChanged:(_,fn)=>{authChanged=fn;fn(auth.currentUser);return()=>{};},
        collection:(_,name)=>name,doc:(_,collection,id)=>collection+'/'+id,
        onSnapshot:(ref,options,next,error)=>{const item={ref,next,error,stopped:false};listeners.push(item);return()=>item.stopped=true;},
        getDoc:async()=>({exists:()=>true,data:()=>({fullName:'Resident Name'})}),
        runTransaction:async(_,fn)=>fn({
            get:async ref=>ref.startsWith('admins/')?{exists:()=>true,data:()=>({role:currentRole})}:{exists:()=>true,data:()=>({submitterID:'resident',issueCategory:'Road',barangayArea:'Dapawan',reportStatus:'Received',referredTo:null,updatedAt:{isEqual:other=>other.version===reportVersion}})},
            update:(ref,data)=>writes.push({ref,data}),
            set:(ref,data)=>notifications.push({ref,data}),
        }),
        serverTimestamp:()=>({server:true}),navigator:{onLine:true},buildProcessingUpdate,sortReports,
    };
    const api=new Function(...Object.keys(deps),await source('../firebase/admin-reports.js')+';return {watchAdminReports,updateAdminReport};')(...Object.values(deps));
    return {...api,auth,listeners,writes,notifications,change:user=>{auth.currentUser=user;authChanged(user);},
        revoke:()=>currentRole='Resident',newVersion:()=>reportVersion++,offline:()=>deps.navigator.onLine=false};
}
const role=(name='Admin',cache=false)=>({metadata:{fromCache:cache},exists:()=>true,data:()=>({role:name})});
const snapshot={metadata:{fromCache:false},docs:[{id:'report',data:()=>({submitterID:'resident'}),metadata:{hasPendingWrites:false}}]};
test('admin watch waits for server role verification; revocation clears private data and stops report reads',async()=>{
    const h=await serviceHarness(),results=[],errors=[];
    const stop=await h.watchAdminReports((items,meta)=>results.push({items,meta}),error=>errors.push(error));
    h.listeners[0].next(role('Admin',true)); assert.equal(h.listeners.length,1);
    h.listeners[0].next(role()); assert.equal(h.listeners[1].ref,'reports');
    h.listeners[1].next(snapshot);await tick();
    assert.equal(results.at(-1).items[0].fullName,'Resident Name');
    h.listeners[0].next(role('Resident'));
    assert.equal(results.at(-1).items.length,0);assert.equal(h.listeners[1].stopped,true);
    h.listeners[1].next(snapshot); assert.equal(results.at(-1).items.length,0);
    assert.equal(errors[0].code,'permission-denied');stop();
});
test('account change and disposal ignore queued report snapshots',async()=>{
    const h=await serviceHarness(),results=[];
    const stop=await h.watchAdminReports((items,meta)=>results.push({items,meta}),()=>{});
    h.listeners[0].next(role()); h.listeners[1].next(snapshot);
    h.change({uid:'other'});const count=results.length;
    h.listeners[1].next(snapshot);await tick();assert.equal(results.length,count);
    stop();h.listeners[2].next(role());assert.equal(h.listeners.length,3);
});
test('transaction saves only processing fields; conflicts, revocation and offline writes fail',async()=>{
    const h=await serviceHarness();
    await h.updateAdminReport('report',{reportStatus:'Ongoing'}, {version:1});
    assert.deepEqual(Object.keys(h.writes[0].data).sort(),['priorityLevel','referredTo','reportStatus','routingLevel','updatedAt'].sort());
    h.newVersion();
    await assert.rejects(h.updateAdminReport('report',{reportStatus:'Resolved'},{version:1}),/changed/);
    h.revoke();
    await assert.rejects(h.updateAdminReport('report',{reportStatus:'Resolved'},{version:2}),/Admin access/);
    h.offline();
    await assert.rejects(h.updateAdminReport('report',{reportStatus:'Resolved'},{version:2}),/offline/);
    assert.equal(h.writes.length,1);
});
class Element {
    constructor(){this.events={};this.children=[];this.style={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';this.classList={add(){},remove(){}};}
    addEventListener(name,fn){this.events[name]=fn;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    add(item){this.append(item);}
    focus(){}
    reset(){}
}
test('map centers without creating a pin; confirmation, dragging, removal and barangay changes are explicit',async()=>{
    const ids=['report_map','location','map_status','confirm_pin','open_map','remove_pin'];
    const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
    let map,marker;
    const window={L:{
        map:()=>map={events:{},on(event,fn){this.events[event]=fn;return this;},setView(center,zoom){this.center=center;this.zoom=zoom;},invalidateSize(){},removeLayer(){marker=null;}},
        tileLayer:()=>({on(){return this;},addTo(){return this;}}),
        marker:latlng=>marker={latlng,events:{},dragging:{disable(){},enable(){}},on(event,fn){this.events[event]=fn;return this;},getLatLng(){return this.latlng;},setLatLng(value){this.latlng=value;},addTo(){return this;}},
    }};
    const create=new Function('document','window','BARANGAY_CENTERS','validPin',await source('../interface/report-map.js')+';return createReportMap;')({getElementById:id=>nodes[id]},window,BARANGAY_CENTERS,validPin);
    const controller=create();
    nodes.location.value='Dapawan';nodes.location.events.change();
    assert.deepEqual(map.center,BARANGAY_CENTERS.Dapawan);assert.equal(controller.getPin(),null);
    map.events.click({latlng:{lat:12.4,lng:121.98}});
    assert.throws(()=>controller.getPin(),/Confirm/);
    nodes.confirm_pin.checked=true;assert.deepEqual(controller.getPin(),{latitude:12.4,longitude:121.98});
    marker.latlng={lat:12.41,lng:121.99};marker.events.dragend();
    assert.equal(nodes.confirm_pin.checked,false);
    controller.setBusy(true);map.events.click({latlng:{lat:1,lng:2}});
    assert.equal(marker.latlng.lat,12.41);
    controller.setBusy(false);
    nodes.location.value='Mayha';nodes.location.events.change();
    assert.equal(controller.getPin(),null);assert.deepEqual(map.center,BARANGAY_CENTERS.Mayha);
    map.events.click({latlng:{lat:12.4,lng:121.98}});nodes.remove_pin.events.click();
    assert.equal(controller.getPin(),null);
    delete window.L;controller.show();assert.match(nodes.map_status.textContent,/could not load/);
});
async function pageHarness(cards = false) {
    const html=await readFile(new URL('../admin_interface/report_management.html',import.meta.url),'utf8');
    const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
    if (cards) { delete nodes.reportsTableBody; nodes.reportsListContainer = new Element(); }
    const viewers = [];
    nodes.processingForm.elements=[nodes.processingStatus,nodes.processingPriority,nodes.processingRouting,nodes.processingReferral];
    nodes.processingForm.reportValidity=()=>true;
    let onData,onError,resolve,reject,writes=0;
    const deps={
        document:{getElementById:id=>nodes[id]||null,createElement:()=>new Element()},
        window:{addEventListener(){},location:{replace(){}}},
        createReportPhotoViewer:()=>{ const viewer = {disposed:false,set(){},clear(){},dispose(){this.disposed=true;}}; viewers.push(viewer); return viewer; },
        Option:class extends Element{},REPORT_STATUSES,REPORT_PRIORITIES,REPORT_ROUTING,reportDate:()=> 'date',googleMapsLink,
        watchAdminReports:async(data,error)=>{onData=data;onError=error;return()=>{};},
        updateAdminReport:()=>{writes++;return new Promise((yes,no)=>{resolve=yes;reject=no;});},
    };
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(deps),await source('../admin_interface/js_dashboardTable/reports_table.js'))(...Object.values(deps));
    return {nodes,viewers,data:(items,meta={uid:'admin',state:'ready'})=>onData(items,meta),error:onError,
        resolve:()=>resolve({uid:'admin'}),reject:()=>reject(new Error('Failed')),writes:()=>writes};
}
const report={id:'report',fullName:'<img onerror=alert(1)>',submitterID:'resident',issueCategory:'Road',barangayArea:'Dapawan',locationDescription:'Landmark',issueDescription:'Private',reportStatus:'Received',updatedAt:{isEqual:()=>true}};
test('admin page renders text safely, retains failed edits and prevents duplicate saves',async()=>{
    const h=await pageHarness();h.data([report]);
    const row=h.nodes.reportsTableBody.children[0];
    assert.equal(row.children[1].textContent,report.fullName);
    row.children[4].children[0].events.click();
    h.nodes.processingStatus.value='Ongoing';h.nodes.processingForm.events.change();
    h.data([report]);assert.equal(h.nodes.processingStatus.value,'Ongoing');
    const saving=h.nodes.processingForm.events.submit({preventDefault(){}});
    await h.nodes.processingForm.events.submit({preventDefault(){}});
    assert.equal(h.writes(),1);
    h.reject();await saving;
    assert.equal(h.nodes.processingStatus.value,'Ongoing');assert.equal(h.nodes.processingFeedback.textContent,'Failed');
    h.data([],{uid:'other',state:'checking'});
    assert.equal(h.nodes.editorDetails.children.length,0);assert.equal(h.nodes.reportEditor.hidden,true);
});

test('report cards reuse previews across updates and dispose them on filtering or lost access', async () => {
    const h = await pageHarness(true);
    h.data([report]);
    const card = h.nodes.reportsListContainer.children[0];
    assert.equal(card.children[0].children[0].textContent, report.fullName);
    assert.equal(card.children[2].children[0].textContent, 'View details');
    const preview = card.children[1];
    h.data([{...report, reportStatus:'Ongoing'}]);
    assert.equal(h.nodes.reportsListContainer.children[0].children[1], preview);
    assert.equal(h.viewers.length, 2);
    h.nodes.residentSearchInput.value = 'no-match';
    h.nodes.residentSearchInput.events.input();
    assert.equal(h.viewers[1].disposed, true);
    h.nodes.residentSearchInput.value = '';
    h.nodes.residentSearchInput.events.input();
    h.error({code:'permission-denied'});
    assert.equal(h.viewers[2].disposed, true);
    assert.equal(h.nodes.reportsListContainer.children.length, 0);
});

test('Received reports stay highlighted when opened and lose the highlight after status updates', async () => {
    const h = await pageHarness();
    h.data([report]);
    let row = h.nodes.reportsTableBody.children[0];
    assert.equal(row.className, 'report_awaiting_review');
    assert.equal(row.children[6].children[0].textContent, 'Awaiting review');
    row.children[4].children[0].events.click();
    h.data([report]);
    assert.equal(h.nodes.reportsTableBody.children[0].className, 'report_awaiting_review');
    h.data([{...report, reportStatus:'For Verification'}]);
    row = h.nodes.reportsTableBody.children[0];
    assert.equal(row.className, '');
    assert.equal(row.children[6].children.length, 0);
    h.data([{...report, pending:true}]);
    assert.equal(h.nodes.reportsTableBody.children[0].className, '');
});

test('processing sends resident events for status/referral changes, not priority-only edits',async()=>{
    const h=await serviceHarness();
    await h.updateAdminReport('report',{reportStatus:'Received',priorityLevel:'High'},{version:1});
    assert.equal(h.notifications.length,0);
    await h.updateAdminReport('report',{reportStatus:'Ongoing'},{version:1});
    assert.equal(h.notifications[0].data.recipient,'resident');
    assert.equal(h.notifications[0].data.reportStatus,'Ongoing');
    await h.updateAdminReport('report',{reportStatus:'Received',referredTo:'Engineering'},{version:1});
    assert.equal(h.notifications[1].data.referredTo,'Engineering');
});
