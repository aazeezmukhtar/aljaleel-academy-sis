/**
 * AcadMe Offline Handler v3
 * IndexedDB queue for offline attendance + result entry.
 * Syncs automatically when connection is restored.
 */

const DB_NAME = 'NexusSIS_OfflineDB';
const DB_VERSION = 3;

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
            // Additive migration only: never delete or recreate existing queues.
            if (!db.objectStoreNames.contains('offline_manifest')) {
                db.createObjectStore('offline_manifest', { keyPath: 'id' });
            }
        };

        req.onsuccess = (e) => {
            _idb = e.target.result;
            _idb.onversionchange = () => {
                _idb.close();
                _idb = null;
            };
            resolve(_idb);
        };

        req.onerror = (e) => {
            console.error('[NexusOffline] IndexedDB open failed:', e.target.error);
            reject(e.target.error);
        };
    });
}

// ─── Offline identity and preparation registry ─────────────────────────────

const OFFLINE_RETENTION_DAYS = 7;
const OFFLINE_FRESHNESS_HOURS = 24;

function getOfflinePrincipal() {
    const context = window.ACADME_OFFLINE_CONTEXT;
    if (!context || !context.schoolId || !context.principalType || !context.principalId) return null;
    return {
        schoolId: String(context.schoolId),
        principalType: String(context.principalType),
        principalId: String(context.principalId)
    };
}

function getOfflineOwnerKey() {
    const principal = getOfflinePrincipal();
    return principal
        ? [principal.schoolId, principal.principalType, principal.principalId].join(':')
        : null;
}

function getManifestId(datasetKey) {
    const ownerKey = getOfflineOwnerKey();
    return ownerKey && datasetKey ? ownerKey + '::' + String(datasetKey) : null;
}

function getManifestRecord(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const request = db.transaction(['offline_manifest'], 'readonly')
            .objectStore('offline_manifest').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    }));
}

async function getPreparedDatasetStatus(datasetKey, url) {
    const id = getManifestId(datasetKey);
    if (!id || !url || !('caches' in window)) return { status: 'missing' };

    const record = await getManifestRecord(id);
    if (!record) return { status: 'missing' };

    // A manifest entry is never proof that the actual HTML response still exists.
    const cached = await caches.match(url, { ignoreSearch: false });
    if (!cached) return { status: 'missing' };

    const preparedAt = Date.parse(record.preparedAt || '');
    if (!Number.isFinite(preparedAt)) return { status: 'stale', record };
    const age = Math.max(0, Date.now() - preparedAt);
    const freshnessMs = OFFLINE_FRESHNESS_HOURS * 60 * 60 * 1000;
    return {
        status: age <= freshnessMs ? 'fresh' : 'stale',
        record,
        ageMs: age,
        retainedUntil: record.retainedUntil || null
    };
}

async function recordPreparedDataset(datasetKey, datasetType, url) {
    const id = getManifestId(datasetKey);
    const principal = getOfflinePrincipal();
    if (!id || !principal) throw new Error('Authenticated offline identity is unavailable; preparation metadata was not saved.');
    if (!('caches' in window) || !(await caches.match(url, { ignoreSearch: false }))) {
        throw new Error('The prepared response is not present in browser cache.');
    }

    const now = new Date();
    const retentionUntil = new Date(now.getTime() + OFFLINE_RETENTION_DAYS * 86400000);
    const record = {
        id,
        datasetKey: String(datasetKey),
        datasetType: String(datasetType),
        schoolId: principal.schoolId,
        principalType: principal.principalType,
        principalId: principal.principalId,
        preparedAt: now.toISOString(),
        lastSuccessfulRefreshAt: now.toISOString(),
        retentionUntil: retentionUntil.toISOString(),
        url: String(url)
    };

    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['offline_manifest'], 'readwrite');
        tx.objectStore('offline_manifest').put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save offline preparation metadata.'));
        tx.onabort = () => reject(tx.error || new Error('Offline preparation metadata write was aborted.'));
    });
    return record;
}

async function getOfflineStorageStatus() {
    const status = { persistent: null, usage: null, quota: null, supported: !!navigator.storage };
    if (!navigator.storage) return status;
    try {
        if (typeof navigator.storage.persisted === 'function') {
            status.persistent = await navigator.storage.persisted();
        }
        if (typeof navigator.storage.estimate === 'function') {
            const estimate = await navigator.storage.estimate();
            status.usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
            status.quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
        }
    } catch (error) {
        console.warn('[NexusOffline] Storage status check failed:', error);
        status.error = error.message;
    }
    return status;
}

async function requestPersistentStorage() {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
        return { supported: false, granted: false };
    }
    try {
        const granted = await navigator.storage.persist();
        return { supported: true, granted: !!granted };
    } catch (error) {
        return { supported: true, granted: false, error: error.message };
    }
}

// ─── Queue Writers ─────────────────────────────────────────────────────────

async function requestBackgroundSync() {
    if (!('serviceWorker' in navigator)) return false;
    try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.sync && typeof registration.sync.register === 'function') {
            await registration.sync.register('sync-nexus');
            return true;
        }
    } catch (error) {
        // Background Sync is an enhancement only; foreground retries remain active.
        console.info('[NexusOffline] Background Sync unavailable; foreground retry will handle queued work.', error);
    }
    return false;
}

async function saveAttendanceOffline(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['attendance_sync'], 'readwrite');
        const store = tx.objectStore('attendance_sync');
        const ownerKey = getOfflineOwnerKey();
        if (!ownerKey) {
            tx.abort();
            reject(new Error('Offline account identity is unavailable. Reconnect before saving work on this device.'));
            return;
        }
        const req = store.add({ ...data, _ownerKey: ownerKey, _savedAt: new Date().toISOString() });
        tx.oncomplete = () => {
            updateSyncUI();
            requestBackgroundSync();
            resolve();
        };
        tx.onerror = () => reject(tx.error || req.error || new Error('Offline attendance could not be stored.'));
        tx.onabort = () => reject(tx.error || new Error('Offline attendance storage was aborted.'));
    });
}

async function saveResultOffline(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['results_sync'], 'readwrite');
        const store = tx.objectStore('results_sync');
        const ownerKey = getOfflineOwnerKey();
        if (!ownerKey) {
            tx.abort();
            reject(new Error('Offline account identity is unavailable. Reconnect before saving work on this device.'));
            return;
        }
        const req = store.add({ ...data, _ownerKey: ownerKey, _savedAt: new Date().toISOString() });
        tx.oncomplete = () => {
            updateSyncUI();
            requestBackgroundSync();
            resolve();
        };
        tx.onerror = () => reject(tx.error || req.error || new Error('Offline results could not be stored.'));
        tx.onabort = () => reject(tx.error || new Error('Offline results storage was aborted.'));
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
        const ownerKey = getOfflineOwnerKey();
        if (!ownerKey) return 0;
        const att = await getAllQueued('attendance_sync');
        const res = await getAllQueued('results_sync');
        return att.filter(item => item._ownerKey === ownerKey).length +
            res.filter(item => item._ownerKey === ownerKey).length;
    } catch {
        return 0;
    }
}

async function getQuarantinedQueueCount() {
    try {
        const att = await getAllQueued('attendance_sync');
        const res = await getAllQueued('results_sync');
        return att.filter(item => !item._ownerKey).length +
            res.filter(item => !item._ownerKey).length;
    } catch {
        return 0;
    }
}

// ─── Sync Logic ────────────────────────────────────────────────────────────

let _isSyncing = false;

async function syncData() {
    if (!navigator.onLine || _isSyncing) return;
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) {
        updateSyncUI('blocked');
        return;
    }
    _isSyncing = true;

    let successCount = 0;
    let failCount = 0;

    try {
        const pending = await getPendingCount();
        if (pending === 0) {
            updateSyncUI();
            return;
        }

        updateSyncUI('syncing');

        // A failure reading one queue must not permanently lock syncing or
        // prevent the other queue from being processed.
        let attendanceItems = [];
        try {
            attendanceItems = (await getAllQueued('attendance_sync')).filter(item => item._ownerKey === ownerKey);
        } catch (err) {
            console.error('[NexusOffline] Could not read attendance queue:', err);
            failCount++;
        }

        for (const item of attendanceItems) {
            try {
                const { id, _savedAt, _ownerKey, ...payload } = item;
                const res = await fetch('/attendance/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.redirected) {
                    failCount++;
                    continue;
                }
                if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    if (data.success) {
                        await deleteQueued('attendance_sync', id);
                        successCount++;
                    } else {
                        // Keep conflicts and validation failures queued for explicit review.
                        failCount++;
                    }
                } else {
                    // Never treat an HTTP conflict or server error as proof of success.
                    failCount++;
                }
            } catch (err) {
                console.warn('[NexusOffline] Attendance sync item remains queued:', err);
                failCount++;
            }
        }

        let resultItems = [];
        try {
            resultItems = (await getAllQueued('results_sync')).filter(item => item._ownerKey === ownerKey);
        } catch (err) {
            console.error('[NexusOffline] Could not read results queue:', err);
            failCount++;
        }

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
                if (res.ok) {
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
            } catch (err) {
                console.warn('[NexusOffline] Result sync item remains queued:', err);
                failCount++;
            }
        }

        updateSyncUI(failCount > 0 ? 'partial' : 'done', successCount, failCount);
    } catch (err) {
        // Always release the lock, even if IndexedDB or UI preparation fails.
        console.error('[NexusOffline] Sync cycle failed; queued data was retained where possible:', err);
        updateSyncUI('partial', successCount, failCount + 1);
    } finally {
        _isSyncing = false;
    }
}

// ─── UI Updates ────────────────────────────────────────────────────────────

async function updateSyncUI(state, successCount, failCount) {
    // Update every sync indicator on the page
    const indicators = document.querySelectorAll('.sync-indicator');
    if (!indicators.length) return;

    const pending = await getPendingCount().catch(() => 0);
    const quarantined = await getQuarantinedQueueCount().catch(() => 0);
    const quarantineNote = quarantined > 0 ? ' • ' + quarantined + ' older unassigned record(s) held safely' : '';

    let cls = 'sync-indicator';
    let html = '';

    if (!navigator.onLine) {
        cls += ' offline';
        html = `<span class="sync-dot"></span> Offline Mode${pending > 0 ? ` &bull; ${pending} pending` : ''}`;
    } else if (state === 'blocked') {
        cls += ' warning';
        html = '<span class="sync-dot"></span> Offline account identity unavailable; queued records were not sent';
    } else if (state === 'syncing') {
        cls += ' syncing';
        html = `<span class="sync-dot"></span> Syncing ${pending} record(s)...`;
    } else if (state === 'partial') {
        cls += ' warning';
        html = `<span class="sync-dot"></span> ${successCount} synced, ${failCount} failed`;
    } else if (state === 'done' && pending === 0) {
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
        el.innerHTML = html + quarantineNote;
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

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TRIGGER_SYNC') {
            syncData();
        }
    });
}

// Init on page load
document.addEventListener('DOMContentLoaded', () => {
    openDB().then(() => {
        requestPersistentStorage().then(result => {
            if (result.supported && !result.granted) console.info('[NexusOffline] Browser did not grant persistent storage.');
        });
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
    getPendingCount,
    getQuarantinedQueueCount,
    getPreparedDatasetStatus,
    recordPreparedDataset,
    getOfflineStorageStatus,
    requestPersistentStorage,
    requestBackgroundSync,
    retentionDays: OFFLINE_RETENTION_DAYS
};
