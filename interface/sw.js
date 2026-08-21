const CACHE_NAME = "muni-app-v2";
const NETWORK_FIRST_DESTINATIONS = new Set(["document", "script", "style"]);

function isCacheable(response) {
  return response && response.status === 200 && response.type === "basic";
}

async function cacheResponse(request, response) {
  if (isCacheable(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with form submissions or other non-GET requests.
  if (request.method !== "GET") return;

  const isFreshnessCritical =
    request.mode === "navigate" || NETWORK_FIRST_DESTINATIONS.has(request.destination);

  if (isFreshnessCritical) {
    // Pages, scripts, and styles should update immediately during development.
    // If offline, the last successful version remains available from the cache.
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Images and other assets load quickly from cache, then are saved after a
  // successful first network request for future offline use.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(request).then((response) => cacheResponse(request, response));
    }),
  );
});
