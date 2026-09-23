import { createReportPhotoViewer } from '../../interface/report-photo.js';
import { watchAdminReports, updateAdminReport } from '../../firebase/admin-reports.js';
import { REPORT_STATUSES, REPORT_PRIORITIES, REPORT_ROUTING, reportDate, googleMapsLink } from '../../firebase/report-model.mjs';

function adminNotice(node, text, tone = 'pending') {
    node.className = 'admin_notice notice-' + tone;
    node.textContent = text;
}


const byId = id => document.getElementById(id);
const photoViewer = createReportPhotoViewer(byId('editorPhoto'));
const table = byId('reportsTableBody'), cards = byId('reportsListContainer');
const previews = new Map();
function clearPreviews() {
    for (const entry of previews.values()) entry.viewer.dispose();
    previews.clear();
}
const message = byId('reportsFeedback'), retry = byId('reportsRetry');
const modal = byId('reportEditor'), form = byId('processingForm'), feedback = byId('processingFeedback');
let reports = [], selected = null, expectedVersion = null, dirty = false, saving = false;
let uid = null, epoch = 0, stop, starting = false, allowed = false;

function node(tag, text = '', className = '') {
    const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
function button(text, action, className = 'btn_update') {
    const result = node('button', text, className); result.type = 'button'; result.addEventListener('click', action); return result;
}
function options(id, values, optional = false) {
    const select = byId(id);
    if (optional) select.add(new Option('Not assigned', ''));
    values.forEach(value => select.add(new Option(value, value)));
}
options('processingStatus', REPORT_STATUSES);
options('processingPriority', REPORT_PRIORITIES, true);
options('processingRouting', REPORT_ROUTING, true);
function locationLink(report) {
    const url = googleMapsLink(report.geoLocation);
    if (!url) return node('span', 'No map pin supplied');
    const link = node('a', 'Open in Google Maps'); link.href = url;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function showDetails(report, resetDraft = false) {
    byId('editorTitle').textContent = 'Report ' + report.id;
    const details = byId('editorDetails'); details.replaceChildren();
    for (const [label, value] of [
        ['Resident', report.fullName], ['Resident UID', report.submitterID], ['Category', report.issueCategory],
        ['Barangay', report.barangayArea], ['Landmark', report.locationDescription],
        ['Description', report.issueDescription], ['Submitted', reportDate(report.timestamp)],
        ['Last updated', reportDate(report.updatedAt)], ['Saved status', report.reportStatus],
    ]) details.append(node('p', label + ': ' + (value || 'Not available')));
    details.append(locationLink(report));
    photoViewer.set(report);
    if (resetDraft) {
        byId('processingStatus').value = report.reportStatus;
        byId('processingPriority').value = report.priorityLevel || '';
        byId('processingRouting').value = report.routingLevel || '';
        byId('processingReferral').value = report.referredTo || '';
        expectedVersion = report.updatedAt; dirty = false;
    }
}
function openReport(id) {
    const report = reports.find(item => item.id === id);
    if (!allowed || !report || saving) return;
    selected = id; adminNotice(feedback, '', 'pending'); showDetails(report, true);
    modal.hidden = false; modal.classList.add('active'); byId('processingStatus').focus();
}
function closeEditor(force = false) {
    if (saving && !force) return;
    modal.hidden = true; modal.classList.remove('active');
    photoViewer.clear();
    selected = null; expectedVersion = null; dirty = false;
    form.reset(); byId('editorDetails').replaceChildren(); adminNotice(feedback, '', 'pending');
    byId('editorTitle').textContent = '';
}
function render() {
    const query = byId('residentSearchInput').value.trim().toLowerCase();
    const filtered = reports.filter(report => [report.fullName, report.id, report.issueCategory, report.barangayArea, report.reportStatus]
        .some(value => String(value || '').toLowerCase().includes(query)));
    table?.replaceChildren(); cards?.replaceChildren();
    const visible = new Set(filtered.map(report => report.id));
    for (const [id, entry] of previews) {
        if (!visible.has(id)) { entry.viewer.dispose(); previews.delete(id); }
    }
    for (const report of filtered) {
        if (table) {
            const row = node('tr');
            for (const value of [report.id, report.fullName, report.issueCategory, report.barangayArea + ' — ' + report.locationDescription]) row.append(node('td', value));
            const detail = node('td'); detail.append(button('View details / process', () => openReport(report.id)));
            row.append(detail, node('td', reportDate(report.timestamp)), node('td', report.pending ? 'Saving — not confirmed' : report.reportStatus));
            table.append(row);
        }
        if (cards) {
            const card = node('article', '', 'report_card');
            const text = node('div', '', 'report_card_text');
            text.append(node('h2', report.fullName, 'resident_name'));
            for (const [label, value] of [
                ['Report', report.id], ['Category', report.issueCategory],
                ['Location', report.barangayArea + ' — ' + report.locationDescription],
                ['Description', report.issueDescription], ['Status', report.pending ? 'Saving — not confirmed' : report.reportStatus],
                ['Priority', report.priorityLevel || 'Not assigned'], ['Routing', report.routingLevel || 'Not assigned'],
                ['Referral', report.referredTo || 'Not assigned'], ['Submitted', reportDate(report.timestamp)],
            ]) {
                const field = node('p', '', ['Report', 'Submitted'].includes(label) ? 'report_field report_metadata' : 'report_field');
                const caption = node('strong', label + ': ', 'report_field_label');
                const content = node('span', value);
                if (label === 'Status' || label === 'Priority') {
                    const tones = label === 'Status' ? {
                        'Received': 'blue', 'For Verification': 'amber', 'Referred': 'purple',
                        'Ongoing': 'blue', 'Resolved': 'green', 'Not Within LGU Jurisdiction': 'neutral',
                        'Saving — not confirmed': 'amber',
                    } : { 'High': 'red', 'Medium': 'amber', 'Low': 'green' };
                    content.className = 'report_badge report_badge_' + (tones[value] || 'neutral');
                }
                field.append(caption, content); text.append(field);
            }
            text.append(locationLink(report));
            let preview = previews.get(report.id);
            if (!preview) {
                const container = node('div', '', 'report_card_photo');
                preview = { container, viewer: createReportPhotoViewer(container, { preview: true }) };
                previews.set(report.id, preview);
            }
            preview.viewer.set(report);
            const actions = node('div', '', 'report_card_actions');
            actions.append(button('View details', () => openReport(report.id)));
            card.append(text, preview.container, actions);
            cards.append(card);
        }
    }
    if (!filtered.length) {
        if (table) { const row = node('tr'), cell = node('td', query ? 'No matching reports.' : 'No reports available.'); cell.colSpan = 7; row.append(cell); table.append(row); }
        if (cards) cards.append(node('p', query ? 'No matching reports.' : 'No reports available.'));
    }
    if (selected) {
        const report = reports.find(item => item.id === selected);
        if (!report) { closeEditor(true); return; }
        if (!saving) {
            showDetails(report, !dirty);
            if (dirty && !report.updatedAt?.isEqual(expectedVersion)) adminNotice(feedback, 'This report changed. Reload saved values before updating.', 'pending');
        }
    }
}
function clear() {
    allowed = false; ++epoch; reports = [];
    clearPreviews();
    table?.replaceChildren(); cards?.replaceChildren(); closeEditor(true);
}
async function start() {
    if (starting) return;
    starting = true; retry.disabled = true; stop?.(); clear();
    const current = epoch;
    adminNotice(message, 'Checking admin access…', 'pending');
    try {
        stop = await watchAdminReports((items, meta) => {
            if (current !== epoch) return;
            uid = meta.uid;
            if (meta.state === 'signed-out') { clear(); window.location.replace(/^\/admin(?:\/|$)/.test(window.location.pathname || '') ? '/admin' : 'admin_login/admin.html'); return; }
            if (meta.state !== 'ready') {
                allowed = false; reports = []; clearPreviews(); table?.replaceChildren(); cards?.replaceChildren(); closeEditor(true);
                adminNotice(message, meta.state === 'blocked' ? 'Admin access is unavailable.' : 'Checking admin access…', 'pending'); return;
            }
            allowed = true; reports = items; render();
            adminNotice(message, meta.fromCache ? 'Showing loaded reports. Waiting for the latest information…' : '', 'pending');
            retry.hidden = !meta.fromCache;
        }, error => {
            if (current !== epoch) return;
            allowed = false; reports = []; clearPreviews(); table?.replaceChildren(); cards?.replaceChildren(); closeEditor(true);
            adminNotice(message, error.code === 'permission-denied' ? 'Admin access was denied. Check your role and the published rules.' : 'Reports could not load. Check your connection and retry.', 'error');
            retry.hidden = false;
        });
    } catch {
        adminNotice(message, 'Reports could not load. Check your connection and retry.', 'error'); retry.hidden = false;
    } finally { starting = false; retry.disabled = false; }
}
byId('residentSearchInput').addEventListener('input', render);
retry.addEventListener('click', start);
byId('closeEditor').addEventListener('click', () => closeEditor());
modal.addEventListener('click', event => { if (event.target === modal) closeEditor(); });
byId('reloadProcessing').addEventListener('click', () => {
    const report = reports.find(item => item.id === selected);
    if (report && !saving) { showDetails(report, true); adminNotice(feedback, 'Loaded current saved values.', 'success'); }
});
form.addEventListener('input', () => { dirty = true; });
form.addEventListener('change', () => { dirty = true; });
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!allowed || saving || !selected || !form.reportValidity()) return;
    const id = selected, sessionUid = uid, current = epoch;
    const input = {
        reportStatus: byId('processingStatus').value, priorityLevel: byId('processingPriority').value,
        routingLevel: byId('processingRouting').value, referredTo: byId('processingReferral').value,
    };
    saving = true; [...form.elements].forEach(control => control.disabled = true);
    adminNotice(feedback, 'Saving… Keep this page open until confirmed.', 'pending');
    try {
        const result = await updateAdminReport(id, input, expectedVersion);
        if (!allowed || current !== epoch || sessionUid !== uid || result.uid !== uid || selected !== id) return;
        dirty = false;
        const latest = reports.find(report => report.id === id);
        if (latest) showDetails(latest, true);
        adminNotice(feedback, 'Changes saved.', 'success');
    } catch (error) {
        if (allowed && current === epoch && sessionUid === uid && selected === id) {
            adminNotice(feedback, error.code ? 'Changes were not saved. Check your connection and admin access, then retry.' : error.message, 'error');
        }
    } finally { saving = false; [...form.elements].forEach(control => control.disabled = false); }
});
window.addEventListener('beforeunload', event => {
    if (saving || dirty) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('online', () => { if (!allowed) void start(); });
await start();
