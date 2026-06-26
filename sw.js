// Folio Service Worker — folio-v11
// Strategy:
//   index.html → NETWORK FIRST (always get latest, offline fallback)
//   CDN assets  → CACHE FIRST  (versioned, never change)
//   Fonts       → STALE-WHILE-REVALIDATE
const CACHE = 'folio-v11';
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

// Install: pre-cache CDN assets only
self.addEventListener('install', e => {
  self.skipWaiting(); // take over immediately
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(CDN_ASSETS.map(url => cache.add(url)))
    )
  );
});

// Activate: delete old caches, claim all clients, force them to reload
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell every open tab to reload so they get fresh HTML
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // index.html — NETWORK FIRST, cache as fallback
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // manifest + sw — always network
  if (url.pathname === '/manifest.json' || url.pathname === '/sw.js') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request)));
    return;
  }

  // CDN (pdf.js) — CACHE FIRST (versioned URLs never change)
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Google Fonts — STALE-WHILE-REVALIDATE
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // Everything else — network, no caching
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
