const CACHE_NAME = 'aljaleel-sis-v9';

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
    '/results',
    '/results/manage',
    '/academics',
    '/calendar',
    '/announcements'
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

// Ignore cache-busting query strings for same-origin static assets so
// /css/main.css and /css/main.css?v=3.0 share the same offline cache entry.
function staticCacheKey(url) {
    return new Request(url.origin + url.pathname, {
        method: 'GET',
        credentials: 'same-origin'
    });
}

function isOfflinePage(request, url) {
    return request.mode === 'navigate' && url.origin === self.location.origin &&
        OFFLINE_PAGE_PATHS.has(url.pathname);
}

function matchesOfflineEntryContext(requestedUrl, cachedUrl) {
    if (requestedUrl.origin !== cachedUrl.origin ||
        requestedUrl.pathname !== cachedUrl.pathname) {
        return false;
    }

    let requiredKeys;
    if (requestedUrl.pathname === '/attendance/take') {
        requiredKeys = ['class_id', 'date'];
    } else if (requestedUrl.pathname === '/results/manage') {
        requiredKeys = ['class_id', 'subject_id', 'session', 'term'];
    } else {
        return false;
    }

    // Never guess the missing context. In particular, a results URL without
    // class and subject must not match an arbitrary cached grade sheet.
    if (requiredKeys.some((key) => {
        const value = requestedUrl.searchParams.get(key);
        return value === null || value.trim() === '';
    })) {
        return false;
    }

    // Query parameter order is irrelevant, but every context parameter must
    // agree, including session/term when present (or absent) in either URL.
    return ['class_id', 'date', 'subject_id', 'session', 'term'].every((key) =>
        requestedUrl.searchParams.get(key) === cachedUrl.searchParams.get(key)
    );
}

function isOfflinePreparationRequest(request, url) {
    if (request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        request.headers.get('X-AcadMe-Offline-Prepare') !== '1') {
        return false;
    }

    if (url.pathname === '/attendance/take') {
        return ['class_id', 'date'].every((key) => {
            const value = url.searchParams.get(key);
            return value !== null && value.trim() !== '';
        });
    }

    if (url.pathname === '/results/manage') {
        return ['class_id', 'subject_id', 'session', 'term'].every((key) => {
            const value = url.searchParams.get(key);
            return value !== null && value.trim() !== '';
        });
    }

    return false;
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
                const key = url.origin === self.location.origin ? staticCacheKey(url) : request;
                const cached = await cache.match(key);
                const fetchPromise = fetch(request)
                    .then((res) => {
                        if (res && res.status === 200 && !res.redirected) {
                            return cache.put(key, res.clone()).then(() => res);
                        }
                        return res;
                    })
                    .catch(() => cached || new Response('', {
                        status: 503,
                        headers: { 'Cache-Control': 'no-store' }
                    }));
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

                const isPreparation = isOfflinePreparationRequest(request, url);
                if ((isOfflinePage(request, url) || isPreparation) &&
                    res && res.status === 200 && !res.redirected &&
                    (res.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
                    let cachedSuccessfully = false;
                    try {
                        const cache = await caches.open(CACHE_NAME);
                        const cacheKey = new Request(request.url, {
                            method: 'GET',
                            credentials: 'same-origin'
                        });
                        await cache.put(cacheKey, res.clone());
                        cachedSuccessfully = true;
                    } catch (cacheError) {
                        console.warn('[SW] Could not cache approved offline page:', url.pathname, cacheError);
                    }

                    // Confirm preparation only after this active worker has stored
                    // the exact class/date response in its own cache.
                    if (isPreparation && cachedSuccessfully) {
                        const headers = new Headers(res.headers);
                        headers.set('X-AcadMe-Offline-Cached', '1');
                        return new Response(res.body, {
                            status: res.status,
                            statusText: res.statusText,
                            headers
                        });
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
                    const hasRequiredEntryContext = url.pathname === '/attendance/take'
                        ? ['class_id', 'date'].every((key) => {
                            const value = url.searchParams.get(key);
                            return value !== null && value.trim() !== '';
                        })
                        : url.pathname === '/results/manage'
                            ? ['class_id', 'subject_id', 'session', 'term'].every((key) => {
                                const value = url.searchParams.get(key);
                                return value !== null && value.trim() !== '';
                            })
                            : true;
                    if (exact && hasRequiredEntryContext) return exact;

                    // Match only the same entry context. Query parameter order may
                    // differ, but class/date or class/subject/session/term must not.
                    if (url.pathname === '/attendance/take' || url.pathname === '/results/manage') {
                        const keys = await cache.keys();
                        for (const key of keys) {
                            const cachedUrl = new URL(key.url);
                            if (!matchesOfflineEntryContext(url, cachedUrl)) continue;
                            const matched = await cache.match(key);
                            if (matched) return matched;
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
                // No generic dashboard fallback: another module must never display dashboard HTML.
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