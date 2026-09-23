import { watchAdminReports } from '../../firebase/admin-reports.js';
import { REPORT_CATEGORIES, REPORT_BARANGAYS } from '../../firebase/report-model.mjs';
import { summarizeReports } from '../../firebase/analytics-model.mjs';

function adminNotice(node, text, tone = 'pending') {
    node.className = 'admin_notice notice-' + tone;
    node.textContent = text;
}


const node = id => document.getElementById(id);
const inputs = ['dateFrom', 'dateTo', 'categoryFilter', 'barangayFilter'];
let reports = [], ready = false, cached = false, stop, generation = 0, exporting = false;
let summary, scope = '', charts = [], accessVersion = 0;
for (const [id, values] of [['categoryFilter', REPORT_CATEGORIES], ['barangayFilter', REPORT_BARANGAYS]]) {
    for (const value of values) node(id).add(new Option(value, value));
}
function clear() {
    summary = null;
    node('analyticsResults').hidden = true;
    node('analyticsCounts').replaceChildren();
    charts.forEach(chart => chart.destroy()); charts = [];
    node('exportAnalytics').disabled = true;
}
function chart(id, rows, line = false) {
    charts.push(new window.Chart(node(id), {
        type: line ? 'line' : 'bar',
        data: { labels: rows.map(row => row.label), datasets: [{ label: 'Reports', data: rows.map(row => row.count), backgroundColor: '#466c98', borderColor: '#466c98', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: line ? 'x' : 'y',
            plugins: { legend: { display: false } },
            scales: { [line ? 'y' : 'x']: { beginAtZero: true, ticks: { precision: 0 } } } },
    }));
}
function render() {
    clear();
    if (!ready) return;
    try {
        const filters = { from: node('dateFrom').value, to: node('dateTo').value, category: node('categoryFilter').value, barangay: node('barangayFilter').value };
        summary = summarizeReports(reports, filters);
        scope = `Submitted: ${filters.from || 'earliest'} through ${filters.to || 'latest'} · Barangay: ${filters.barangay || 'All'} · Category: ${filters.category || 'All'}`;
        node('analyticsScope').textContent = scope;
        node('analyticsResults').hidden = false;
        for (const item of [{ label: 'Total', count: summary.total }, ...summary.statuses]) {
            const card = document.createElement('div'); card.className = 'stat_card';
            const label = document.createElement('span'); label.textContent = item.label;
            const count = document.createElement('h2'); count.textContent = item.count;
            card.append(label, count); node('analyticsCounts').append(card);
        }
        node('timelineNote').textContent = `${summary.monthly ? 'Monthly' : 'Daily'} submissions. Days without submissions count as zero.${summary.undated ? ` ${summary.undated} report(s) have no valid submission date and are omitted from the timeline.` : ''}`;
        const messages = [];
        if (cached) messages.push('Showing cached reports; totals may be incomplete. Reconnecting…');
        if (!summary.total) messages.push('No reports match these filters.');
        if (typeof window.Chart === 'function') {
            chart('categoryChart', summary.categories); chart('barangayChart', summary.barangays); chart('timelineChart', summary.timeline, true);
        } else messages.push('Charts could not load. Summary counts and PDF tables are still available. Reload when connected to retry charts.');
        adminNotice(node('analyticsFeedback'), messages.join(' ') || 'Reports are up to date.', messages.length ? 'pending' : 'success');
        node('exportAnalytics').disabled = exporting || cached;
    } catch (error) {
        clear(); adminNotice(node('analyticsFeedback'), error.message, 'error');
    }
}
async function connect() {
    const current = ++generation;
    stop?.(); stop = null; ready = false; reports = []; clear();
    node('retryAnalytics').hidden = true;
    adminNotice(node('analyticsFeedback'), 'Loading analytics…', 'pending');
    const fail = error => {
        if (current !== generation) return;
        ready = false; reports = []; clear();
        adminNotice(node('analyticsFeedback'), error.code === 'permission-denied' ? 'Admin access is required to view analytics.' : 'Unable to load analytics. Check your connection and retry.', 'error');
        node('retryAnalytics').hidden = false;
    };
    try {
        const unsubscribe = await watchAdminReports((items, meta) => {
            if (current !== generation) return;
            if (meta.state !== 'ready') ++accessVersion;
            ready = meta.state === 'ready'; cached = Boolean(meta.fromCache); reports = ready ? items : [];
            if (meta.state === 'signed-out') { clear(); window.location.replace(/^\/admin(?:\/|$)/.test(window.location.pathname || '') ? '/admin' : 'admin_login/admin.html'); return; }
            render();
            if (!ready) adminNotice(node('analyticsFeedback'), 'Waiting for admin access verification…', 'pending');
            if (ready) node('retryAnalytics').hidden = true;
        }, fail, { includeNames: false });
        if (current !== generation) unsubscribe(); else stop = unsubscribe;
    } catch (error) { fail(error); }
}
inputs.forEach(id => node(id).addEventListener('change', render));
node('resetFilters').addEventListener('click', () => { inputs.forEach(id => node(id).value = ''); render(); });
node('retryAnalytics').addEventListener('click', connect);
window.addEventListener('pagehide', () => { ++generation; stop?.(); ready = false; reports = []; clear(); });
window.addEventListener('pageshow', event => { if (event.persisted) connect(); });

// Export a fixed aggregate snapshot, with readable tables that do not split tall charts.
// No resident names, descriptions, IDs, images or precise locations enter the PDF.
node('exportAnalytics').addEventListener('click', async () => {
    if (!ready || cached || !summary || exporting) return;
    if (typeof window.html2pdf !== 'function') { adminNotice(node('analyticsFeedback'), 'PDF tools could not load. Reconnect and reload the page.', 'error'); return; }
    exporting = true; node('exportAnalytics').disabled = true;
    const version = generation, access = accessVersion, snapshot = summary;
    const sheet = document.createElement('div');
    sheet.style.cssText = 'box-sizing:border-box;padding:16px;font:12px Arial;color:#111;background:white;width:100%;max-width:680px;';
    const text = (tag, value) => {
        const element = document.createElement(tag);
        // Override the dashboard's global paragraph flex/nowrap styles in the PDF.
        element.style.cssText = 'display:block;white-space:normal;overflow-wrap:anywhere;max-width:100%;';
        element.textContent = value;
        sheet.append(element);
    };
    text('h1', 'Odiongan report analytics'); text('p', scope);
    text('p', 'Generated: ' + new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' (Philippine time)');
    text('p', `Total: ${snapshot.total}. Statuses are current; dates refer to submission. Counts represent submitted reports.`);
    if (snapshot.undated) text('p', `${snapshot.undated} undated report(s) omitted from timeline.`);
    for (const [title, rows] of [['Processing status', snapshot.statuses], ['Category', snapshot.categories], ['Barangay', snapshot.barangays], [snapshot.monthly ? 'Monthly submissions' : 'Daily submissions', snapshot.timeline]]) {
        text('h2', title);
        const table = document.createElement('table'); table.style.cssText = 'width:100%;border-collapse:collapse;';
        for (const row of rows) {
            const tr = document.createElement('tr'); tr.style.breakInside = 'avoid';
            for (const value of [row.label, row.count]) { const td = document.createElement('td'); td.textContent = value; td.style.cssText = 'padding:5px;border-bottom:1px solid #ddd;'; tr.append(td); }
            table.append(tr);
        }
        sheet.append(table);
    }
    try {
        const worker = window.html2pdf().set({ filename: 'Odiongan_Analytics.pdf', margin: 10, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'] } }).from(sheet).toPdf();
        await worker;
        if (version !== generation || access !== accessVersion || !ready) throw new Error('Access changed. Export cancelled.');
        await worker.save();
    } catch (error) { adminNotice(node('analyticsFeedback'), error.message || 'PDF export failed. Please retry.', 'error'); }
    finally { exporting = false; node('exportAnalytics').disabled = !ready || cached || !summary; }
});
await connect();
