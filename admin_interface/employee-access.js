import { getServices } from '../firebase/client.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

let access = null, currentUser = null, generation = 0, stopRole, stopAuth, disposed = false;
const subscribers = new Set();
function publish(value, user) {
    access = value; currentUser = user;
    document.querySelectorAll('[data-employee-nav]').forEach(link => { link.hidden = value !== true; });
    for (const callback of subscribers) callback(value, user);
}
export function onEmployeeAccess(callback) {
    subscribers.add(callback); callback(access, currentUser);
    return () => subscribers.delete(callback);
}
getServices().then(({ auth, db }) => {
    if (disposed) return;
    stopAuth = onAuthStateChanged(auth, user => {
        const epoch = ++generation; stopRole?.(); publish(null, user);
        if (!user || user.isAnonymous) { publish(false, user); return; }
        stopRole = onSnapshot(doc(db, 'admins', user.uid), { includeMetadataChanges: true }, profile => {
            if (disposed || epoch !== generation || profile.metadata.fromCache) return;
            const data = profile.exists() ? profile.data() : null;
            publish(data?.role === 'Admin' && data.active !== false && data.canManageEmployees === true, user);
        }, () => { if (!disposed && epoch === generation) publish(false, user); });
    });
}).catch(() => { if (!disposed) publish(false, null); });
window.addEventListener('pagehide', () => { disposed = true; ++generation; stopRole?.(); stopAuth?.(); publish(false, null); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
