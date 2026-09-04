// Minimal service worker: caches the app shell so the dashboard's layout
// still loads when offline or on a flaky connection (e.g. checking from a
// stairwell on-site). Live readings still need the network — /api/* is
// deliberately never cached, so the dashboard always shows real data (or a
// clear "Offline" status via app.js) rather than stale numbers.
//
// Strategy is network-first, falling back to cache only when the network
// fails: an earlier cache-first version kept serving a stale shell after
// every deploy, since the cache was never invalidated by content changes —
// only by bumping CACHE_NAME, which is easy to forget. Network-first means
// "online" always gets the latest shell; "offline" still gets *something*.
const CACHE_NAME = 'utility-monitor-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — the dashboard must always show live data.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
