'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const controller = fs.readFileSync(path.join(root, 'controllers/attendanceController.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'routes/reportRoutes.js'), 'utf8');
const reportViewPath = path.join(root, 'views/attendance/report.ejs');
const reportView = fs.readFileSync(reportViewPath, 'utf8');
const dashboardViewPath = path.join(root, 'views/reports/attendance/index.ejs');
const dashboardView = fs.readFileSync(dashboardViewPath, 'utf8');
const lowViewPath = path.join(root, 'views/reports/attendance/low.ejs');
const lowView = fs.readFileSync(lowViewPath, 'utf8');
const dailyViewPath = path.join(root, 'views/reports/attendance/daily.ejs');
const dailyView = fs.readFileSync(dailyViewPath, 'utf8');
const monthlyViewPath = path.join(root, 'views/reports/attendance/register.ejs');
const monthlyView = fs.readFileSync(monthlyViewPath, 'utf8');
const attendanceReportController = fs.readFileSync(path.join(root, 'controllers/reporting/attendanceReportController.js'), 'utf8');

ejs.compile(reportView, { filename: reportViewPath });
ejs.compile(dashboardView, { filename: dashboardViewPath });
ejs.compile(lowView, { filename: lowViewPath });
ejs.compile(dailyView, { filename: dailyViewPath });
ejs.compile(monthlyView, { filename: monthlyViewPath });

const reportBlock = controller.slice(
  controller.indexOf('// GET /attendance/report - section-safe report'),
  controller.indexOf('// GET /attendance/staff')
);
assert(reportBlock.includes('c.form_teacher_id = ?'), 'Teacher report class list must be restricted to current form-master assignment.');
assert(!reportBlock.includes('class_assignments') && !reportBlock.includes('subject_assignments') &&
  !reportBlock.includes('class_attendance_responsibilities'),
  'Subject, general class and register responsibility assignments must not grant report access.');
assert(reportBlock.includes("require('../services/attendanceAnalyticsService')"),
  'Class reports must use the shared attendance analytics engine.');
assert(reportBlock.includes('student_enrollment_periods') && reportBlock.includes('start_date') && reportBlock.includes('end_date'),
  'Roster must use dated enrollment records and must not infer historical eligibility.');
assert(reportBlock.includes('section_id') && reportBlock.includes('school_id'),
  'Report data must remain school and section scoped.');
assert(routes.includes("router.get('/attendance', isAdmin,") &&
  routes.includes("router.get('/attendance/register', isAdmin,") &&
  routes.includes("router.get('/attendance/low', isAdmin,") &&
  routes.includes("router.get('/attendance/daily', isAdmin,"),
  'School-wide legacy attendance reports must be Admin-only.');
assert(reportView.includes('row.missing_register'),
  'Report must display missing registers separately.');
assert(reportView.includes('row.draft_register') && reportView.includes('row.attendance_rate'),
  'Report must display draft registers and shared-engine attendance rate.');

assert(dashboardView.includes('selectedSectionId') && dashboardView.includes('Academy and Tahfeez are never combined'),
  'Administrative dashboard must require one section and explain section isolation.');
assert(dashboardView.includes('stats.submitted_registers'), 'Dashboard must surface formal register submissions.');
assert(attendanceReportController.includes("require('../../services/attendanceAnalyticsService')"), 'Administrative attendance reports must use the shared analytics engine.');
assert(attendanceReportController.includes("require('../../services/attendanceThresholdService')") &&
  attendanceReportController.includes('.getThreshold(schoolId, req.query.threshold)') &&
  attendanceReportController.includes('.getThreshold(schoolId)'),
  'Administrative reports and the dashboard must use the same saved school attendance threshold, with an optional report-only override.');
assert(attendanceReportController.includes("require('../../services/expectedAttendanceDaysService')") &&
  attendanceReportController.includes("day.status === 'expected'") &&
  attendanceReportController.includes('expectedClassIds.size'),
  'Dashboard expected-register totals must include only classes scheduled to open and not closed on the selected date.');
assert(attendanceReportController.includes('date_status = \'confirmed\''),
  'Dashboard roster must exclude enrollment dates that have not been confirmed.');
assert(lowView.includes('student.attendance_rate') && lowView.includes('student.missing_registers'), 'Low-attendance alerts must display shared-engine rates and missing registers.');
assert(attendanceReportController.includes("ar.status = 'submitted'"), 'Daily and monthly register views must exclude unsubmitted drafts.');
assert(dailyView.includes('name="section_id"'), 'Daily register view must require a section selection.');

console.log('[attendance-report-ui] EJS compilation, form-master-only access, shared analytics integration, dated roster, section isolation and Admin-only school-wide routes passed.');
