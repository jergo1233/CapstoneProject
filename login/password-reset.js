import { sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getServices } from '../firebase/client.js';

const panel = document.getElementById('passwordReset');
const form = document.getElementById('passwordResetForm');
const email = document.getElementById('resetEmail');
const button = document.getElementById('resetSubmit');
const message = document.getElementById('resetMessage');
const storageKey = 'password-reset-retry-after';
const neutralMessage = 'If this email has an account, a password reset link will arrive shortly. Check your inbox and spam folder.';
let retryAfter = 0;
let busy = false;
try { retryAfter = Number(sessionStorage.getItem(storageKey)) || 0; } catch { /* Storage may be blocked. */ }
// This is a click cooldown, not a server-side abuse protection boundary.
function refreshButton() {
    const seconds = Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000));
    button.disabled = busy || seconds > 0;
    button.textContent = busy ? 'Sending…' : seconds ? `Try again in ${seconds}s` : 'Send reset email';
}
function show(text, state) {
    message.hidden = false;
    message.textContent = text;
    message.dataset.state = state;
}
panel.addEventListener('toggle', () => {
    if (panel.open && !email.value) email.value = (document.getElementById('admin_email') || document.getElementById('email')).value;
});
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || Date.now() < retryAfter || !form.reportValidity()) return;
    if (navigator.onLine === false) {
        show('Connect to the internet to request a reset email.', 'error');
        return;
    }
    const address = email.value.trim();
    busy = true;
    retryAfter = Date.now() + 60000;
    try { sessionStorage.setItem(storageKey, String(retryAfter)); } catch { /* Memory cooldown still applies. */ }
    refreshButton();
    show('Requesting a reset email…', 'pending');
    try {
        const { auth } = await getServices();
        await sendPasswordResetEmail(auth, address);
        show(neutralMessage, 'success');
    } catch (error) {
        if (['auth/user-not-found', 'auth/user-disabled'].includes(error.code)) {
            show(neutralMessage, 'success');
        } else if (error.code === 'auth/too-many-requests') {
            show('Too many requests. Please wait a while before trying again.', 'error');
        } else {
            show('Could not request a reset email. Please try again shortly.', 'error');
        }
    } finally {
        busy = false;
        refreshButton();
    }
});
refreshButton();
setInterval(refreshButton, 1000);
