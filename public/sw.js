const CACHE_NAME = 'aljaleel-sis-v7';

const STATIC_ASSETS = [
    '/css/main.css',
    '/css/report.css',
    '/css/pwa-prompt.css',
    '/js/pwa-installer.js',
    '/js/offline-handler.js',
    '/js/table-export.js',
    '/img/logo-512.png',
    '/offline-unavailable.html',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css'
];

// Only these authenticated pages may be retained for intentional offline workflows.
// Never cache arbitrary navigations, login pages, redirects, or server error pages.
const OFFLINE_PAGE_PATHS = new Set([
    '/dashboard',
    '/attendance',
    '/students',
    '/attendance/take',
    '/results/manage'
]);

const AUTH_PATHS = new Set([
    '/auth/login',
    '/auth/student-login'
]);

const LOGOUT_PATHS = new Set([
    '/auth/logout',
    '/auth/student-logout'
]);

function isStaticAsset(url) {
    return STATIC_ASSETS.some((asset) => {
        if (asset.startsWith('https://')) return url.href === asset;
        return url.origin === self.location.origin && url.pathname === asset;
    });
}

function isOfflinePage(request, url) {
    return request.mode === 'navigate' && url.origin === self.location.origin &&
        OFFLINE_PAGE_PATHS.has(url.pathname);
}

async function clearPrivatePageCache(cache) {
    const keys = await cache.keys();
    await Promise.all(keys.map(async (key) => {
        const keyUrl = new URL(key.url);
        if (keyUrl.origin === self.location.origin &&
            (OFFLINE_PAGE_PATHS.has(keyUrl.pathname) || AUTH_PATHS.has(keyUrl.pathname))) {
            await cache.delete(key);
        }
    }));
}

// ─── Install ──────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Cache only static assets during installation. Authenticated HTML is
            // cached only after a successful, explicit visit to an approved page.
            await Promise.allSettled(
                STATIC_ASSETS.map((asset) =>
                    cache.add(asset).catch((err) => console.warn('[SW] Could not cache asset:', asset, err))
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
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    event.waitUntil(self.clients.claim());
});

// ─── Fetch ────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Do not intercept writes. Offline form saves are handled by the application
    // queue, not by the service worker's HTTP cache.
    if (request.method !== 'GET') return;

    // Only the explicitly listed static assets may use the asset cache.
    // Do not turn every third-party GET request into a cached response.
    if (isStaticAsset(url)) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(request);
                const fetchPromise = fetch(request)
                    .then((res) => {
                        if (res && res.status === 200 && !res.redirected) {
                            return cache.put(request, res.clone()).then(() => res);
                        }
                        return res;
                    })
                    .catch(() => cached);
                return cached || fetchPromise;
            })
        );
        return;
    }

    // Leave all other cross-origin requests to the browser.
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then(async (res) => {
                const redirectedToAuth = res.redirected &&
                    [...AUTH_PATHS].some((path) => new URL(res.url).pathname === path);

                // A login screen or a redirect to login means the prior local
                // private-page snapshot must not remain available to the next user.
                if (AUTH_PATHS.has(url.pathname) || LOGOUT_PATHS.has(url.pathname) || redirectedToAuth) {
                    const cache = await caches.open(CACHE_NAME);
                    await clearPrivatePageCache(cache);
                }

                if (isOfflinePage(request, url) &&
                    res && res.status === 200 && !res.redirected &&
                    (res.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        const cacheKey = new Request(request.url, {
                            method: 'GET',
                            credentials: 'same-origin'
                        });
                        await cache.put(cacheKey, res.clone());
                    } catch (cacheError) {
                        console.warn('[SW] Could not cache approved offline page:', url.pathname, cacheError);
                    }
                }
                return res;
            })
            .catch(async () => {
                const cache = await caches.open(CACHE_NAME);

                // Never serve cached authenticated pages for login/logout routes.
                if (AUTH_PATHS.has(url.pathname) || LOGOUT_PATHS.has(url.pathname)) {
                    return new Response('Sign-in and sign-out require an internet connection.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
                    });
                }

                // Only approved pages can be served from the private offline cache.
                if (isOfflinePage(request, url)) {
                    const exact = await cache.match(request);
                    if (exact) return exact;

                    // Attendance sheets may be prepared with a date in the URL.
                    // Match the same class while allowing the requested date to differ.
                    if (url.pathname === '/attendance/take') {
                        const classId = url.searchParams.get('class_id');
                        if (classId) {
                            const keys = await cache.keys();
                            for (const key of keys) {
                                const cachedUrl = new URL(key.url);
                                if (cachedUrl.origin === url.origin &&
                                    cachedUrl.pathname === url.pathname &&
                                    cachedUrl.searchParams.get('class_id') === classId) {
                                    const matched = await cache.match(key);
                                    if (matched) return matched;
                                }
                            }
                        }
                    }

                    // Match results only when all context supplied by the request
                    // agrees with the cached class/subject/session/term.
                    if (url.pathname === '/results/manage') {
                        const requestedKeys = ['class_id', 'subject_id', 'session', 'term'];
                        const keys = await cache.keys();
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
                    }

                    const fallback = await cache.match('/offline-unavailable.html');
                    if (fallback) {
                        return new Response(await fallback.text(), {
                            status: 503,
                            statusText: 'Offline entry data unavailable',
                            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
                        });
                    }
                    return new Response('This page is not available offline. Reconnect and open it before trying again.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
                    });
                }

                // No generic dashboard fallback: it can falsely imply that a
                // different module loaded successfully or expose another cached page.
                return new Response('This page is not available offline. Reconnect to continue.', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
                });
            })
    );
});

// ─── Background Sync ──────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-nexus') {
        event.waitUntil(
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => client.postMessage({ type: 'TRIGGER_SYNC' }));
            })
        );
    }
});
