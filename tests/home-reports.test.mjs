import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
class Element {
    constructor() { this.children = []; this.events = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.events[event] = callback; }
}
test('Home limits reports, encodes links, preserves cached rows and clears private rows on account/access changes', async () => {
    const nodes = Object.fromEntries(['homeReports', 'homeReportsFeedback', 'homeReportsRetry', 'homeReportsNote'].map(id => [id, new Element()]));
    let data, error;
    const source = (await readFile(new URL('../interface/home-reports.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
    const run = Object.getPrototypeOf(async function() {}).constructor;
    await new run('document', 'window', 'watchOwnReports', 'reportDate', 'reportError', source)(
        {getElementById:id=>nodes[id], createElement:()=>new Element()},
        {addEventListener(){}},
        async (onData, onError) => { data = onData; error = onError; return () => {}; },
        ()=>'date', ()=>'Failed'
    );
    const reports = Array.from({length:6}, (_, i)=>({id:'report/' + i, issueCategory:'<img onerror=x>', barangayArea:'Dapawan', reportStatus:'Received'}));
    data(reports, {state:'ready', fromCache:false});
    assert.equal(nodes.homeReports.children.length, 5);
    assert.equal(nodes.homeReportsNote.hidden, false);
    const row = nodes.homeReports.children[0].children[0];
    assert.equal(row.href, 'tracking_reports.html#report=report%2F0');
    assert.equal(row.children[0].children[0].textContent, '<img onerror=x>');
    data(reports, {state:'ready', fromCache:true});
    assert.match(nodes.homeReportsFeedback.textContent, /saved reports/);
    error({code:'unavailable'});
    assert.equal(nodes.homeReports.children.length, 5);
    error({code:'permission-denied'});
    assert.equal(nodes.homeReports.children.length, 0);
    data(reports, {state:'ready'});
    data([], {state:'loading', uid:'different-owner'});
    assert.equal(nodes.homeReports.children.length, 0);
    data([], {state:'ready', fromCache:true});
    assert.match(nodes.homeReportsFeedback.textContent, /No reports saved/);
    data([], {state:'ready', fromCache:false});
    assert.match(nodes.homeReportsFeedback.textContent, /not submitted/);
});
