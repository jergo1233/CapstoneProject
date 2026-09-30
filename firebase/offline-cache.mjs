// Resident snapshots persist across restarts only after explicit device opt-in.
// This is display data, never an authorization source or an offline write queue.
const KEY = 'odiongan-resident-snapshot-v1';
const DEVICE_KEY = 'odiongan-remember-resident';
let owner = null;
function rememberedUid() {
    try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
function snapshotStorage() {
    return rememberedUid() ? localStorage : sessionStorage;
}
export function configureOfflinePersistence(uid, remember = false) {
    clearOfflinePrivate();
    if (remember) localStorage.setItem(DEVICE_KEY, uid);
    owner = uid;
}
function read() {
    try { return JSON.parse(snapshotStorage().getItem(KEY)) || {}; } catch { return {}; }
}
function write(value) {
    try { snapshotStorage().setItem(KEY, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearOfflinePrivate() {
    owner = null;
    try { sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
    try { localStorage.removeItem(KEY); localStorage.removeItem(DEVICE_KEY); } catch { /* Storage may be disabled. */ }
}
export function setOfflineOwner(uid) {
    const saved = read();
    if (!uid || (saved.uid && saved.uid !== uid) || (rememberedUid() && rememberedUid() !== uid)) clearOfflinePrivate();
    owner = uid || null;
}
function encode(value) {
    if (value?.toMillis) return { offlineTimestamp: value.toMillis() };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
    return value;
}
function decode(value) {
    if (value && Number.isFinite(value.offlineTimestamp)) {
        const ms = value.offlineTimestamp;
        return { toMillis: () => ms, toDate: () => new Date(ms) };
    }
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
    return value;
}
export function readOffline(uid, kind) {
    const saved = read();
    return uid && uid === owner && saved.uid === uid && saved[kind] !== undefined ? decode(saved[kind]) : null;
}
export function saveOffline(uid, kind, value) {
    if (!uid || uid !== owner) return false;
    const saved = read();
    return write({ ...(saved.uid === uid ? saved : {}), uid, [kind]: encode(value) });
}
export function removeOffline(uid, kind) {
    if (uid !== owner) return;
    const saved = read();
    if (saved.uid === uid) { delete saved[kind]; write(saved); }
}
