import { createReportPhotoViewer } from './report-photo.js';
import { validateReportPhoto } from '../supabase/report-storage.js';
import { createReportMap } from './report-map.js';
import { getServices } from '../firebase/client.js';
import { createTextReport, watchOwnReports } from '../firebase/reports.js';
import { REPORT_CATEGORIES, REPORT_BARANGAYS, reportDate, reportError, googleMapsLink } from '../firebase/report-model.mjs';

function noticeTone(node, tone) {
    node.classList.remove('notice-pending', 'notice-success', 'notice-error', 'notice-info');
    node.classList.add('notice-' + tone);
}

const form = document.getElementById('report_form');
const list = document.getElementById('reports_list');
const historyFeedback = document.getElementById('history_feedback');
const retry = document.getElementById('reports_retry');
const feedback = document.getElementById('form_feedback');
const overlay = document.getElementById('form_overlay');
const formPanel = document.getElementById('form_panel');
const details = document.getElementById('details_panel');
const photoViewer = createReportPhotoViewer(document.getElementById('detail_attachments'));
const photoInput = document.getElementById('report_photo');
const photoFeedback = document.getElementById('photo_feedback');
const cameraInput = document.getElementById('report_camera');
const photoPreview = document.getElementById('report_photo_preview');
let selectedPhoto = null, previewURL = null;
function clearSelectedPhoto() {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null; selectedPhoto = null;
    photoInput.value = ''; cameraInput.value = '';
    photoPreview.removeAttribute('src'); photoPreview.hidden = true;
    photoFeedback.textContent = '';
}
for (const input of [photoInput, cameraInput]) {
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file || saving) return;
        try {
            validateReportPhoto(file);
            const nextURL = URL.createObjectURL(file);
            clearSelectedPhoto();
            selectedPhoto = file; previewURL = nextURL;
            photoPreview.src = previewURL; photoPreview.hidden = false;
            noticeTone(photoFeedback, 'success');
            photoFeedback.textContent = 'Selected: ' + file.name + '. Ready to upload when you submit.';
        } catch (error) {
            input.value = ''; noticeTone(photoFeedback, 'error');
            photoFeedback.textContent = error.message + (selectedPhoto ? ' Your previous photo is still selected.' : '');
        }
    });
}
document.getElementById('take_report_photo').addEventListener('click', () => {
    if (!saving) cameraInput.click();
});
document.getElementById('remove_photo').addEventListener('click', () => { if (!saving) clearSelectedPhoto(); });
form.addEventListener('reset', clearSelectedPhoto);
let reports = new Map();
let selectedId = null;
let linkedReportId = new URLSearchParams((window.location?.hash || '').slice(1)).get('report');
let ownerUid = null;
let saving = false;
let starting = false;
let stop;
let subscription = 0;
let closeTimer;
let focusBeforeModal;

function element(tag, className, value = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
}
function populateSelect(id, values, placeholder) {
    const select = document.getElementById(id);
    select.replaceChildren();
    const first = new Option(placeholder, '', true, true);
    first.disabled = true;
    select.add(first);
    for (const value of values) select.add(new Option(value, value));
}
populateSelect('category', REPORT_CATEGORIES, 'Select category');
populateSelect('location', REPORT_BARANGAYS, 'Select barangay');
const reportMap = createReportMap();

function showPanel(panel) {
    clearTimeout(closeTimer);
    focusBeforeModal = document.activeElement;
    for (const other of [formPanel, details]) {
        other.style.display = other === panel ? 'block' : 'none';
        other.classList.remove('show');
    }
    overlay.style.display = 'block';
    requestAnimationFrame(() => { panel.classList.add('show'); overlay.classList.add('show'); });
    panel.querySelector('button')?.focus();
    if (panel === formPanel) setTimeout(() => reportMap.show(), 320);
}
function closePanels(force = false) {
    if (saving && !force) return;
    clearTimeout(closeTimer);
    for (const panel of [formPanel, details, overlay]) panel.classList.remove('show');
    closeTimer = setTimeout(() => {
        for (const panel of [formPanel, details, overlay]) panel.style.display = 'none';
    }, 300);
    selectedId = null; photoViewer.clear();
    focusBeforeModal?.focus();
}
// Keep the existing HTML button hooks, backed by real report data.
window.toggleFormView = show => show ? showPanel(formPanel) : closePanels();
window.closeAllModals = () => closePanels();
window.closeDetailsModal = () => closePanels();

function statusClass(status) {
    return ({ Received: 'badge_received', 'For Verification': 'badge_verification', Referred: 'badge_referral',
        Ongoing: 'badge_ongoing', Resolved: 'badge_resolved', 'Not Within LGU Jurisdiction': 'badge_not_lgu' })[status] || 'badge_received';
}
function renderDetails(report) {
    document.getElementById('detail_report_id').textContent = report.id;
    document.getElementById('detail_category').textContent = report.issueCategory;
    document.getElementById('detail_location').textContent = `${report.barangayArea} — ${report.locationDescription}`;
    document.getElementById('detail_description').textContent = report.issueDescription;
    const badge = document.getElementById('detail_status');
    badge.textContent = report.pending ? 'Sending — not yet confirmed' : report.reportStatus;
    badge.className = `badge ${statusClass(report.reportStatus)}`;
    const timeline = document.querySelector('.timeline_container');
    timeline.replaceChildren();
    // The schema records creation/latest update, not a full status history.
    // Never infer that verification/referral occurred just because it is resolved.
    const entries = [['Submitted', reportDate(report.timestamp)], ['Latest update — ' + report.reportStatus, reportDate(report.updatedAt)]];
    for (const [label, date] of entries) {
        const item = element('div', 'timeline_item active');
        const content = element('div', 'timeline_content');
        content.append(element('h4', '', label), element('p', '', date));
        item.append(element('div', 'timeline_node'), content);
        timeline.append(item);
    }
    document.getElementById('detail_processing').textContent = 'Priority: ' + (report.priorityLevel || 'Not assigned') + ' · Routing: ' + (report.routingLevel || 'Not assigned') + ' · Referral: ' + (report.referredTo || 'Not assigned');
    const link = document.getElementById('detail_map_link');
    const url = googleMapsLink(report.geoLocation);
    link.hidden = !url;
    if (url) link.href = url; else link.removeAttribute('href');
    photoViewer.set(report);
}
function renderReports(items) {
    list.replaceChildren();
    for (const report of items) {
        const card = element('div', 'data_card');
        const row = element('div', 'card_header_flex');
        const info = element('div', 'card_info');
        info.append(element('h4', 'card_category', report.issueCategory),
            element('p', 'card_location', `${report.barangayArea} — ${report.locationDescription}`),
            element('p', 'card_desc', report.issueDescription), element('div', 'card_date', reportDate(report.timestamp)));
        const controls = element('div', 'detail_status');
        const badge = element('span', `badge ${statusClass(report.reportStatus)}`, report.pending ? 'Sending — not yet confirmed' : report.reportStatus);
        const button = element('button', 'btn_text', 'View Details');
        button.type = 'button';
        button.onclick = () => { selectedId = report.id; renderDetails(reports.get(report.id)); showPanel(details); };
        controls.append(badge, button);
        row.append(info, controls); card.append(row); list.append(card);
    }
    if (selectedId) {
        if (reports.has(selectedId)) renderDetails(reports.get(selectedId));
        else closePanels(true);
    }
}
function clearPrivateData() {
    reports.clear(); list.replaceChildren();
    const link = document.getElementById('detail_map_link');
    link.hidden = true; link.removeAttribute('href');
    for (const id of ['detail_report_id', 'detail_category', 'detail_location', 'detail_description', 'detail_status', 'detail_attachments', 'detail_processing']) document.getElementById(id).textContent = '';
    document.querySelector('.timeline_container').replaceChildren();
    closePanels(true);
}
async function startHistory() {
    if (starting) return;
    starting = true; retry.disabled = true;
    const current = ++subscription;
    stop?.();
    noticeTone(historyFeedback, 'pending');
    historyFeedback.textContent = 'Loading your reports…';
    try {
        stop = await watchOwnReports((items, meta) => {
            if (current !== subscription) return;
            if (ownerUid !== meta.uid) {
                clearPrivateData(); form.reset(); reportMap.reset(); feedback.hidden = true;
                ownerUid = meta.uid;
            }
            if (meta.state !== 'ready') {
                if (meta.state === 'signed-out') clearPrivateData();
                noticeTone(historyFeedback, meta.state === 'signed-out' ? 'info' : 'pending');
                historyFeedback.textContent = meta.state === 'signed-out' ? 'Sign in to view your reports.' : 'Loading your reports…';
                return;
            }
            reports = new Map(items.map(report => [report.id, report]));
            renderReports(items);
            // Open only a report returned by the authenticated owner's query.
            if (linkedReportId && reports.has(linkedReportId)) {
                selectedId = linkedReportId; linkedReportId = null;
                renderDetails(reports.get(selectedId)); showPanel(details);
            }
            noticeTone(historyFeedback, meta.fromCache ? 'pending' : 'info');
            historyFeedback.textContent = meta.fromCache
                ? (items.length ? 'Showing saved reports. Reconnect for the latest information.' : (navigator.onLine ? 'Connecting to your reports…' : 'No reports saved in this session. Connect to load them.'))
                : (items.length ? '' : 'You have not submitted any reports yet.');
            retry.hidden = !meta.fromCache;
        }, error => {
            if (current !== subscription) return;
            if (['permission-denied', 'unauthenticated'].includes(error.code)) clearPrivateData();
            noticeTone(historyFeedback, 'error'); historyFeedback.textContent = reportError(error); retry.hidden = false;
        });
    } catch (error) { noticeTone(historyFeedback, 'error'); historyFeedback.textContent = reportError(error); retry.hidden = false; }
    finally { starting = false; retry.disabled = false; }
}
retry.addEventListener('click', startHistory);
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    const input = {
        issueCategory: document.getElementById('category').value,
        barangayArea: document.getElementById('location').value,
        locationDescription: document.getElementById('location_description').value,
        issueDescription: document.getElementById('description').value,
    };
    let pin;
    try { pin = reportMap.getPin(); }
    catch (error) { feedback.hidden = false; feedback.classList.add('error'); noticeTone(feedback, 'error'); feedback.textContent = error.message; return; }
    saving = true;
    const controls = [...form.elements].filter(control => !control.disabled);
    controls.forEach(control => control.disabled = true);
    reportMap.setBusy(true);
    feedback.classList.remove('error'); noticeTone(feedback, 'pending'); feedback.hidden = false;
    feedback.textContent = 'Sending your report… Keep this page open until submission is confirmed.';
    const submissionUid = ownerUid;
    try {
        const result = await createTextReport(input, pin, selectedPhoto);
        const { auth } = await getServices();
        if (auth.currentUser?.uid !== result.uid || ownerUid !== submissionUid) return;
        form.reset(); reportMap.reset();
        noticeTone(feedback, result.photoFailed ? 'pending' : 'success');
        feedback.textContent = `Report submitted. Reference: ${result.id}. Status: Received.` + (result.photoFailed ? ' Your photo upload was not confirmed. Open View Details to reload or retry the photo; do not submit another report.' : '');
    } catch (error) {
        if (ownerUid !== submissionUid) return;
        feedback.classList.add('error'); noticeTone(feedback, 'error'); feedback.textContent = reportError(error);
    } finally {
        saving = false;
        controls.forEach(control => control.disabled = false);
        reportMap.setBusy(false);
    }
});
window.addEventListener('beforeunload', event => {
    if (saving) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('offline', () => {
    noticeTone(historyFeedback, 'pending');
    historyFeedback.textContent = 'You are offline. Loaded reports may be out of date.';
    retry.hidden = false;
});
window.addEventListener('online', () => { if (!retry.hidden) void startHistory(); });
await startHistory();
