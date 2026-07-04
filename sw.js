/* ═══════════════════════════════════════════════════
   Srinivasa Onion Store — Service Worker
   Caches everything for full offline use
   ═══════════════════════════════════════════════════ */

const CACHE_NAME = 'srini-store-v2';

// Files to cache for offline use
const STATIC_ASSETS = [
  './index.html',
  './index.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Google Fonts (cached on first load)
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=DM+Sans:wght@300;400;500;600&display=swap',
  // External JS libs
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

// ── INSTALL: cache all static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache local files strictly, external libs with no-cors fallback
      const localFiles = ['./index.html', './index.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];
      const externalFiles = STATIC_ASSETS.filter(u => u.startsWith('http'));

      return Promise.all([
        cache.addAll(localFiles),
        ...externalFiles.map(url =>
          fetch(url, { mode: 'no-cors' })
            .then(res => cache.put(url, res))
            .catch(() => {}) // silently skip if offline during install
        )
      ]);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: serve from cache, fallback to network ──
self.addEventListener('fetch', event => {
  // Skip non-GET requests and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  // For navigation (HTML page loads) — cache-first, then network
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => {
        return cached || fetch(event.request).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // For everything else — cache-first, then network, then update cache
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Only cache successful responses
          if (!response || response.status !== 200) return response;

          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
          return response;
        })
        .catch(() => {
          // If both cache and network fail, return nothing (app handles gracefully)
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

// ── MESSAGE: force update from client ──
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
