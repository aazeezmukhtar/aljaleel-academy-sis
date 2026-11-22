'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const offline = fs.readFileSync(path.join(root, 'public', 'js', 'offline-handler.js'), 'utf8');
const attendanceView = fs.readFileSync(path.join(root, 'views', 'attendance', 'take.ejs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services', 'attendanceRegisterWorkflowService.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');

function check(name, fn) {
    try {
        fn();
        console.log('PASS: ' + name);
    } catch (error) {
        console.error('FAIL: ' + name + ' — ' + error.message);
        process.exitCode = 1;
    }
}

check('offline handler parses as JavaScript', () => {
    new Function(offline);
});

check('offline attendance writes are owner-scoped, idempotent per class/date, and retain a local draft', () => {
    const start = offline.indexOf('async function saveAttendanceOffline(data, options = {})');
    const end = offline.indexOf('async function getQueuedAttendanceRecord', start);
    const source = offline.slice(start, end);
    assert.match(source, /const ownerKey = getOfflineOwnerKey\(\)/);
    assert.match(source, /if \(!ownerKey\)/);
    assert.match(source, /String\(item\.class_id\) === String\(data\.class_id\)/);
    assert.match(source, /String\(item\.date\) === String\(data\.date\)/);
    assert.match(source, /store\.put\(record\)/);
    assert.match(source, /drafts\.put\(/);
    assert.match(source, /tx\.oncomplete/);
    assert.match(source, /tx\.onabort/);
});

check('prepared attendance HTML is verified from IndexedDB independently of CacheStorage', () => {
    assert.match(offline, /source: snapshot \? 'indexeddb' : 'cache'/);
    assert.match(offline, /snapshot\.ownerKey !== getOfflineOwnerKey\(\)/);
    assert.match(offline, /verified\.html !== snapshot\.html/);
    assert.match(offline, /durable attendance snapshot could not be verified/i);
    assert.doesNotMatch(offline.slice(offline.indexOf('async function getPreparedDatasetStatus'), offline.indexOf('async function recordPreparedDataset')), /if \(!cached && !snapshot\)/);
});


check('attendance pending count fails closed when IndexedDB cannot be read', () => {
    const start = offline.indexOf('async function getPendingAttendanceCount()');
    const end = offline.indexOf('async function getQuarantinedQueueCount()', start);
    const source = offline.slice(start, end);
    assert.match(source, /if \(!ownerKey\) return attendanceItems\.length/);
    assert.match(source, /catch \{\s*\/\/ An unreadable queue cannot prove that attendance is fully synchronized\.\s*return Number\.MAX_SAFE_INTEGER;/);
});

check('attendance sync saves a draft before completing an offline-submitted register', () => {
    const start = offline.indexOf('for (const item of attendanceItems)');
    const end = offline.indexOf('let resultItems', start);
    const source = offline.slice(start, end);
    assert.match(source, /const \{ id, _savedAt, _ownerKey, _submitAfterSync, \.\.\.payload \} = item/);
    assert.match(source, /fetch\('\/attendance\/save'/);
    assert.match(source, /if \(_submitAfterSync\)/);
    assert.match(source, /fetch\('\/attendance\/submit'/);
    assert.ok(source.indexOf("fetch('/attendance/save'") < source.indexOf("fetch('/attendance/submit'"));
    assert.ok(source.indexOf("fetch('/attendance/submit'") < source.indexOf("deleteQueued('attendance_sync', id)"));
    assert.match(source, /updateSavedAttendanceDraft\(/);
});


check('an unreadable queue is visible and the user can manually retry online sync', () => {
    assert.match(offline, /getPendingCount\(\)\.catch\(\(\) => null\)/);
    assert.match(offline, /Offline queue could not be checked/);
    assert.match(offline, /data-sync-retry/);
    assert.match(offline, /if \(navigator\.onLine\) syncData\(\)/);
});

check('Save Draft persists locally first and syncs only when connected', () => {
    const start = attendanceView.indexOf("document.getElementById('attendance-form').addEventListener('submit'");
    const end = attendanceView.indexOf('async function submitAttendanceRegister()', start);
    const source = attendanceView.slice(start, end);
    assert.match(source, /await offline\.saveAttendanceOffline\(collectAttendanceFormData\(\)\)/);
    assert.match(source, /if \(navigator\.onLine\) await offline\.syncData\(\)/);
    assert.match(source, /pending synchronization/);
});

check('offline Submit finalizes unmarked students locally and queues server submission', () => {
    const start = attendanceView.indexOf('async function submitAttendanceRegister()');
    const end = attendanceView.indexOf('const reopenButton', start);
    const source = attendanceView.slice(start, end);
    assert.doesNotMatch(source, /if \(!navigator\.onLine\)/);
    assert.match(source, /data\.attendance\[studentId\] === 'Not recorded'/);
    assert.match(source, /data\.attendance\[studentId\] = 'Absent'/);
    assert.match(source, /saveAttendanceOffline\(data, \{ submitAfterSync: true \}\)/);
    assert.match(source, /Pending submission/);
    assert.match(source, /await offline\.syncData\(\)/);
});

check('the service worker can recover prepared attendance from IndexedDB and enforces owner boundaries', () => {
    assert.match(serviceWorker, /getDurablePreparedAttendanceResponse/);
    assert.match(serviceWorker, /attendance_prepared/);
    assert.match(serviceWorker, /matchesOfflineEntryContext\(requestedUrl/);
    assert.match(serviceWorker, /item\.ownerKey !== owner/);
    assert.match(serviceWorker, /X-AcadMe-Offline-Recovered/);
    assert.match(serviceWorker, /async function persistPreparedAttendanceSnapshot/);
    assert.ok(serviceWorker.indexOf('await persistPreparedAttendanceSnapshot(request, responseToCache)') < serviceWorker.indexOf("headers.set('X-AcadMe-Offline-Cached', '1')"));
    assert.match(serviceWorker, /cache\.put\(cacheKey, responseToCache\.clone\(\)\)/);
});


check('server submission independently verifies roster snapshot and every deliberate status', () => {
    const start = workflow.indexOf('async function submitRegister(input)');
    const end = workflow.indexOf('return { isFoundationAvailable', start);
    const source = workflow.slice(start, end);
    assert.match(source, /rosterCount !== Number\(register\.expected_student_count\)/);
    assert.match(source, /a\.status IN \('Present', 'Absent', 'Late', 'Leave'\)/);
    assert.match(source, /student\(s\) are still unmarked/);
    assert.match(source, /Attendance records exist for students outside the expected roster/);
    assert.match(source, /status = 'submitted'/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Attendance offline register sync checks complete.');
