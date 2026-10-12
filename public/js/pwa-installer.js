/**
 * PWA Install Prompt Handler
 * Detects 'beforeinstallprompt', handles iOS Safari, supports dismissal & manual triggers.
 */

(function () {
    // Only run in browser environments
    if (typeof window === 'undefined') return;

    // Check if already in standalone / installed mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true;

    if (isStandalone) {
        return; // Already running as an installed PWA
    }

    const DISMISSED_KEY = 'pwa_prompt_dismissed_until';
    const now = Date.now();
    const dismissedUntil = localStorage.getItem(DISMISSED_KEY);

    if (dismissedUntil && now < parseInt(dismissedUntil, 10)) {
        return; // User recently dismissed (snoozed for 7 days)
    }

    let deferredPrompt = null;

    // Register service worker if not already registered
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .catch(err => console.debug('[PWA] SW registration notice:', err));
        });
    }

    function createBanner({ isIOS = false }) {
        if (document.getElementById('pwa-install-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Install App Prompt');

        const appName = document.title ? document.title.split('-')[0].trim() : 'Al-Jaleel Academy';
        const iconSrc = '/img/logo-512.png';

        if (isIOS) {
            banner.innerHTML = `
                <div class="pwa-banner-header">
                    <img src="${iconSrc}" alt="App Icon" class="pwa-app-icon" onerror="this.src='/img/logo.png'">
                    <div class="pwa-app-info">
                        <h4 class="pwa-app-title">Install ${appName}</h4>
                        <p class="pwa-app-subtitle">Fast, offline-ready & one tap away</p>
                    </div>
                    <button class="pwa-close-btn" id="pwa-btn-close" aria-label="Dismiss">&times;</button>
                </div>
                <div class="pwa-ios-instructions">
                    Tap the <strong>Share</strong> icon <i class="bi bi-box-arrow-up" style="display:inline-block; font-size:1.05rem; vertical-align:middle;"></i> at the bottom of Safari, then choose <strong>"Add to Home Screen"</strong>.
                </div>
                <div class="pwa-banner-actions">
                    <button class="pwa-btn-dismiss" id="pwa-btn-dismiss">Got it</button>
                </div>
            `;
        } else {
            banner.innerHTML = `
                <div class="pwa-banner-header">
                    <img src="${iconSrc}" alt="App Icon" class="pwa-app-icon" onerror="this.src='/img/logo.png'">
                    <div class="pwa-app-info">
                        <h4 class="pwa-app-title">Install ${appName}</h4>
                        <p class="pwa-app-subtitle">Install app on your device for quick access</p>
                    </div>
                    <button class="pwa-close-btn" id="pwa-btn-close" aria-label="Dismiss">&times;</button>
                </div>
                <div class="pwa-banner-actions">
                    <button class="pwa-btn-dismiss" id="pwa-btn-dismiss">Not Now</button>
                    <button class="pwa-btn-install" id="pwa-btn-install">
                        <i class="bi bi-download"></i> Install App
                    </button>
                </div>
            `;
        }

        document.body.appendChild(banner);

        const closeBtn = banner.querySelector('#pwa-btn-close');
        const dismissBtn = banner.querySelector('#pwa-btn-dismiss');
        const installBtn = banner.querySelector('#pwa-btn-install');

        function dismissBanner(days = 7) {
            localStorage.setItem(DISMISSED_KEY, (Date.now() + days * 24 * 60 * 60 * 1000).toString());
            banner.remove();
        }

        if (closeBtn) closeBtn.addEventListener('click', () => dismissBanner(3));
        if (dismissBtn) dismissBtn.addEventListener('click', () => dismissBanner(7));

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (!deferredPrompt) return;
                banner.remove();
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                    console.log('[PWA] User accepted the install prompt');
                } else {
                    dismissBanner(7);
                }
                deferredPrompt = null;
            });
        }
    }

    // Chrome, Edge, Android Opera, etc.
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default mini-infobar or auto-trigger
        e.preventDefault();
        deferredPrompt = e;

        // Show banner after brief delay so user can orient on page
        setTimeout(() => {
            createBanner({ isIOS: false });
        }, 1200);
    });

    // Detect iOS Safari (which does not fire beforeinstallprompt)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = isIOS && /webkit/.test(userAgent) && !/crios|fxios|opios/.test(userAgent);

    if (isSafari && !isStandalone) {
        // Prompt for iOS after a few seconds
        setTimeout(() => {
            createBanner({ isIOS: true });
        }, 2500);
    }

    // App was successfully installed
    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App successfully installed');
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
    });
})();
