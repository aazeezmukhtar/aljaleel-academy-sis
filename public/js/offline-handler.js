/**
 * AcadMe Offline Handler v3
 * IndexedDB queue for offline attendance + result entry.
 * Syncs automatically when connection is restored.
 */

const DB_NAME = 'AcadMeSIS_OfflineDB';
const DB_VERSION = 5;

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
            if (!db.objectStoreNames.contains('attendance_prepared')) {
                db.createObjectStore('attendance_prepared', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('attendance_drafts')) {
                db.createObjectStore('attendance_drafts', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('results_drafts')) {
                db.createObjectStore('results_drafts', { keyPath: 'id' });
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
            console.error('[AcadMeOffline] IndexedDB open failed:', e.target.error);
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
    if (!id || !url) return { status: 'missing', available: false };

    const record = await getManifestRecord(id);
    if (!record) return { status: 'missing', available: false };

    // Attendance snapshots in IndexedDB are authoritative. CacheStorage is only
    // a compatibility fallback for older prepared records and other dataset types.
    let snapshot = null;
    if (record.datasetType === 'attendance') {
        const db = await openDB();
        snapshot = await new Promise((resolve, reject) => {
            const request = db.transaction(['attendance_prepared'], 'readonly')
                .objectStore('attendance_prepared').get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        if (snapshot && (snapshot.ownerKey !== getOfflineOwnerKey() ||
            String(snapshot.url) !== String(url))) snapshot = null;
    }

    let cached = null;
    if (!snapshot && 'caches' in window) {
        try { cached = await caches.match(url, { ignoreSearch: false }); } catch (error) {
            console.warn('[AcadMeOffline] CacheStorage lookup failed; durable snapshot remains authoritative.', error);
        }
    }
    if (!cached && !snapshot) return { status: 'missing', available: false };

    const recordedAt = Date.parse(record.preparedAt || '');
    const cachedAt = Date.parse((snapshot && snapshot.cachedAt) ||
        (cached && cached.headers.get('X-AcadMe-Cached-At')) || '');
    const referenceTime = Number.isFinite(cachedAt) ? cachedAt : recordedAt;
    if (!Number.isFinite(referenceTime)) {
        return { status: 'stale', available: true, record, ageMs: null, retainedUntil: record.retainedUntil || null };
    }

    const age = Math.max(0, Date.now() - referenceTime);
    const freshnessMs = OFFLINE_FRESHNESS_HOURS * 60 * 60 * 1000;
    const retentionMs = OFFLINE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const retainedUntil = Number.isFinite(Date.parse(record.retainedUntil || ''))
        ? record.retainedUntil
        : new Date(referenceTime + retentionMs).toISOString();

    if (age > retentionMs) return { status: 'expired', available: false, record, ageMs: age, retainedUntil };
    return {
        status: age <= freshnessMs ? 'fresh' : 'stale',
        available: true,
        source: snapshot ? 'indexeddb' : 'cache',
        record,
        ageMs: age,
        retainedUntil
    };
}

async function recordPreparedDataset(datasetKey, datasetType, url) {
    const id = getManifestId(datasetKey);
    const principal = getOfflinePrincipal();
    if (!id || !principal) throw new Error('Authenticated offline identity is unavailable; preparation metadata was not saved.');

    let cached = null;
    if ('caches' in window) {
        try { cached = await caches.match(url, { ignoreSearch: false }); } catch (error) {
            console.warn('[AcadMeOffline] CacheStorage lookup failed:', error);
        }
    }
    let snapshot = null;
    const db = await openDB();
    if (datasetType === 'attendance') {
        snapshot = await new Promise((resolve, reject) => {
            const request = db.transaction(['attendance_prepared'], 'readonly')
                .objectStore('attendance_prepared').get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    // The service worker writes the durable copy before returning its preparation
    // acknowledgement. Never manufacture a "ready" record from metadata alone.
    if (datasetType === 'attendance') {
        if (!snapshot || snapshot.ownerKey !== getOfflineOwnerKey() ||
            String(snapshot.url) !== String(url) || typeof snapshot.html !== 'string' || !snapshot.html.length) {
            if (!cached) throw new Error('The durable attendance snapshot could not be verified. Retry preparation while online.');
            const html = await cached.clone().text();
            if (!html) throw new Error('The prepared attendance sheet was empty.');
            const savedAt = new Date().toISOString();
            snapshot = {
                id, url: String(url), html,
                contentType: cached.headers.get('Content-Type') || 'text/html; charset=utf-8',
                cachedAt: cached.headers.get('X-AcadMe-Cached-At') || savedAt,
                ownerKey: getOfflineOwnerKey(), savedAt
            };
        }
    } else if (!cached) {
        throw new Error('The prepared response is not present in browser cache.');
    }

    const now = new Date();
    const record = {
        id,
        datasetKey: String(datasetKey),
        datasetType: String(datasetType),
        schoolId: principal.schoolId,
        principalType: principal.principalType,
        principalId: principal.principalId,
        preparedAt: now.toISOString(),
        lastSuccessfulRefreshAt: now.toISOString(),
        retainedUntil: new Date(now.getTime() + OFFLINE_RETENTION_DAYS * 86400000).toISOString(),
        url: String(url)
    };

    await new Promise((resolve, reject) => {
        const stores = datasetType === 'attendance' ? ['offline_manifest', 'attendance_prepared'] : ['offline_manifest'];
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore('offline_manifest').put(record);
        if (datasetType === 'attendance') tx.objectStore('attendance_prepared').put(snapshot);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not save offline preparation metadata.'));
        tx.onabort = () => reject(tx.error || new Error('Offline preparation metadata write was aborted.'));
    });

    if (datasetType === 'attendance') {
        const verified = await new Promise((resolve, reject) => {
            const request = db.transaction(['attendance_prepared'], 'readonly')
                .objectStore('attendance_prepared').get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        if (!verified || verified.ownerKey !== getOfflineOwnerKey() || verified.html !== snapshot.html) {
            throw new Error('The prepared attendance snapshot failed its read-back verification.');
        }
    }
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
        console.warn('[AcadMeOffline] Storage status check failed:', error);
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
            await registration.sync.register('sync-acadme');
            return true;
        }
    } catch (error) {
        // Background Sync is an enhancement only; foreground retries remain active.
        console.info('[AcadMeOffline] Background Sync unavailable; foreground retry will handle queued work.', error);
    }
    return false;
}

async function saveAttendanceOffline(data, options = {}) {
    const db = await openDB();
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) throw new Error('Offline account identity is unavailable. Reconnect before saving work on this device.');
    const submitAfterSync = options.submitAfterSync === true;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['attendance_sync', 'attendance_drafts'], 'readwrite');
        const store = tx.objectStore('attendance_sync');
        const drafts = tx.objectStore('attendance_drafts');
        const request = store.getAll();
        request.onsuccess = () => {
            const existing = request.result.find(item =>
                item._ownerKey === ownerKey &&
                String(item.class_id) === String(data.class_id) &&
                String(item.date) === String(data.date)
            );
            const savedAt = new Date().toISOString();
            const record = { ...data, _ownerKey: ownerKey, _savedAt: savedAt, _submitAfterSync: submitAfterSync || !!(existing && existing._submitAfterSync) };
            if (existing) record.id = existing.id;
            store.put(record);
            drafts.put({ ...data, id: ownerKey + '::' + String(data.class_id) + '::' + String(data.date), _ownerKey: ownerKey, _savedAt: savedAt, _submitAfterSync: record._submitAfterSync, _serverSubmittedAt: null });
        };
        request.onerror = () => { try { tx.abort(); } catch (error) {} };
        tx.oncomplete = () => {
            updateSyncUI();
            if (!options.deferSync) requestBackgroundSync();
            resolve({ submitAfterSync });
        };
        tx.onerror = () => reject(tx.error || request.error || new Error('Offline attendance could not be stored.'));
        tx.onabort = () => reject(tx.error || new Error('Offline attendance storage was aborted.'));
    });
}

async function getQueuedAttendanceRecord(classId, date) {
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) return null;
    const records = await getAllQueued('attendance_sync');
    return records.find(item => item._ownerKey === ownerKey && String(item.class_id) === String(classId) && String(item.date) === String(date)) || null;
}

async function getSavedAttendanceDraft(classId, date) {
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const id = ownerKey + '::' + String(classId) + '::' + String(date);
        const request = db.transaction(['attendance_drafts'], 'readonly').objectStore('attendance_drafts').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function updateSavedAttendanceDraft(classId, date, updates) {
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) return;
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['attendance_drafts'], 'readwrite');
        const store = tx.objectStore('attendance_drafts');
        const id = ownerKey + '::' + String(classId) + '::' + String(date);
        const request = store.get(id);
        request.onsuccess = () => {
            if (request.result) store.put({ ...request.result, ...updates });
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Could not update local attendance draft status.'));
    });
}

function getResultContextKey(data, ownerKey = getOfflineOwnerKey()) {
    if (!ownerKey || !data || !data.class_id || !data.subject_id || !data.session || !data.term) return null;
    return [ownerKey, data.class_id, data.subject_id, data.session, data.term].map(String).join('::');
}

async function getSavedResultDraft(context) {
    const id = getResultContextKey(context);
    if (!id) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction(['results_drafts'], 'readonly').objectStore('results_drafts').get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function saveResultDraftLocal(data) {
    const ownerKey = getOfflineOwnerKey();
    const id = getResultContextKey(data, ownerKey);
    if (!id) throw new Error('Offline account identity or result context is unavailable.');
    const db = await openDB();
    const savedAt = new Date().toISOString();
    const record = { ...data, id, _ownerKey: ownerKey, _savedAt: savedAt };
    await new Promise((resolve, reject) => {
        const tx = db.transaction(['results_drafts'], 'readwrite');
        tx.objectStore('results_drafts').put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Result draft could not be saved on this device.'));
        tx.onabort = () => reject(tx.error || new Error('Result draft storage was aborted.'));
    });
    return { savedAt };
}

async function clearSavedResultDraft(context, expectedSavedAt, clearQueued = false) {
    const id = getResultContextKey(context);
    if (!id) return false;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const stores = clearQueued ? ['results_drafts', 'results_sync'] : ['results_drafts'];
        const tx = db.transaction(stores, 'readwrite');
        const store = tx.objectStore('results_drafts');
        const request = store.get(id);
        request.onsuccess = () => {
            const current = request.result;
            if (current && (!expectedSavedAt || current._savedAt === expectedSavedAt)) store.delete(id);
        };
        if (clearQueued) {
            const queue = tx.objectStore('results_sync');
            const queuedRequest = queue.getAll();
            queuedRequest.onsuccess = () => {
                queuedRequest.result.forEach(item => {
                    if (getResultContextKey(item, item._ownerKey) === id && (!expectedSavedAt || String(item._savedAt || '') <= String(expectedSavedAt))) queue.delete(item.id);
                });
            };
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Could not update saved result draft.'));
        tx.onabort = () => reject(tx.error || new Error('Could not update saved result draft.'));
    });
}

async function saveResultOffline(data) {
    const db = await openDB();
    const ownerKey = getOfflineOwnerKey();
    const contextId = getResultContextKey(data, ownerKey);
    if (!contextId) throw new Error('Offline account identity or result context is unavailable. Reconnect before saving work on this device.');
    const savedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['results_sync', 'results_drafts'], 'readwrite');
        const queue = tx.objectStore('results_sync');
        const drafts = tx.objectStore('results_drafts');
        const request = queue.getAll();
        request.onsuccess = () => {
            const matching = request.result.filter(item => getResultContextKey(item, item._ownerKey) === contextId);
            const record = { ...data, _ownerKey: ownerKey, _savedAt: savedAt };
            if (matching.length) {
                record.id = matching[0].id;
                matching.slice(1).forEach(item => queue.delete(item.id));
            }
            queue.put(record);
            drafts.put({ ...data, id: contextId, _ownerKey: ownerKey, _savedAt: savedAt });
        };
        request.onerror = () => { try { tx.abort(); } catch (error) {} };
        tx.oncomplete = () => {
            updateSyncUI();
            requestBackgroundSync();
            resolve({ savedAt });
        };
        tx.onerror = () => reject(tx.error || request.error || new Error('Offline results could not be stored.'));
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
    const ownerKey = getOfflineOwnerKey();
    if (!ownerKey) return 0;
    const att = await getAllQueued('attendance_sync');
    const res = await getAllQueued('results_sync');
    return att.filter(item => item._ownerKey === ownerKey).length +
        res.filter(item => item._ownerKey === ownerKey).length;
}

async function getPendingAttendanceCount() {
    try {
        const ownerKey = getOfflineOwnerKey();
        const attendanceItems = await getAllQueued('attendance_sync');
        // If account ownership cannot be resolved, fail closed: queued records
        // must not be ignored when deciding whether a register can be submitted.
        if (!ownerKey) return attendanceItems.length;
        return attendanceItems.filter(item => item._ownerKey === ownerKey).length;
    } catch {
        // An unreadable queue cannot prove that attendance is fully synchronized.
        return Number.MAX_SAFE_INTEGER;
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
            console.error('[AcadMeOffline] Could not read attendance queue:', err);
            failCount++;
        }

        for (const item of attendanceItems) {
            try {
                const { id, _savedAt, _ownerKey, ...queuedPayload } = item;
                // Older queued records may carry _submitAfterSync from the removed
                // finalization flow. Strip it and save only the statuses in the draft.
                const payload = { ...queuedPayload };
                delete payload._submitAfterSync;
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
                        await updateSavedAttendanceDraft(payload.class_id, payload.date, {
                            _submitAfterSync: false,
                            _syncedAt: new Date().toISOString()
                        });
                        await deleteQueued('attendance_sync', id);
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (err) {
                console.warn('[AcadMeOffline] Attendance sync item remains queued:', err);
                failCount++;
            }
        }

        let resultItems = [];
        try {
            resultItems = (await getAllQueued('results_sync')).filter(item => item._ownerKey === ownerKey);
        } catch (err) {
            console.error('[AcadMeOffline] Could not read results queue:', err);
            failCount++;
        }

        for (const item of resultItems) {
            try {
                const { id, _savedAt, _ownerKey, ...payload } = item;
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
                        const context = {
                            class_id: payload.class_id,
                            subject_id: payload.subject_id,
                            session: payload.session,
                            term: payload.term
                        };
                        await clearSavedResultDraft(context, _savedAt);
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (err) {
                console.warn('[AcadMeOffline] Result sync item remains queued:', err);
                failCount++;
            }
        }

        updateSyncUI(failCount > 0 ? 'partial' : 'done', successCount, failCount);
    } catch (err) {
        // Always release the lock, even if IndexedDB or UI preparation fails.
        console.error('[AcadMeOffline] Sync cycle failed; queued data was retained where possible:', err);
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

    const pending = await getPendingCount().catch(() => null);
    const quarantined = await getQuarantinedQueueCount().catch(() => 0);
    const quarantineNote = quarantined > 0 ? ' • ' + quarantined + ' older unassigned record(s) held safely' : '';
    const storage = await getOfflineStorageStatus().catch(() => ({ supported: false }));
    const storageNote = !storage.supported
        ? ' • persistent-storage protection unavailable'
        : storage.persistent === true
            ? ' • offline storage protection granted'
            : storage.persistent === false
                ? ' • browser may clear offline data'
                : '';

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
    } else if (pending === null) {
        cls += ' warning';
        html = '<span class="sync-dot"></span> Offline queue could not be checked; register submission is blocked until storage is readable' +
            (navigator.onLine ? ' <button type="button" data-sync-retry style="border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;">Retry sync</button>' : '');
    } else if (state === 'partial') {
        cls += ' warning';
        html = `<span class="sync-dot"></span> ${successCount} synced, ${failCount} failed`;
        if (pending > 0 && navigator.onLine) {
            html += ' <button type="button" data-sync-retry style="border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;">Retry sync</button>';
        }
    } else if (state === 'done' && pending === 0) {
        cls += ' synced';
        html = `<span class="sync-dot"></span> Synced ✓`;
        setTimeout(() => updateSyncUI(), 4000);
    } else if (pending > 0) {
        cls += ' pending';
        html = `<span class="sync-dot"></span> ${pending} unsynced record(s)`;
        if (navigator.onLine) {
            html += ' <button type="button" data-sync-retry style="border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;">Retry sync</button>';
        }
    } else {
        cls += ' online';
        html = `<span class="sync-dot"></span> Online`;
    }

    indicators.forEach(el => {
        el.className = cls;
        el.innerHTML = html + quarantineNote + storageNote;
        const retryButton = el.querySelector('[data-sync-retry]');
        if (retryButton) {
            retryButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (navigator.onLine) syncData();
            });
        }
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
            if (result.supported && !result.granted) console.info('[AcadMeOffline] Browser did not grant persistent storage.');
            updateSyncUI();
        });
        if (!navigator.onLine) {
            document.body.classList.add('is-offline');
        }
        updateSyncUI();
        if (navigator.onLine) syncData();
    }).catch(err => console.warn('[AcadMeOffline] Could not open IndexedDB:', err));
});

// ─── Public API ────────────────────────────────────────────────────────────

window.AcadMeOffline = window.NexusOffline = {
    saveAttendanceOffline,
    getQueuedAttendanceRecord,
    getSavedAttendanceDraft,
    saveResultOffline,
    saveResultDraftLocal,
    getSavedResultDraft,
    clearSavedResultDraft,
    syncData,
    getPendingCount,
    getPendingAttendanceCount,
    getQuarantinedQueueCount,
    getPreparedDatasetStatus,
    recordPreparedDataset,
    getOfflineStorageStatus,
    requestPersistentStorage,
    requestBackgroundSync,
    retentionDays: OFFLINE_RETENTION_DAYS
};
