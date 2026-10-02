import { onEmployeeAccess } from './employee-access.js';
import { supabaseConfig } from '../supabase/config.js';
import { EmailAuthProvider, reauthenticateWithCredential } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';

const panel = document.getElementById('employeePanel');
const message = document.getElementById('employeeMessage');
const form = document.getElementById('employeeForm');
const list = document.getElementById('employeeList');
const more = document.getElementById('employeeMore');
const refresh = document.getElementById('employeeRefresh');
const dialog = document.getElementById('employeeDialog');
const actionForm = document.getElementById('employeeActionForm');
const actionMessage = document.getElementById('employeeActionMessage');
const editName = document.getElementById('employeeEditName');
const editOffice = document.getElementById('employeeEditOffice');
const password = document.getElementById('employeeTransferPassword');
const confirmation = document.getElementById('employeeTransferConfirmation');
const returnLink = document.getElementById('employeeReturn');
let user, epoch = 0, cursor = null, busy = false, selectedAction = null;
let pendingTransfer = null, completedTransferUid = null;
const controllers = new Set();
function notice(text, tone = '') { message.textContent = text; message.className = 'admin_notice ' + tone; }
function controls(value) {
    busy = value;
    [...panel.querySelectorAll('button, input'), ...dialog.querySelectorAll('button, input')].forEach(item => { item.disabled = value || item.dataset.locked === 'true'; });
}
async function call(body, generation) {
    const transferContext = body.action === 'transfer' ? pendingTransfer : null;
    if (!navigator.onLine) throw new Error('Reconnect to manage employee accounts.');
    const token = await user.getIdToken(body.action === 'transfer');
    if (generation !== epoch) throw new Error('Account access changed.');
    const controller = new AbortController(); controller.transferContext = transferContext; controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(supabaseConfig.url + '/functions/v1/employee-management', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, apikey: supabaseConfig.publishableKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => { throw new Error('Employee service could not respond. Check the function deployment and retry.'); });
        if (generation !== epoch && !(transferContext && pendingTransfer === transferContext && user?.uid === transferContext.uid)) throw new Error('Account access changed.');
        if (!response.ok) throw new Error(data.error || 'Employee service could not complete the request.');
        return data;
    } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Connection interrupted. Refresh the employee list before retrying; your change may already be saved.');
        throw error;
    } finally { clearTimeout(timer); controllers.delete(controller); }
}
function element(tag, content, className = '') {
    const item = document.createElement(tag); item.textContent = content; item.className = className; return item;
}
function render(rows, append) {
    if (!append) list.replaceChildren();
    for (const employee of rows) {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.append(element('strong', employee.fullName || 'Name unavailable'), element('span', employee.emailAddress, 'employee_email'));
        row.append(name, element('td', employee.officeName || 'Not specified'));
        const status = document.createElement('td');
        status.append(element('span', employee.mainAdmin ? 'Main admin' : employee.active ? 'Active' : 'Disabled', 'employee_badge ' + (employee.active ? 'enabled' : 'disabled')));
        row.append(status);
        const actions = document.createElement('td'); actions.className = 'employee_actions';
        if (!employee.mainAdmin) {
            const toggle = element('button', employee.active ? 'Disable access' : 'Enable access'); toggle.type = 'button';
            toggle.addEventListener('click', () => {
                if (employee.active && !confirm(`Disable administrative access for ${employee.fullName || employee.emailAddress}? Their previous work will be preserved.`)) return;
                perform({ action: 'set-active', uid: employee.uid, active: !employee.active });
            });
            const setup = element('button', 'Send setup email'); setup.type = 'button';
            setup.disabled = !employee.active; setup.dataset.locked = String(!employee.active);
            setup.addEventListener('click', () => perform({ action: 'send-setup', uid: employee.uid }));
            const edit = element('button', 'Edit details'); edit.type = 'button';
            edit.addEventListener('click', () => openAction('edit', employee));
            const transfer = element('button', 'Transfer access'); transfer.type = 'button';
            transfer.disabled = !employee.active; transfer.dataset.locked = String(!employee.active);
            transfer.addEventListener('click', () => openAction('transfer', employee));
            actions.append(edit, toggle, setup, transfer);
        } else actions.append(element('span', 'Protected account', 'employee_hint'));
        row.append(actions); list.append(row);
    }
    document.getElementById('employeeEmpty').hidden = list.children.length > 0;
}
async function load(generation, append = false) {
    const data = await call({ action: 'list', ...(append && cursor ? { cursor } : {}) }, generation);
    if (generation !== epoch) return;
    render(data.employees, append); cursor = data.cursor; more.hidden = !cursor;
}
async function perform(body) {
    if (busy || !user || panel.hidden) return;
    const generation = epoch; controls(true); notice('Saving…');
    try {
        const result = await call(body, generation);
        if (generation !== epoch) return;
        if (body.action === 'create') form.reset();
        notice(result.message, result.emailSent === false ? 'warning' : 'success');
        try { await load(generation); }
        catch { if (generation === epoch) notice(result.message + ' Refresh the list to see the latest accounts.', 'warning'); }
    } catch (error) { if (generation === epoch) notice(error.message, 'error'); }
    finally { if (generation === epoch) controls(false); }
}
async function reload(append = false) {
    if (busy || panel.hidden) return;
    const generation = epoch; controls(true); notice('Loading employee accounts…');
    try { await load(generation, append); if (generation === epoch) notice('Employee accounts are up to date.', 'success'); }
    catch (error) { if (generation === epoch) notice(error.message, 'error'); }
    finally { if (generation === epoch) controls(false); }
}
function closeAction() {
    if (dialog.open) dialog.close();
    selectedAction = null; actionForm.reset();
    editName.value = ''; editOffice.value = ''; password.value = ''; confirmation.value = '';
    document.getElementById('employeeTarget').textContent = ''; actionMessage.textContent = '';
}
function openAction(mode, employee) {
    if (busy || panel.hidden || employee.mainAdmin) return;
    selectedAction = { mode, employee }; actionForm.reset(); actionMessage.textContent = '';
    password.value = ''; confirmation.value = '';
    document.getElementById('employeeDialogTitle').textContent = mode === 'edit' ? 'Edit employee details' : 'Transfer main-admin access';
    document.getElementById('employeeTarget').textContent = `${employee.fullName} · ${employee.emailAddress}`;
    document.getElementById('employeeEditFields').hidden = mode !== 'edit';
    document.getElementById('employeeTransferFields').hidden = mode !== 'transfer';
    document.getElementById('employeeActionSave').textContent = mode === 'edit' ? 'Save changes' : 'Confirm transfer';
    editName.value = employee.fullName; editOffice.value = employee.officeName;
    editName.required = editOffice.required = mode === 'edit';
    password.required = confirmation.required = mode === 'transfer';
    dialog.showModal(); (mode === 'edit' ? editName : password).focus();
}
document.getElementById('employeeActionCancel').addEventListener('click', () => { if (!busy) closeAction(); });
dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) closeAction(); });
actionForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selectedAction || panel.hidden || !actionForm.reportValidity()) return;
    const { mode, employee } = selectedAction;
    if (mode === 'transfer' && confirmation.value.trim() !== 'TRANSFER') {
        actionMessage.textContent = 'Type TRANSFER to confirm the handover.'; return;
    }
    const generation = epoch, caller = user;
    let transferContext = null;
    controls(true); actionMessage.className = 'admin_notice';
    actionMessage.textContent = mode === 'transfer' ? 'Confirming your sign-in…' : 'Saving employee details…';
    try {
        let body;
        if (mode === 'transfer') {
            if (!navigator.onLine) throw new Error('Reconnect before transferring access.');
            const credential = EmailAuthProvider.credential(caller.email, password.value);
            password.value = ''; // Password goes only to Firebase Auth, never our function.
            await reauthenticateWithCredential(caller, credential);
            if (generation !== epoch) return;
            transferContext = pendingTransfer = { uid: caller.uid, sent: true };
            body = { action: 'transfer', uid: employee.uid, confirmation: 'TRANSFER' };
            actionMessage.textContent = 'Transferring access…';
        } else {
            body = { action: 'edit', uid: employee.uid, fullName: editName.value, officeName: editOffice.value,
                expectedFullName: employee.fullName, expectedOfficeName: employee.officeName };
        }
        const result = await call(body, generation);
        if (generation !== epoch && !(transferContext && pendingTransfer === transferContext && user?.uid === caller.uid)) return;
        closeAction();
        if (mode === 'transfer') {
            completedTransferUid = caller.uid;
            panel.hidden = true; list.replaceChildren(); form.reset(); returnLink.hidden = false;
            notice(result.message, 'success');
        } else {
            notice(result.message, 'success');
            try { await load(generation); }
            catch { if (generation === epoch) notice('Details saved. Refresh the list to see the changes.', 'warning'); }
        }
    } catch (error) {
        if (generation !== epoch && transferContext && pendingTransfer === transferContext && user?.uid === caller.uid) {
            notice('The transfer could not be confirmed. Ask the selected employee to check their access before trying again.', 'warning');
        }
        if (generation === epoch) {
            actionMessage.className = 'admin_notice error';
            actionMessage.textContent = error.code?.startsWith('auth/')
                ? 'Sign-in could not be confirmed. Check your current password and connection, then retry.' : error.message;
        }
    } finally {
        password.value = '';
        if (generation === epoch) controls(false);
    }
});
form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    perform({ action: 'create', fullName: values.get('fullName'), emailAddress: values.get('emailAddress'), officeName: values.get('officeName') });
});
refresh.addEventListener('click', () => reload()); more.addEventListener('click', () => reload(true));
onEmployeeAccess((allowed, account) => {
    if (allowed === true && user?.uid === account?.uid && !panel.hidden) return;
    ++epoch;
    for (const controller of controllers) {
        // The successful transaction removes our permission before its HTTP reply may arrive.
        // Keep only that handover request alive for the same signed-in account.
        if (!(controller.transferContext && controller.transferContext === pendingTransfer && account?.uid === pendingTransfer.uid)) controller.abort();
    }
    closeAction();
    user = account; panel.hidden = allowed !== true; list.replaceChildren(); form.reset(); cursor = null; controls(false);
    returnLink.hidden = allowed === true;
    if (account?.uid !== pendingTransfer?.uid) pendingTransfer = null;
    if (account?.uid !== completedTransferUid) completedTransferUid = null;
    if (allowed === true) reload();
    else if (allowed === false && completedTransferUid) notice('Main-admin access transferred. Your account is now an ordinary admin.', 'success');
    else if (allowed === false && pendingTransfer?.sent) notice('Your account-management access changed. The handover may have completed; ask the selected employee to open Employee Accounts. You can return to Dashboard.', 'warning');
    else notice(allowed === null ? 'Checking main-admin access…' : 'Main-admin access is required. If your connection dropped, reconnect and reload this page.', allowed === null ? '' : 'error');
});
