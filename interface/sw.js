// Increment the version when changing the offline application shell.
const CACHE_PREFIX = 'odiongan-shell-' + encodeURIComponent(self.registration.scope);
const CACHE_NAME = CACHE_PREFIX + '-v17';
const IMAGE_CACHE = CACHE_PREFIX + '-public-images-v1';
const LOCAL_FILES = [
    "../firebase/announcements.js",
    "../firebase/auth.js",
    "../firebase/client.js",
    "../firebase/config.js",
    "../firebase/offline-cache.mjs",
    "../firebase/report-model.mjs",
    "../firebase/reports.js",
    "../firebase/resident-session.js",
    "../interface/announcement.html",
    "../interface/announcement_loop.js",
    "../interface/announcements.js",
    "../interface/barangay-centers.mjs",
    "../interface/desktop.css",
    "../interface/form_panel.js",
    "../interface/home.html",
    "../interface/home-reports.js",
    "../interface/hotlines.html",
    "../interface/manifest.webmanifest",
    "../interface/offline.js",
    "../interface/profile.html",
    "../interface/report-map.js",
    "../interface/report-photo.js",
    "../interface/signed-out.html",
    "../interface/style.css",
    "../interface/tracking_reports.html",
    "../supabase/config.js",
    "../supabase/report-storage.js",
    "../supabase/storage.js",
    "assets/account.png",
    "assets/account_gray.jpeg",
    "assets/announcement.png",
    "assets/announcement_gray.jpeg",
    "assets/app-192.png",
    "assets/app-512.png",
    "assets/helpline.png",
    "assets/helpline_gray.jpeg",
    "assets/home_icon.jpeg",
    "assets/home_icon.png",
    "assets/hotline_logo/PNP-Logo.png",
    "assets/hotline_logo/ambulance-logo-icon-symbol-first-600nw-2563441177.webp",
    "assets/hotline_logo/images (5).jpg",
    "assets/hotline_logo/images.png",
    "assets/hotline_logo/logo1.jpg",
    "assets/hotline_logo/siren.png",
    "assets/real-time-tracking.png",
    "assets/real-time-tracking_gray.jpeg",
    "assets/undo.png"
];
const SDK_FILES = ['app', 'auth', 'firestore'].map(name => `https://www.gstatic.com/firebasejs/12.18.0/firebase-${name}.js`);
const LOCAL_URLS = new Set(LOCAL_FILES.map(path => new URL(path, self.location.href).href));
const SDK_URLS = new Set(SDK_FILES);
const PUBLIC_IMAGES = /^https:\/\/lpcmwrdizcistkxylsps[.]supabase[.]co\/storage\/v1\/object\/public\/announcement-images\/[A-Za-z0-9_-]{1,128}\/image$/;

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll([...LOCAL_URLS, ...SDK_FILES].map(url => new Request(url, { cache: 'reload', mode: 'cors', credentials: 'same-origin' })));
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => (key.startsWith(CACHE_PREFIX) && ![CACHE_NAME, IMAGE_CACHE].includes(key)) || ['muni-app-v1', 'muni-app-v2'].includes(key)).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});
async function remember(cache, request, response) {
    if (response.ok && ['basic', 'cors', 'default'].includes(response.type)) {
        try { await cache.put(request, response.clone()); } catch { /* Full/disabled storage must not break an online response. */ }
    }
    return response;
}
async function localResponse(request) {
    const cache = await caches.open(CACHE_NAME);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(request, { signal: controller.signal });
        if (!response.ok) throw new Error('Asset unavailable');
        return await remember(cache, request, response);
    } catch {
        return await cache.match(request) || new Response('This page is not available offline. Reconnect and reload.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    } finally { clearTimeout(timeout); }
}
async function publicImage(request) {
    const cache = await caches.open(IMAGE_CACHE);
    try {
        const response = await fetch(new Request(request, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(4000) }));
        if (response.status === 404) { await cache.delete(request); return response; }
        if (!response.ok) throw new Error('Image unavailable');
        await remember(cache, request, response);
        // Bound the public image cache. Private report images never reach this path.
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 20)).map(key => cache.delete(key)));
        return response;
    } catch { return await cache.match(request) || Response.error(); }
}
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('authorization') || request.cache === 'no-store') return;
    if (SDK_URLS.has(request.url)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            return await cache.match(request) || remember(cache, request, await fetch(request));
        })());
    } else if (LOCAL_URLS.has(request.url)) {
        event.respondWith(localResponse(request));
    } else if (request.destination === 'image' && PUBLIC_IMAGES.test(request.url)) {
        event.respondWith(publicImage(request));
    }
    // All auth/Firestore/Edge Function requests, map tiles and unknown URLs bypass us.
});

self.addEventListener('message', event => {
    if (event.data?.type === 'CHECK_OFFLINE_READY') event.source?.postMessage({ type: 'OFFLINE_READY' });
});
