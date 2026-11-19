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
const closureController = controller.includes('attendanceClosureService.requestClosure') &&
    controller.includes('attendanceClosureService.decideClosure') &&
    controller.includes('attendanceClosureService.cancelClosure');
const closureRoutes = routes.includes("router.get('/closures', attendanceController.getAttendanceClosures);") &&
    routes.includes("router.post('/closures/request', attendanceController.requestAttendanceClosure);") &&
    routes.includes("router.post('/closures/decide', attendanceController.decideAttendanceClosure);") &&
    routes.includes("router.post('/closures/cancel', attendanceController.cancelAttendanceClosure);");
const closureView = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'closures.ejs'), 'utf8');
assert(closureController, 'closure requests and decisions must be wired through the controller');
assert(closureRoutes, 'closure management routes must be registered');
assert(closureView.includes('Submit closure request'));
assert(closureView.includes('data-closure-action="approved"') || closureView.includes('data-closure-action="<%= item.status'));
assert(view.includes('href="/attendance/closures"'));


console.log('[attendance-register-ui] unmarked default, deliberate status cycle, online-only submission, pending-sync guard and responsible-teacher route checks passed.');
