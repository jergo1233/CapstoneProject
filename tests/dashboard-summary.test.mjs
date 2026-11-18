import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeReports } from '../firebase/analytics-model.mjs';
class Element {
    constructor(){this.children=[];this.style={};this.events={};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    addEventListener(event,fn){this.events[event]=fn;}
}
test('dashboard shows summary and bounded trend, marks cache, and clears on denied access/history exit',async()=>{
    const nodes=Object.fromEntries(['awaitingReview','summaryResults','summaryCounts','summaryTrend','summaryTrendNote','summaryFeedback','summaryRetry'].map(id=>[id,new Element()]));
    let data,error,options;const events={};
    const source=(await readFile(new URL('../admin_interface/js_dashboardTable/dashboard-summary.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
    const run=Object.getPrototypeOf(async function(){}).constructor;
    await new run('document','window','watchAdminReports','summarizeReports',source)(
        {getElementById:id=>nodes[id],createElement:()=>new Element()},
        {addEventListener:(event,fn)=>events[event]=fn,location:{pathname:'/admin/dashboard',replace(){}}},
        async(next,fail,opts)=>{data=next;error=fail;options=opts;return()=>{};},summarizeReports);
    assert.equal(options.includeNames,false);
    const reports=[{reportStatus:'Received',timestamp:{toMillis:()=>Date.now()}},{reportStatus:'Resolved',timestamp:{toMillis:()=>Date.now()}}];
    data(reports,{state:'ready',fromCache:false});
    assert.equal(nodes.summaryCounts.children[0].children[1].textContent,'2');
    assert.equal(nodes.summaryTrend.children.length,14);
    assert.equal(nodes.awaitingReview.textContent,'Awaiting review: 1');
    data(reports,{state:'ready',fromCache:true});assert.match(nodes.summaryFeedback.textContent,/incomplete/);
    error({code:'permission-denied'});assert.equal(nodes.summaryResults.hidden,true);assert.equal(nodes.awaitingReview.textContent,'');assert.equal(nodes.summaryCounts.children.length,0);
    data(reports,{state:'ready'});events.pagehide();
    data(reports,{state:'ready'});assert.equal(nodes.summaryCounts.children.length,0);
});
