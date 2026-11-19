'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'take.ejs'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'attendanceController.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'attendanceRoutes.js'), 'utf8');
const offline = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'offline-handler.js'), 'utf8');

assert(view.includes("const STATUS_CYCLE = ['Not recorded', 'Present', 'Late', 'Leave', 'Absent']"));
assert(view.includes("const currentStatus = student.status || 'Not recorded';"));
assert(!view.includes("btn.dataset.state === 'Not recorded'") || !view.includes("btn.dataset.state = 'Absent'"));
assert(view.includes("id=\"submit-attendance-register\""));
assert(view.includes("fetch('/attendance/submit'"));
assert(view.includes("if (!navigator.onLine)"));
assert(view.includes("getPendingAttendanceCount"));
assert(offline.includes('async function getPendingAttendanceCount()'));
assert(offline.includes('    getPendingAttendanceCount,'));
assert(offline.includes('if (!ownerKey) return attendanceItems.length;'));
assert(offline.includes('return Number.MAX_SAFE_INTEGER;'));
assert(routes.includes("router.post('/submit', attendanceController.submitAttendanceRegister);"));
assert(routes.includes("router.post('/reopen', attendanceController.reopenAttendanceRegister);"));
assert(controller.includes('attendanceRegisterAdministration.reopenRegister'));
assert(view.includes('id="reopen-attendance-register"'));
assert(view.includes("fetch('/attendance/reopen'"));
assert(view.includes('register.status === \'submitted\' && isAdmin'));
assert(controller.includes('attendanceRegisterWorkflow.saveRegisterProgress'));
assert(controller.includes('attendanceRegisterWorkflow.submitRegister'));
assert(controller.includes('hasRegisterAttendanceAuthority'));

console.log('[attendance-register-ui] unmarked default, deliberate status cycle, online-only submission, pending-sync guard and responsible-teacher route checks passed.');
