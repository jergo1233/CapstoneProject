import { readOffline, saveOffline, removeOffline } from './offline-cache.mjs';
import { validateReportPhoto, uploadReportPhoto } from '../supabase/report-storage.js';
import { getServices } from './client.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { collection, doc, writeBatch, query, where, onSnapshot, serverTimestamp, GeoPoint } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { buildTextReport, sortReports, validPin } from './report-model.mjs';

export async function createTextReport(input, pin = null, photo = null) {
    if (photo) validateReportPhoto(photo);
    const { auth, db } = await getServices();
    const user = auth.currentUser;
    if (!user || user.isAnonymous) throw new Error('Please sign in with your resident account.');
    if (!navigator.onLine) throw new Error('You are offline. Reconnect before submitting your report.');
    const report = buildTextReport(input, user.uid, serverTimestamp());
    if (pin !== null) {
        if (!validPin(pin)) throw new Error('Choose a valid map pin.');
        report.geoLocation = new GeoPoint(pin.latitude, pin.longitude);
    }
    const target = doc(collection(db, 'reports'));
    if (photo) report.supportingImageURL = user.uid + '/' + target.id + '/image';
    const batch = writeBatch(db);
    batch.set(target, report);
    batch.set(doc(db, 'notifications', target.id), {
        kind: 'new-report', reportId: target.id, recipient: 'admins',
        category: report.issueCategory, barangay: report.barangayArea,
        createdAt: serverTimestamp(),
    });
    await batch.commit();
    // Once the report exists, a photo failure must never cause a duplicate report retry.
    let photoFailed = false;
    if (photo) {
        try { await uploadReportPhoto(target.id, photo, user.uid); }
        catch { photoFailed = true; }
    }
    return { id: target.id, uid: user.uid, ...(photoFailed ? { photoFailed: true } : {}) };
}

export async function watchOwnReports(onData, onError) {
    const { auth, db } = await getServices();
    let stopReports;
    let generation = 0;
    const stopAuth = onAuthStateChanged(auth, user => {
        const current = ++generation;
        stopReports?.();
        stopReports = null;
        // Clear old account records before starting any new query.
        onData([], { state: 'loading', uid: user?.uid || null });
        if (!user || user.isAnonymous) {
            onData([], { state: 'signed-out', uid: null });
            return;
        }
        let saved = readOffline(user.uid, 'reports');
        if (saved) onData(sortReports(saved), { state: 'ready', uid: user.uid, fromCache: true });
        // Rules are not filters: never subscribe to the entire reports collection.
        // Sort the owner's results locally so this step needs no composite index.
        const own = query(collection(db, 'reports'), where('submitterID', '==', user.uid));
        stopReports = onSnapshot(own, { includeMetadataChanges: true }, snapshot => {
            if (current !== generation || auth.currentUser?.uid !== user.uid) return;
            const reports = snapshot.docs.map(item => ({ ...item.data(), id: item.id, pending: item.metadata.hasPendingWrites }));
            if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && !reports.some(item => item.pending)) {
                // Keep text and processing fields, not private photo bytes or precise map pins.
                saved = reports.map(({ geoLocation, ...text }) => text);
                saveOffline(user.uid, 'reports', saved);
            }
            if (snapshot.metadata.fromCache && saved) return;
            onData(sortReports(reports), { state: 'ready', uid: user.uid, fromCache: snapshot.metadata.fromCache });
        }, error => {
            if (current === generation && auth.currentUser?.uid === user.uid) {
                if (['permission-denied', 'unauthenticated'].includes(error.code)) removeOffline(user.uid, 'reports');
                onError(error);
            }
        });
    });
    return () => { ++generation; stopReports?.(); stopAuth(); };
}
