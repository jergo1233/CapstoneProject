import { watchAdminReports } from '../../firebase/admin-reports.js';
import { summarizeReports } from '../../firebase/analytics-model.mjs';
const node = id => document.getElementById(id);
let stop, generation = 0;
function text(tag, value, className = '') {
    const item = document.createElement(tag); item.textContent = value; item.className = className; return item;
}
function clear() {
    node('summaryResults').hidden = true;
    node('awaitingReview').textContent = '';
    node('summaryCounts').replaceChildren(); node('summaryTrend').replaceChildren();
    node('summaryTrendNote').textContent = '';
}
function notice(message, tone = 'pending') {
    node('summaryFeedback').textContent = message;
    node('summaryFeedback').className = 'admin_notice notice-' + tone;
}
function render(reports, cached) {
    clear();
    const summary = summarizeReports(reports);
    const received = summary.statuses.find(item => item.label === 'Received')?.count || 0;
    node('awaitingReview').textContent = `Awaiting review: ${received}${cached ? ' (saved count)' : ''}`;
    for (const item of [{label:'Total',count:summary.total}, ...summary.statuses]) {
        const card = text('div', '', 'stat_card');
        card.append(text('span',item.label),text('h2',String(item.count)));
        node('summaryCounts').append(card);
    }
    const to = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
    const from = new Date(Date.parse(to) - 13 * 86400000).toISOString().slice(0,10);
    const trend = summarizeReports(reports,{from,to});
    const peak = Math.max(1,...trend.timeline.map(row=>row.count));
    for (const row of trend.timeline) {
        const line = text('div','','summary_bar_row');
        const track = text('span','','summary_bar_track');
        const bar = text('span','','summary_bar_fill'); bar.style.width = (row.count / peak * 100) + '%';
        track.append(bar);
        line.append(text('span',row.label),track,text('strong',String(row.count)));
        node('summaryTrend').append(line);
    }
    node('summaryTrendNote').textContent = `${from} through ${to} · Philippine time · ${trend.total} reports.${summary.undated ? ` ${summary.undated} undated reports excluded from the trend.` : ''}`;
    node('summaryResults').hidden = false;
    notice(cached ? 'Showing loaded reports; totals may be incomplete. Reconnecting…' : (summary.total ? 'Reports are up to date.' : 'No reports have been submitted yet.'),cached ? 'pending' : 'success');
}
async function connect() {
    const current = ++generation; stop?.(); clear();
    node('summaryRetry').hidden = true; notice('Checking admin access…');
    const fail = error => {
        if (current !== generation) return;
        clear(); notice(error.code === 'permission-denied' ? 'Admin access is required to view this summary.' : 'Unable to load the summary. Check your connection and retry.','error');
        node('summaryRetry').hidden = false;
    };
    try {
        const unsubscribe = await watchAdminReports((items,meta)=>{
            if (current !== generation) return;
            if (meta.state !== 'ready') {
                clear(); notice('Waiting for admin access verification…');
                if (meta.state === 'signed-out') window.location.replace(/^\/admin(?:\/|$)/.test(window.location.pathname || '') ? '/admin' : 'admin_login/admin.html');
                return;
            }
            render(items,meta.fromCache);
        },fail,{includeNames:false});
        if (current !== generation) unsubscribe(); else stop = unsubscribe;
    } catch (error) { fail(error); }
}
node('summaryRetry').addEventListener('click',connect);
window.addEventListener('pagehide',()=>{++generation;stop?.();clear();});
window.addEventListener('pageshow',event=>{if(event.persisted) void connect();});
await connect();
