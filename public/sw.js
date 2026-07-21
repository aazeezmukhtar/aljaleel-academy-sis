<<<<<<< HEAD
const CACHE_NAME = 'nexus-sis-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/dashboard',
  '/css/main.css',
  '/css/report.css',
  '/img/logo-512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Cache new static assets
        if (event.request.url.includes('/css/') || event.request.url.includes('/img/') || event.request.url.includes('/js/')) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cacheCopy);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for pages
        if (event.request.mode === 'navigate') {
          return caches.match('/dashboard');
        }
      });
    })
  );
=======
const CACHE_NAME = 'nexus-sis-v4';

const STATIC_ASSETS = [
    '/css/main.css',
    '/css/report.css',
    '/js/offline-handler.js',
    '/js/table-export.js',
    '/img/logo-512.png',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css'
];

// Pages to cache for offline shell
const PAGE_CACHE = [
    '/dashboard',
    '/attendance',
    '/results/manage',
    '/students'
];

// ─── Install ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Cache static assets (fail-safe: don't let one failure block install)
            await Promise.allSettled(
                STATIC_ASSETS.map(url =>
                    cache.add(url).catch(err => console.warn('[SW] Could not cache:', url, err))
                )
            );
            // Cache app pages
            await Promise.allSettled(
                PAGE_CACHE.map(url =>
                    cache.add(url).catch(err => console.warn('[SW] Could not cache page:', url, err))
                )
            );
        })
    );
});

// ─── Activate ─────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Never intercept non-GET or cross-origin API calls
    if (request.method !== 'GET') return;

    // Stale-while-revalidate for static assets + CDN
    const isStatic = STATIC_ASSETS.some(a => request.url.includes(a) || url.pathname === a);
    if (isStatic || url.origin !== self.location.origin) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(request);
                const fetchPromise = fetch(request)
                    .then((res) => {
                        if (res && res.status === 200) {
                            cache.put(request, res.clone());
                        }
                        return res;
                    })
                    .catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }

    // Network-first for all app pages
    event.respondWith(
        fetch(request)
            .then((res) => {
                // Cache successful navigation responses for offline fallback
                if (res && res.status === 200 && (request.mode === 'navigate' || url.pathname === '/attendance/take' || url.pathname === '/results/manage')) {
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
                }
                return res;
            })
            .catch(() => {
                // Offline fallback
                return caches.match(request).then(async (cached) => {
                    if (cached) return cached;

                    // Special handling for /attendance/take: match ignoring date parameter
                    if (url.pathname === '/attendance/take') {
                        const classId = url.searchParams.get('class_id');
                        if (classId) {
                            const cache = await caches.open(CACHE_NAME);
                            const keys = await cache.keys();
                            for (const key of keys) {
                                const cachedUrl = new URL(key.url);
                                if (cachedUrl.pathname === '/attendance/take' && cachedUrl.searchParams.get('class_id') === classId) {
                                    const matched = await cache.match(key);
                                    if (matched) return matched;
                                }
                            }
                        }
                    }

                    // For navigation requests: serve the cached dashboard shell
                    if (request.mode === 'navigate') {
                        return caches.match('/dashboard');
                    }
                });
            })
    );
});

// ─── Background Sync ──────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-nexus') {
        event.waitUntil(
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) =>
                    client.postMessage({ type: 'TRIGGER_SYNC' })
                );
            })
        );
    }
>>>>>>> local-master
});
