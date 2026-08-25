// T-context (2026-08-26, owner's ask: mobile PWA layout, Task C --
// installability): hand-rolled, not vite-plugin-pwa -- Vite 8 is very
// recent and that plugin's compatibility with it is unconfirmed, and a
// hand-rolled worker sidesteps precache staleness entirely by never
// hardcoding a build's hashed asset filenames. Runtime-caches only.
const RUNTIME_CACHE = 'marrow-runtime-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== RUNTIME_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for hashed, immutable build assets (/assets/...) -- safe to
// keep indefinitely, a new deploy ships new hashed filenames anyway.
// Everything else (index.html, /manifest.json, API calls) goes
// network-first with a cache fallback so a fresh deploy is what a reload
// actually gets -- T-MEMORY-126's "What's new" dialog depends on a fresh
// index.html landing on refresh, not one pinned by this worker.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) event.waitUntil(cache.put(request, response.clone()));
        return response;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error('network unavailable and no cached response');
      }
    })(),
  );
});
