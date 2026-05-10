/**
 * Nexus SIS Offline Handler
 * Manages IndexedDB for offline attendance and results entry.
 */

const DB_NAME = 'NexusSIS_OfflineDB';
const DB_VERSION = 1;

let db;

// Initialize IndexedDB
const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('attendance_sync')) {
        db.createObjectStore('attendance_sync', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('results_sync')) {
        db.createObjectStore('results_sync', { keyPath: 'id', autoIncrement: true });
    }
};

request.onsuccess = (event) => {
    db = event.target.result;
    console.log('IndexedDB initialized');
    checkOnlineStatus();
};

request.onerror = (event) => {
    console.error('IndexedDB error:', event.target.error);
};

/**
 * Saves attendance data to IndexedDB
 */
async function saveAttendanceOffline(data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['attendance_sync'], 'readwrite');
        const store = transaction.objectStore('attendance_sync');
        const request = store.add({
            ...data,
            timestamp: new Date().toISOString()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Saves result data to IndexedDB
 */
async function saveResultOffline(data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['results_sync'], 'readwrite');
        const store = transaction.objectStore('results_sync');
        const request = store.add({
            ...data,
            timestamp: new Date().toISOString()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Synchronizes all pending data
 */
async function syncData() {
    if (!navigator.onLine) return;

    console.log('Syncing data...');
    updateSyncUI('syncing', 'Syncing data...');

    try {
        await syncAttendance();
        await syncResults();
        updateSyncUI('online', 'All data synced');
    } catch (err) {
        console.error('Sync failed:', err);
        updateSyncUI('error', 'Sync failed. Will retry later.');
    }
}

async function syncAttendance() {
    const transaction = db.transaction(['attendance_sync'], 'readwrite');
    const store = transaction.objectStore('attendance_sync');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
            const items = request.result;
            for (const item of items) {
                try {
                    const response = await fetch('/attendance/mark', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item)
                    });
                    if (response.ok) {
                        db.transaction(['attendance_sync'], 'readwrite').objectStore('attendance_sync').delete(item.id);
                    }
                } catch (err) {
                    console.error('Failed to sync attendance item:', item, err);
                }
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

async function syncResults() {
    const transaction = db.transaction(['results_sync'], 'readwrite');
    const store = transaction.objectStore('results_sync');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = async () => {
            const items = request.result;
            for (const item of items) {
                try {
                    const response = await fetch('/results/bulk-save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item)
                    });
                    if (response.ok) {
                        db.transaction(['results_sync'], 'readwrite').objectStore('results_sync').delete(item.id);
                    }
                } catch (err) {
                    console.error('Failed to sync result item:', item, err);
                }
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

function updateSyncUI(status, message) {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;

    indicator.className = 'sync-indicator ' + status;
    indicator.innerHTML = `<span class="dot"></span> ${message}`;
}

function checkOnlineStatus() {
    if (navigator.onLine) {
        updateSyncUI('online', 'Online');
        syncData();
    } else {
        updateSyncUI('offline', 'Offline Mode');
    }
}

window.addEventListener('online', checkOnlineStatus);
window.addEventListener('offline', checkOnlineStatus);

// Export to window for access from forms
window.NexusOffline = {
    saveAttendanceOffline,
    saveResultOffline,
    syncData
};
