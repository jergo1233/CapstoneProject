import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReports, submissionDay } from '../firebase/analytics-model.mjs';
import { REPORT_CATEGORIES, REPORT_STATUSES } from '../firebase/report-model.mjs';
const report = (date, extra = {}) => ({ timestamp: { toMillis: () => Date.parse(date) }, issueCategory: REPORT_CATEGORIES[0], barangayArea: 'Dapawan', reportStatus: 'Received', ...extra });
test('Philippine date boundaries are inclusive, independent of device timezone', () => {
    const rows = [report('2026-09-13T15:59:59Z'), report('2026-09-13T16:00:00Z'), report('2026-09-14T15:59:59Z'), report('2026-09-14T16:00:00Z')];
    const summary = summarizeReports(rows, { from: '2026-09-14', to: '2026-09-14' });
    assert.equal(summary.total, 2); assert.deepEqual(summary.timeline, [{ label: '2026-09-14', count: 2 }]);
    assert.equal(submissionDay(null), null);
});
test('all aggregates share exact category and barangay filters; pending writes excluded', () => {
    const rows = REPORT_STATUSES.map(reportStatus => report('2026-09-14', { reportStatus }));
    rows.push(report('2026-09-14', { barangayArea: 'Dapawan extension' }), report('2026-09-14', { issueCategory: REPORT_CATEGORIES[1] }), report('2026-09-14', { pending: true }));
    const summary = summarizeReports(rows, { barangay: 'Dapawan', category: REPORT_CATEGORIES[0] });
    assert.equal(summary.total, 6); assert.deepEqual(summary.statuses.map(r => r.count), [1,1,1,1,1,1]);
    for (const key of ['categories', 'barangays', 'timeline']) assert.equal(summary[key].reduce((sum, r) => sum + r.count, 0), 6);
});
test('timeline fills zero days and months and uses submission rather than last-edit dates', () => {
    const rows = [report('2026-01-01', { updatedAt: { toMillis: () => Date.parse('2026-09-14') } }), report('2026-01-03')];
    assert.deepEqual(summarizeReports(rows).timeline.map(r => r.count), [1,0,1]);
    const summary = summarizeReports(rows, { from: '2026-01-01', to: '2026-04-30' });
    assert.equal(summary.monthly, true); assert.deepEqual(summary.timeline.map(r => r.count), [2,0,0,0]);
});
test('empty data, undated records, invalid and reversed dates are handled explicitly', () => {
    assert.equal(summarizeReports([]).total, 0);
    assert.deepEqual(summarizeReports([]).timeline, []);
    const rows = [{ reportStatus: 'Received' }];
    assert.equal(summarizeReports(rows).undated, 1);
    assert.equal(summarizeReports(rows, { from: '2026-01-01' }).total, 0);
    assert.throws(() => summarizeReports([], { from: '2026-02-30' }), /valid/);
    assert.throws(() => summarizeReports([], { from: '2026-09-15', to: '2026-09-14' }), /start/);
});

import { readFile } from 'node:fs/promises';
import { REPORT_BARANGAYS } from '../firebase/report-model.mjs';
class Element {
    constructor() { this.value = ''; this.events = {}; this.children = []; this.style = {}; this.hidden = false; }
    addEventListener(name, fn) { this.events[name] = fn; }
    append(...items) { this.children.push(...items); }
    add(item) { this.append(item); }
    replaceChildren() { this.children = []; }
}
test('analytics page clears on access changes, distinguishes failures from zero, and recovers PDF controls', async () => {
    const html = await readFile(new URL('../admin_interface/analytics.html', import.meta.url), 'utf8');
    const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
    let data, failure, names, destroyed = 0;
    const window = { addEventListener() {}, location: { replace() {} }, Chart: class { destroy() { destroyed++; } } };
    const deps = { document: { getElementById: id => nodes[id], createElement: () => new Element() }, window,
        Option: class {}, REPORT_CATEGORIES, REPORT_BARANGAYS, summarizeReports,
        watchAdminReports: async (onData, onError, options) => { data = onData; failure = onError; names = options.includeNames; return () => {}; } };
    const source = (await readFile(new URL('../admin_interface/js_dashboardTable/analytics.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction(...Object.keys(deps), source)(...Object.values(deps));
    assert.equal(names, false);
    data([], { state: 'ready', fromCache: false });
    assert.match(nodes.analyticsFeedback.textContent, /No reports/);
    data([report('2026-09-14')], { state: 'ready', fromCache: true });
    assert.match(nodes.analyticsFeedback.textContent, /cached/); assert.equal(nodes.exportAnalytics.disabled, true);
    data([report('2026-09-14')], { state: 'ready', fromCache: false });
    window.html2pdf = () => ({ set() { return this; }, from() { return this; }, toPdf() { return Promise.reject(new Error('Export failed')); } });
    await nodes.exportAnalytics.events.click();
    assert.equal(nodes.exportAnalytics.disabled, false); assert.match(nodes.analyticsFeedback.textContent, /Export failed/);
    data([], { state: 'checking' });
    assert.equal(nodes.analyticsResults.hidden, true); assert.equal(nodes.analyticsCounts.children.length, 0); assert.ok(destroyed > 0);
    failure({ code: 'permission-denied' });
    assert.match(nodes.analyticsFeedback.textContent, /Admin access/); assert.equal(nodes.exportAnalytics.disabled, true);
});
