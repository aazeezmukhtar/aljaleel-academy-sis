/**
 * Nexus SIS Offline Handler v2
 * IndexedDB queue for offline attendance + result entry.
 * Syncs automatically when connection is restored.
 */

const DB_NAME = 'NexusSIS_OfflineDB';
const DB_VERSION = 2;

let _idb = null;

// ─── IndexedDB Init ────────────────────────────────────────────────────────

function openDB() {
    return new Promise((resolve, reject) => {
        if (_idb) return resolve(_idb);

        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('attendance_sync')) {
                db.createObjectStore('attendance_sync', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('results_sync')) {
                db.createObjectStore('results_sync', { keyPath: 'id', autoIncrement: true });
            }
        };

        req.onsuccess = (e) => {
            _idb = e.target.result;
            resolve(_idb);
        };

        req.onerror = (e) => {
            console.error('[NexusOffline] IndexedDB open failed:', e.target.error);
            reject(e.target.error);
        };
    });
}

// ─── Queue Writers ─────────────────────────────────────────────────────────

async function saveAttendanceOffline(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['attendance_sync'], 'readwrite');
        const store = tx.objectStore('attendance_sync');
        const req = store.add({ ...data, _savedAt: new Date().toISOString() });
        req.onsuccess = () => {
            updateSyncUI();
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

async function saveResultOffline(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['results_sync'], 'readwrite');
        const store = tx.objectStore('results_sync');
        const req = store.add({ ...data, _savedAt: new Date().toISOString() });
        req.onsuccess = () => {
            updateSyncUI();
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

// ─── Queue Readers ─────────────────────────────────────────────────────────

async function getAllQueued(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction([storeName], 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function deleteQueued(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction([storeName], 'readwrite').objectStore(storeName).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function getPendingCount() {
    try {
        const att = await getAllQueued('attendance_sync');
        const res = await getAllQueued('results_sync');
        return att.length + res.length;
    } catch {
        return 0;
    }
}

// ─── Sync Logic ────────────────────────────────────────────────────────────

let _isSyncing = false;

async function syncData() {
    if (!navigator.onLine || _isSyncing) return;
    _isSyncing = true;

    const pending = await getPendingCount();
    if (pending === 0) {
        _isSyncing = false;
        updateSyncUI();
        return;
    }

    updateSyncUI('syncing');

    let successCount = 0;
    let failCount = 0;

    // ── Sync Attendance ──
    const attendanceItems = await getAllQueued('attendance_sync');
    for (const item of attendanceItems) {
        try {
            const { id, _savedAt, ...payload } = item;
            const res = await fetch('/attendance/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.redirected) {
                failCount++;
                continue;
            }
            if (res.ok && !res.redirected) {
                const data = await res.json().catch(() => ({}));
                if (data.success || res.status === 409) {
                    await deleteQueued('attendance_sync', id);
                    successCount++;
                } else {
                    failCount++;
                }
            } else if (res.status === 409) {
                await deleteQueued('attendance_sync', id);
                successCount++;
            } else {
                failCount++;
            }
        } catch {
            failCount++;
        }
    }

    // ── Sync Results ──
    const resultItems = await getAllQueued('results_sync');
    for (const item of resultItems) {
        try {
            const { id, _savedAt, ...payload } = item;
            const res = await fetch('/results/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.redirected) {
                failCount++;
                continue;
            }
            if (res.ok && !res.redirected) {
                const data = await res.json().catch(() => ({}));
                if (data.success) {
                    await deleteQueued('results_sync', id);
                    successCount++;
                } else {
                    failCount++;
                }
            } else {
                failCount++;
            }
        } catch {
            failCount++;
        }
    }

    _isSyncing = false;
    updateSyncUI(failCount > 0 ? 'partial' : 'done', successCount, failCount);
}

// ─── UI Updates ────────────────────────────────────────────────────────────

async function updateSyncUI(state, successCount, failCount) {
    // Update every sync indicator on the page
    const indicators = document.querySelectorAll('.sync-indicator');
    if (!indicators.length) return;

    const pending = await getPendingCount().catch(() => 0);

    let cls = 'sync-indicator';
    let html = '';

    if (!navigator.onLine) {
        cls += ' offline';
        html = `<span class="sync-dot"></span> Offline Mode${pending > 0 ? ` &bull; ${pending} pending` : ''}`;
    } else if (state === 'syncing') {
        cls += ' syncing';
        html = `<span class="sync-dot"></span> Syncing ${pending} record(s)...`;
    } else if (state === 'partial') {
        cls += ' warning';
        html = `<span class="sync-dot"></span> ${successCount} synced, ${failCount} failed`;
    } else if (state === 'done') {
        cls += ' synced';
        html = `<span class="sync-dot"></span> Synced ✓`;
        setTimeout(() => updateSyncUI(), 4000);
    } else if (pending > 0) {
        cls += ' pending';
        html = `<span class="sync-dot"></span> ${pending} unsynced record(s)`;
    } else {
        cls += ' online';
        html = `<span class="sync-dot"></span> Online`;
    }

    indicators.forEach(el => {
        el.className = cls;
        el.innerHTML = html;
    });
}

// ─── Event Listeners ───────────────────────────────────────────────────────

window.addEventListener('online', () => {
    document.body.classList.remove('is-offline');
    updateSyncUI();
    // Small delay to ensure network is actually stable
    setTimeout(syncData, 1500);
});

window.addEventListener('offline', () => {
    document.body.classList.add('is-offline');
    updateSyncUI();
});

// Init on page load
document.addEventListener('DOMContentLoaded', () => {
    openDB().then(() => {
        if (!navigator.onLine) {
            document.body.classList.add('is-offline');
        }
        updateSyncUI();
        if (navigator.onLine) syncData();
    }).catch(err => console.warn('[NexusOffline] Could not open IndexedDB:', err));
});

// ─── Public API ────────────────────────────────────────────────────────────

window.NexusOffline = {
    saveAttendanceOffline,
    saveResultOffline,
    syncData,
    getPendingCount
};
