'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const offline = fs.readFileSync(path.join(root, 'public', 'js', 'offline-handler.js'), 'utf8');
const attendanceView = fs.readFileSync(path.join(root, 'views', 'attendance', 'take.ejs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services', 'attendanceRegisterWorkflowService.js'), 'utf8');

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

check('offline attendance writes require a resolved account owner and commit to IndexedDB', () => {
    const start = offline.indexOf('async function saveAttendanceOffline(data)');
    const end = offline.indexOf('async function saveResultOffline(data)', start);
    const source = offline.slice(start, end);
    assert.match(source, /const ownerKey = getOfflineOwnerKey\(\)/);
    assert.match(source, /if \(!ownerKey\)/);
    assert.match(source, /store\.add\(\{ \.\.\.data, _ownerKey: ownerKey, _savedAt:/);
    assert.match(source, /tx\.oncomplete/);
    assert.match(source, /tx\.onabort/);
});

check('attendance pending count fails closed when IndexedDB cannot be read', () => {
    const start = offline.indexOf('async function getPendingAttendanceCount()');
    const end = offline.indexOf('async function getQuarantinedQueueCount()', start);
    const source = offline.slice(start, end);
    assert.match(source, /if \(!ownerKey\) return attendanceItems\.length/);
    assert.match(source, /catch \{\s*\/\/ An unreadable queue cannot prove that attendance is fully synchronized\.\s*return Number\.MAX_SAFE_INTEGER;/);
});

check('attendance sync strips local metadata and deletes only after server success', () => {
    const start = offline.indexOf('for (const item of attendanceItems)');
    const end = offline.indexOf('let resultItems', start);
    const source = offline.slice(start, end);
    assert.match(source, /const \{ id, _savedAt, _ownerKey, \.\.\.payload \} = item/);
    assert.match(source, /fetch\('\/attendance\/save'/);
    assert.match(source, /if \(data\.success\)\s*\{\s*await deleteQueued\('attendance_sync', id\)/);
    assert.match(source, /Keep conflicts and validation failures queued for explicit review/);
    assert.match(source, /if \(res\.redirected\)/);
});

check('an unreadable queue is visible and the user can manually retry online sync', () => {
    assert.match(offline, /getPendingCount\(\)\.catch\(\(\) => null\)/);
    assert.match(offline, /Offline queue could not be checked/);
    assert.match(offline, /data-sync-retry/);
    assert.match(offline, /if \(navigator\.onLine\) syncData\(\)/);
});

check('offline attendance save is explicitly described as local and not server-submitted', () => {
    assert.match(attendanceView, /saveAttendanceOffline\(data\)/);
    assert.match(attendanceView, /saved on this device\. It is pending sync and has not yet been saved to the school database/);
});

check('register submission is blocked offline and while attendance queue is pending or unreadable', () => {
    const start = attendanceView.indexOf('async function submitAttendanceRegister()');
    const end = attendanceView.indexOf('const reopenButton', start);
    const source = attendanceView.slice(start, end);
    assert.match(source, /if \(!navigator\.onLine\)/);
    assert.match(source, /getPendingAttendanceCount\(\)/);
    assert.match(source, /pending === Number\.MAX_SAFE_INTEGER/);
    assert.match(source, /if \(pending > 0\)/);
    assert.match(source, /fetch\('\/attendance\/submit'/);
    assert.ok(source.indexOf('if (pending > 0)') < source.indexOf("fetch('/attendance/submit'"));
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
