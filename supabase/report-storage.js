import { getServices } from '../firebase/client.js';
import { supabaseConfig } from './config.js';

export function validateReportPhoto(file) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
        throw new Error('Choose a JPEG, PNG or WebP photo up to 5 MB.');
    }
}
async function request(id, method, file, expectedUid, signal) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid report reference.');
    const { auth } = await getServices();
    const user = auth.currentUser;
    if (!user || user.isAnonymous || user.uid !== expectedUid) throw new Error('Your account changed. Reopen the report.');
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== expectedUid) throw new Error('Your account changed. Reopen the report.');
    const response = await fetch(`${supabaseConfig.url}/functions/v1/image-storage?kind=report&id=${encodeURIComponent(id)}`, {
        method, headers: { apikey: supabaseConfig.publishableKey, Authorization: `Bearer ${token}`, ...(file ? { 'Content-Type': file.type } : {}) },
        body: file || undefined, cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
    });
    if (auth.currentUser?.uid !== expectedUid) throw new Error('Your account changed. Reopen the report.');
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw Object.assign(new Error(body.error || 'The photo request failed. Please retry.'), { status: response.status });
    }
    if (method === 'GET') {
        const blob = await response.blob();
        validateReportPhoto(blob);
        return blob;
    }
}
export async function uploadReportPhoto(id, file, uid, signal) {
    validateReportPhoto(file);
    await request(id, 'POST', file, uid, signal);
}
export function downloadReportPhoto(id, uid, signal) { return request(id, 'GET', null, uid, signal); }
