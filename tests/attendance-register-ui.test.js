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
assert(
    controller.includes("'enrollment_dates_need_review'") &&
    controller.includes("code: generated.reason") &&
    controller.includes('administrative review. Please contact the school administrator.'),
    'register submission must return an actionable enrollment-review conflict'
);
assert(
    view.includes("registerSkipReason === 'enrollment_dates_need_review'") &&
    view.includes('Enrollment dates need review') &&
    view.includes('school administrator confirms or corrects those dates'),
    'attendance page must explain why enrollment-date review blocks entry'
);
assert(
    controller.includes("'no_academic_period'") &&
    controller.includes("'attendance_settings_missing'") &&
    controller.includes('registerBlocked'),
    'missing academic periods and attendance settings must block the attendance page'
);
assert(
    view.includes("registerSkipReason === 'no_academic_period'") &&
    view.includes("registerSkipReason === 'attendance_settings_missing'") &&
    view.includes('Attendance entry and saving are disabled'),
    'attendance page must explain incomplete academic-period and settings setup'
);
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
    attendanceTakeHandler.includes("'enrollment_dates_need_review'") &&
    attendanceTakeHandler.includes('readOnly'),
    'attendance page must be read-only when dated enrollment needs review'
);
assert(
    attendanceSaveHandler.includes("'enrollment_dates_need_review'") &&
    attendanceSaveHandler.includes('res.status(409)') &&
    attendanceSaveHandler.includes('code: generated.reason'),
    'attendance save API must reject dated-enrollment review cases with HTTP 409'
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
assert(view.includes('href="/attendance/closures"'));
assert(app.includes("app.get('/api/cron/attendance-reminders'"));
assert(app.includes('attendanceReminderSchedulerController'));
assert(notificationController.includes('deliverDueRemindersForStaff'));
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
assert(view.includes('href="/attendance/analytics"'));
assert(dashboardService.includes('class_attendance_schedules'));
assert(dashboardService.includes("status = 'approved'"));
assert(dashboardService.includes("register.status === 'submitted'"));
assert(analyticsView.includes('Expected class-days'));
assert(analyticsView.includes('Missing registers'));
assert(analyticsView.includes('Students below attendance threshold'));
assert(analyticsView.includes('Daily attendance trend'));




console.log('[attendance-register-ui] unmarked default, deliberate status cycle, online-only submission, pending-sync guard and responsible-teacher route checks passed.');
