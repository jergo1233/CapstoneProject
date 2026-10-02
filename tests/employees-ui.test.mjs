import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(){this.children=[];this.events={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.open=false;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 focus(){}
 reportValidity(){return true;}
 addEventListener(name,fn){this.events[name]=fn;}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 reset(){this.resets=(this.resets||0)+1;}
 querySelectorAll(){return this.children.flatMap(child=>[child,...child.querySelectorAll()]);}
}
async function setup(){
 const html=await readFile(new URL('../admin_interface/employees.html',import.meta.url),'utf8');
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
 const requests=[],reauth=[],refreshTokens=[];let reauthError;let access;let responder=async()=>Response.json({employees:[{uid:'staff',fullName:'<img src=x>',emailAddress:'staff@test.invalid',officeName:'PIO',active:true,mainAdmin:false},{uid:'main',fullName:'Main',active:true,mainAdmin:true}],cursor:null});
 const deps={document:{getElementById:id=>nodes[id],createElement:()=>new Element()},navigator:{onLine:true},
 EmailAuthProvider:{credential:(email,password)=>({email,password})},reauthenticateWithCredential:async(user,credential)=>{reauth.push(credential);if(reauthError)throw reauthError;},
 onEmployeeAccess:fn=>{access=fn;fn(null,null);},supabaseConfig:{url:'https://test.invalid',publishableKey:'public'},
 fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return responder();},AbortController,setTimeout,clearTimeout,confirm:()=>true,
 FormData:class{get(key){return {fullName:'New',emailAddress:'new@test.invalid',officeName:'PIO'}[key];}}};
 const source=(await readFile(new URL('../admin_interface/employees.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 new Function(...Object.keys(deps),source)(...Object.values(deps));
 return {nodes,requests,reauth,refreshTokens,set reauthError(error){reauthError=error;},access:(allowed,uid='main')=>access(allowed,{uid,email:uid+'@test.invalid',getIdToken:async force=>{refreshTokens.push(force);return 'verified';}}),set responder(fn){responder=fn;}};
}
test('only main admin loads employee data; renders text safely and protects main-admin actions',async()=>{
 const h=await setup();h.access(false);await tick();assert.equal(h.requests.length,0);assert.equal(h.nodes.employeePanel.hidden,true);
 h.access(true);await tick();assert.equal(h.requests[0].action,'list');
 const rows=h.nodes.employeeList.children;assert.equal(rows[0].children[0].children[0].textContent,'<img src=x>');
 assert.equal(rows[1].children[3].children[0].textContent,'Protected account');
 h.access(false);assert.equal(h.nodes.employeeList.children.length,0);assert.equal(h.nodes.employeePanel.hidden,true);
});
test('late employee list responses are discarded after permission loss',async()=>{
 const h=await setup();let complete;h.responder=()=>new Promise(resolve=>complete=resolve);
 h.access(true);await tick();h.access(false);
 complete(Response.json({employees:[{uid:'private',fullName:'Private',active:true}],cursor:null}));await tick();
 assert.equal(h.nodes.employeeList.children.length,0);assert.equal(h.nodes.employeePanel.hidden,true);
});
test('duplicate create clicks are blocked and email failure remains visible after refresh',async()=>{
 const h=await setup();h.access(true);await tick();let complete;
 h.responder=()=>new Promise(resolve=>complete=resolve);
 h.nodes.employeeForm.events.submit({preventDefault(){}});h.nodes.employeeForm.events.submit({preventDefault(){}});await tick();
 assert.equal(h.requests.filter(item=>item.action==='create').length,1);
 h.responder=async()=>Response.json({employees:[],cursor:null});
 complete(Response.json({ok:true,emailSent:false,message:'Employee created, but email failed.'}));await tick();await tick();
 assert.match(h.nodes.employeeMessage.textContent,/email failed/);assert.match(h.nodes.employeeMessage.className,/warning/);
});

function actionButton(h,label) {return h.nodes.employeeList.children[0].children[3].children.find(item=>item.textContent===label);}
test('editing prefills current details and submits no email or privilege changes',async()=>{
 const h=await setup();h.access(true);await tick();actionButton(h,'Edit details').events.click();
 assert.equal(h.nodes.employeeDialog.open,true);assert.equal(h.nodes.employeeEditName.value,'<img src=x>');
 h.nodes.employeeEditName.value='Updated';h.nodes.employeeEditOffice.value='Engineering';
 await h.nodes.employeeActionForm.events.submit({preventDefault(){}});
 const request=h.requests.find(item=>item.action==='edit');assert.deepEqual(request,{action:'edit',uid:'staff',fullName:'Updated',officeName:'Engineering',expectedFullName:'<img src=x>',expectedOfficeName:'PIO'});
 assert.equal(h.nodes.employeeDialog.open,false);
});
test('handover confirms password with Firebase, refreshes token, never sends password to function',async()=>{
 const h=await setup();h.access(true);await tick();actionButton(h,'Transfer access').events.click();
 h.nodes.employeeTransferPassword.value='test-password';h.nodes.employeeTransferConfirmation.value='TRANSFER';
 h.responder=async()=>Response.json({ok:true,message:'Main-admin access transferred.'});
 await h.nodes.employeeActionForm.events.submit({preventDefault(){}});
 assert.deepEqual(h.reauth,[{email:'main@test.invalid',password:'test-password'}]);assert.equal(h.refreshTokens.at(-1),true);
 assert.deepEqual(h.requests.at(-1),{action:'transfer',uid:'staff',confirmation:'TRANSFER'});
 assert.equal(h.nodes.employeeTransferPassword.value,'');assert.equal(h.nodes.employeePanel.hidden,true);assert.equal(h.nodes.employeeReturn.hidden,false);
 h.access(false);assert.match(h.nodes.employeeMessage.textContent,/transferred/);
});
test('incorrect password prevents transfer and clears password input',async()=>{
 const h=await setup();h.access(true);await tick();actionButton(h,'Transfer access').events.click();
 h.reauthError={code:'auth/invalid-credential'};h.nodes.employeeTransferPassword.value='wrong';h.nodes.employeeTransferConfirmation.value='TRANSFER';
 await h.nodes.employeeActionForm.events.submit({preventDefault(){}});
 assert.equal(h.requests.some(item=>item.action==='transfer'),false);assert.equal(h.nodes.employeeTransferPassword.value,'');assert.equal(h.nodes.employeeDialog.open,true);
 assert.match(h.nodes.employeeActionMessage.textContent,/Sign-in could not/);
});
test('role loss before handover response clears list but permits confirmation of own transaction',async()=>{
 const h=await setup();h.access(true);await tick();actionButton(h,'Transfer access').events.click();
 h.nodes.employeeTransferPassword.value='test-password';h.nodes.employeeTransferConfirmation.value='TRANSFER';
 let complete;h.responder=()=>new Promise(resolve=>complete=resolve);
 const sending=h.nodes.employeeActionForm.events.submit({preventDefault(){}});await tick();
 h.access(false);assert.equal(h.nodes.employeeList.children.length,0);assert.equal(h.nodes.employeeDialog.open,false);
 complete(Response.json({ok:true,message:'Main-admin access transferred.'}));await sending;
 assert.equal(h.nodes.employeeMessage.textContent,'Main-admin access transferred.');assert.match(h.nodes.employeeMessage.className,/success/);
});
test('account change discards late handover confirmation and clears entered password',async()=>{
 const h=await setup();h.access(true);await tick();actionButton(h,'Transfer access').events.click();
 h.nodes.employeeTransferPassword.value='test-password';h.nodes.employeeTransferConfirmation.value='TRANSFER';
 let complete;h.responder=()=>new Promise(resolve=>complete=resolve);
 const sending=h.nodes.employeeActionForm.events.submit({preventDefault(){}});await tick();h.access(false,'other');
 complete(Response.json({ok:true,message:'Main-admin access transferred.'}));await sending;
 assert.ok(!h.nodes.employeeMessage.textContent.includes('transferred'));assert.equal(h.nodes.employeeTransferPassword.value,'');
});
