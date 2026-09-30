import { getServices } from './client.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { collection, doc, getDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { buildProcessingUpdate, sortReports } from './report-model.mjs';

export async function watchAdminReports(onData, onError, { includeNames = true } = {}) {
    const { auth, db } = await getServices();
    let generation = 0, stopRole, stopReports, active = false, disposed = false;
    let reports = [], names = new Map();
    const clear = () => {
        active = false; stopReports?.(); stopReports = null;
        reports = []; names.clear();
    };
    const stopAuth = onAuthStateChanged(auth, user => {
        const current = ++generation;
        stopRole?.(); clear();
        onData([], { uid: user?.uid || null, state: 'checking' });
        if (!user || user.isAnonymous) {
            onData([], { uid: null, state: 'signed-out' }); return;
        }
        const valid = () => !disposed && generation === current && auth.currentUser?.uid === user.uid;
        const fail = error => {
            if (!valid()) return;
            clear(); onData([], { uid: user.uid, state: 'blocked' }); onError(error);
        };
        // A live role watch clears report data immediately on known revocation.
        // Wait for a server role result before displaying cached private reports.
        stopRole = onSnapshot(doc(db, 'admins', user.uid), { includeMetadataChanges: true }, role => {
            if (!valid() || role.metadata.fromCache) return;
            if (!role.exists() || role.data().role !== 'Admin') {
                fail(Object.assign(new Error('Admin access is required.'), { code: 'permission-denied' })); return;
            }
            if (active) return;
            active = true;
            const emit = meta => {
                if (valid() && active) onData(reports.map(report => ({
                    ...report, fullName: names.get(report.submitterID) || 'Resident profile unavailable',
                })), { uid: user.uid, state: 'ready', ...meta });
            };
            let metadata = {};
            stopReports = onSnapshot(collection(db, 'reports'), { includeMetadataChanges: true }, snapshot => {
                if (!valid() || !active) return;
                reports = sortReports(snapshot.docs.map(item => ({ ...item.data(), id: item.id, pending: item.metadata.hasPendingWrites })));
                metadata = { fromCache: snapshot.metadata.fromCache };
                emit(metadata);
                for (const uid of (includeNames ? new Set(reports.map(report => report.submitterID)) : [])) {
                    if (typeof uid !== 'string' || !uid || uid.includes('/') || names.has(uid)) continue;
                    names.set(uid, 'Loading resident name…');
                    getDoc(doc(db, 'residents', uid)).then(profile => {
                        if (!valid() || !active) return;
                        names.set(uid, profile.exists() ? profile.data().fullName || 'Resident profile unavailable' : 'Resident profile unavailable');
                        emit(metadata);
                    }).catch(error => {
                        if (!valid() || !active) return;
                        if (['permission-denied', 'unauthenticated'].includes(error.code)) { fail(error); return; }
                        names.set(uid, 'Resident name unavailable — retry loading'); emit(metadata);
                    });
                }
            }, fail);
        }, fail);
    });
    return () => { disposed = true; ++generation; stopAuth(); stopRole?.(); clear(); };
}

export async function updateAdminReport(id, input, expectedUpdatedAt) {
    if (!navigator.onLine) throw new Error('You are offline. Reconnect before saving.');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid report reference.');
    const update = buildProcessingUpdate(input);
    const { auth, db } = await getServices();
    const uid = auth.currentUser?.uid;
    if (!uid || auth.currentUser.isAnonymous) throw new Error('Sign in with an admin account.');
    const notification = doc(collection(db, 'notifications'));
    await runTransaction(db, async transaction => {
        const role = await transaction.get(doc(db, 'admins', uid));
        if (!role.exists() || role.data().role !== 'Admin' || auth.currentUser?.uid !== uid) throw new Error('Admin access is required.');
        const target = doc(db, 'reports', id);
        const report = await transaction.get(target);
        if (!report.exists()) throw new Error('This report is no longer available.');
        if (!expectedUpdatedAt || !report.data().updatedAt?.isEqual(expectedUpdatedAt)) {
            throw new Error('This report changed since you opened it. Reload its saved values before updating.');
        }
        if (auth.currentUser?.uid !== uid) throw new Error('Your account changed. Please reopen the report.');
        transaction.update(target, { ...update, updatedAt: serverTimestamp() });
        const previous = report.data();
        if (previous.reportStatus !== update.reportStatus || (previous.referredTo || null) !== update.referredTo) {
            transaction.set(notification, {
                kind: 'report-update', reportId: id, recipient: previous.submitterID,
                category: previous.issueCategory, barangay: previous.barangayArea,
                reportStatus: update.reportStatus, referredTo: update.referredTo,
                createdAt: serverTimestamp(),
            });
        }
    });
    return { uid };
}
