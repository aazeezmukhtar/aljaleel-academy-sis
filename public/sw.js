const CACHE_NAME = 'aljaleel-sis-v6';

const STATIC_ASSETS = [
    '/css/main.css',
    '/css/report.css',
    '/css/pwa-prompt.css',
    '/js/pwa-installer.js',
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
    '/students',
    '/offline-unavailable.html'
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
                if (res && res.status === 200 && !res.redirected && (request.mode === 'navigate' || url.pathname === '/attendance/take' || url.pathname === '/results/manage')) {
                    // Wait for the cache write so the preparation fetch does not finish
                    // before the offline copy has actually been stored.
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(request, res.clone());
                    } catch (cacheError) {
                        console.warn('[SW] Could not cache page response:', url.pathname, cacheError);
                    }
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

                    // Never replace an attendance/result entry request with the dashboard.
                    // A dashboard response looks like a successful navigation but loses the
                    // selected class/subject context and hides the actual offline cache miss.
                    if (url.pathname === '/attendance/take' || url.pathname === '/results/manage') {
                        const cache = await caches.open(CACHE_NAME);
                        const keys = await cache.keys();
                        const requestedKeys = ['class_id', 'subject_id', 'session', 'term'];
                        for (const key of keys) {
                            const cachedUrl = new URL(key.url);
                            if (cachedUrl.origin !== url.origin || cachedUrl.pathname !== url.pathname) continue;
                            const matchesContext = requestedKeys.every((name) => {
                                const requestedValue = url.searchParams.get(name);
                                return requestedValue === null || cachedUrl.searchParams.get(name) === requestedValue;
                            });
                            if (matchesContext) {
                                const matched = await cache.match(key);
                                if (matched) return matched;
                            }
                        }
                        const fallback = await cache.match('/offline-unavailable.html');
                        if (fallback) {
                            return new Response(await fallback.text(), {
                                status: 503,
                                statusText: 'Offline entry data unavailable',
                                headers: { 'Content-Type': 'text/html; charset=utf-8' }
                            });
                        }
                        return new Response('This entry page is not available offline yet. Reconnect and open this class/subject once to prepare it for offline use.', {
                            status: 503,
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                        });
                    }

                    // For other navigation requests, keep the existing dashboard fallback.
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
