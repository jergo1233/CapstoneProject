import { getServices } from '../firebase/client.js';
import { supabaseConfig } from './config.js';

const validId = /^[A-Za-z0-9_-]{1,128}$/;
export function announcementImageURL(id) {
    if (!validId.test(id)) throw new Error('Invalid announcement ID.');
    return `${supabaseConfig.url}/storage/v1/object/public/announcement-images/${id}/image`;
}
async function imageRequest(id, method, file) {
    announcementImageURL(id); // Validate before constructing the request URL.
    const { auth } = await getServices();
    if (!auth.currentUser) throw new Error('Please sign in before managing images.');
    const token = await auth.currentUser.getIdToken();
    let response;
    try {
        response = await fetch(`${supabaseConfig.url}/functions/v1/image-storage?id=${encodeURIComponent(id)}`, {
            method,
            headers: {
                apikey: supabaseConfig.publishableKey,
                Authorization: `Bearer ${token}`,
                ...(file ? { 'Content-Type': file.type } : {}),
            },
            body: file || undefined,
            cache: 'no-store',
        });
    } catch {
        throw Object.assign(new Error('Cannot reach image storage. Check your connection and retry.'), { code: 'storage/network-error' });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || 'Image storage is not ready. Check the Edge Function deployment and configuration.');
        error.code = response.status === 401 || response.status === 403 ? 'storage/unauthorized' : 'storage/request-failed';
        throw error;
    }
    return data;
}
export async function uploadAnnouncementImage(id, file) {
    await imageRequest(id, 'POST', file);
    return announcementImageURL(id);
}
export async function deleteAnnouncementImage(id) {
    await imageRequest(id, 'DELETE');
}
