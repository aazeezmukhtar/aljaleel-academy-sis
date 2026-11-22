'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'take.ejs'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'attendanceController.js'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'attendanceRoutes.js'), 'utf8');
const offline = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'offline-handler.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const notificationController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'notificationController.js'), 'utf8');
const notificationBar = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'notification_bar.ejs'), 'utf8');
const schedulerController = require('../controllers/attendanceReminderSchedulerController');
const analyticsService = fs.readFileSync(path.join(__dirname, '..', 'services', 'attendanceAnalyticsService.js'), 'utf8');
const portalController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'portalController.js'), 'utf8');
const portalAttendanceView = fs.readFileSync(path.join(__dirname, '..', 'views', 'portal', 'attendance.ejs'), 'utf8');
const attendanceReportView = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'report.ejs'), 'utf8');
const dashboardService = fs.readFileSync(path.join(__dirname, '..', 'services', 'attendanceAnalyticsDashboardService.js'), 'utf8');
const analyticsController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'attendanceController.js'), 'utf8');
const analyticsView = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'analytics.ejs'), 'utf8');



assert(view.includes("const STATUS_CYCLE = ['Not recorded', 'Present', 'Late', 'Leave', 'Absent']"));
assert(view.includes("const currentStatus = student.status || 'Not recorded';"));
assert(!view.includes('id="submit-attendance-register"'));
assert(!offline.includes("fetch('/attendance/submit'"));
assert(!view.includes('submitAfterSync: true'));
assert(view.includes('function replaceUnrecordedWithAbsent()'));
assert(view.includes("if (btn && btn.dataset.state === 'Not recorded')"));
assert(view.includes("setStudentStatus(card, 'Absent')"));
assert(view.includes('replaceUnrecordedWithAbsent();'));
assert(view.includes('await offline.saveAttendanceOffline(collectAttendanceFormData())'));




assert(!view.includes("if (!navigator.onLine)"), "Submit must remain available offline");

assert(offline.includes("getPendingAttendanceCount"));
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
assert(controller.includes('hasRegisterAttendanceAuthority'));
const attendanceTakeHandler = controller.slice(
    controller.indexOf('const getTakeAttendance ='),
    controller.indexOf('// GET /attendance/yesterday')
);
const attendanceSaveHandler = controller.slice(
    controller.indexOf('const saveAttendance ='),
    controller.indexOf('// POST /attendance/submit')
);
assert(
    attendanceTakeHandler.includes('readOnly: false') &&
    attendanceTakeHandler.includes('register: null') &&
    !attendanceTakeHandler.includes('generateExpectedRegister'),
    'standard attendance page must remain editable without register or schedule setup'
);
assert(
    attendanceSaveHandler.includes('INSERT INTO attendance') &&
    !attendanceSaveHandler.includes('generateExpectedRegister') &&
    !attendanceSaveHandler.includes('saveRegisterProgress'),
    'standard attendance save must write directly without deferred register setup'
);
const attendanceSubmitHandler = controller.slice(
    controller.indexOf('const submitAttendanceRegister ='),
    controller.indexOf('// POST /attendance/reopen')
);
assert(
    attendanceSubmitHandler.includes("VALUES (?, ?, ?, ?, 'Absent', ?, ?)") &&
    attendanceSubmitHandler.includes('getAttendanceStudents') &&
    !attendanceSubmitHandler.includes('isFoundationAvailable') &&
    !attendanceSubmitHandler.includes('generateExpectedRegister'),
    'only explicit submission may mark unrecorded roster members absent, without register setup'
);


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
assert(!view.includes('href="/attendance/closures"'), 'closure shortcut must not appear on the attendance-taking screen');
assert(app.includes("app.get('/api/cron/attendance-reminders'"));
assert(app.includes('attendanceReminderSchedulerController'));
assert(notificationController.includes('deliverDueRemindersForStaff'), 'legacy feed delivery must remain available until scheduler rollout is verified');
assert(notificationController.includes('ATTENDANCE_REMINDER_SCHEDULER_DELIVERY'));
assert(notificationController.includes('sharedNotificationDelivery.listForRecipient'));
assert(notificationController.includes('sharedNotificationDelivery.isAvailable'));
assert(notificationController.includes('acknowledgeReminder'));
assert(notificationController.includes("ON CONFLICT (user_id, user_type, source_id, source_type) DO NOTHING"));
assert(notificationBar.includes("n.type === 'Attendance Reminder'"));
assert(notificationBar.includes('bi-calendar-check'));
assert.strictEqual(
    schedulerController._test.readCronToken({ headers: { authorization: 'Bearer test-secret' } }),
    'test-secret'
);
assert.strictEqual(schedulerController._test.safeSecretMatch('test-secret', 'test-secret'), true);
assert.strictEqual(schedulerController._test.safeSecretMatch('test-secret', 'wrong-secret'), false);
assert.strictEqual(schedulerController._test.safeSecretMatch('test-secret', ''), false);
assert(controller.includes('attendanceAnalytics.getClassAttendanceReport'));
assert(analyticsService.includes("record.status === 'Leave'"));
assert(analyticsService.includes("record.status === 'Late'"));
assert(analyticsService.includes('attendedDays / totalDays'));
assert(analyticsService.includes("ar.status = 'submitted'"));
assert(portalController.includes('attendanceAnalytics.getStudentAttendanceRecords'));
assert(portalController.includes('attendanceThresholdError'));
assert(portalController.includes('below-threshold alerts may be incomplete'));
assert(portalController.includes('catch {'));
assert(portalController.includes('selectedSectionId'));
assert(portalAttendanceView.includes('selectedSectionId'));
assert(portalAttendanceView.includes('attendanceThresholdError'));
assert(portalAttendanceView.includes('Low-attendance alerts may be incomplete'));
assert(portalAttendanceView.includes('status=leave'));
assert(portalAttendanceView.includes('attendedDays'));
assert(attendanceReportView.includes('row.attendanceRate'));
assert(attendanceReportView.includes('reportMeta.thresholdError'));
assert(attendanceReportView.includes('Threshold alerts may be incomplete'));
assert(!attendanceReportView.includes('row.late * 0.5'));
assert(analyticsController.includes('attendanceAnalyticsDashboard.getDashboard'));
assert(routes.includes("router.get('/analytics', attendanceController.getAttendanceAnalytics);"));
const attendanceSelectionView = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'index.ejs'), 'utf8');
assert(!view.includes('href="/attendance/analytics"'), 'analytics navigation must not clutter the attendance-taking screen');
assert(!view.includes('href="/attendance/closures"'), 'closure shortcut must be removed from the attendance-taking screen');
assert(attendanceSelectionView.includes('href="/attendance/analytics"'), 'analytics must remain accessible from the attendance selection page');
assert(!dashboardService.includes('attendanceScheduleCompatibilityService'));
assert(!dashboardService.includes('class_attendance_schedules'));
assert(!dashboardService.includes('attendance_registers'));
assert(!dashboardService.includes('class_attendance_closures'));
assert(!analyticsController.slice(analyticsController.indexOf('const getAttendanceAnalytics'), analyticsController.indexOf('// GET /attendance/staff')).includes('isFoundationAvailable'));
assert(!analyticsView.includes('start_date'));
assert(!analyticsView.includes('end_date'));
assert(!analyticsView.includes('registerCompletion'));
assert(analyticsView.includes('Students tracked'));
assert(analyticsView.includes('Students below attendance threshold'));
assert(analyticsView.includes('Daily attendance trend'));




console.log('[attendance-register-ui] explicit-save auto-absent, draft preservation, offline save and responsible-teacher route checks passed.');
