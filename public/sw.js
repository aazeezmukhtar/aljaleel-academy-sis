const CACHE_NAME = 'nexus-sis-v3';

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
                if (res && res.status === 200 && request.mode === 'navigate') {
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
                }
                return res;
            })
            .catch(() => {
                // Offline fallback
                return caches.match(request).then((cached) => {
                    if (cached) return cached;

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
});
