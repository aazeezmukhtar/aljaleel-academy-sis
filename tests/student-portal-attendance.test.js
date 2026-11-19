'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const controller = fs.readFileSync(path.join(root, 'controllers/portalController.js'), 'utf8');
const viewPath = path.join(root, 'views/portal/attendance.ejs');
const view = fs.readFileSync(viewPath, 'utf8');
const dashboardPath = path.join(root, 'views/portal/index.ejs');
const dashboardView = fs.readFileSync(dashboardPath, 'utf8');
const block = controller.slice(
  controller.indexOf('exports.getAttendance = async (req, res) => {'),
  controller.indexOf('\n};', controller.indexOf('exports.getAttendance = async (req, res) => {'))
);

ejs.compile(view, { filename: viewPath });
ejs.compile(dashboardView, { filename: dashboardPath });
assert(block.includes("require('../services/attendanceAnalyticsService')"),
  'Student portal must use the same analytics engine as administrative reports.');
assert(block.includes('schoolId, sectionId: selectedSectionId, classId: selectedClassId') &&
  block.includes('studentId, session: selectedSession, term: selectedTerm'),
  'Analytics inputs must be constrained to the authenticated student and one school/section/class/session/term.');
assert(block.includes('WHERE ep.school_id = ? AND ep.student_id = ?') &&
  block.includes('WHERE student_id = ? AND section_id = ?') &&
  block.includes('class_id = ? AND session = ? AND term = ?'),
  'Enrollment and history lookups must remain owned by the authenticated student and exact selected section/class.');
assert(block.includes('section_academic_periods') && block.includes('student_enrollment_periods'),
  'Period selection and expected dates must use configured academic periods and dated enrollment history.');
assert(!/presentCount\s*\/\s*totalDays|Present.*Late.*\/.*totalDays/.test(block),
  'Portal must not calculate a separate attendance percentage.');
assert(view.includes('name="section_id"') && view.includes('sectionOptions.length > 1'),
  'Students with multiple sections must be able to switch sections.');
assert(view.includes('Approved Leave') && view.includes('counts.missingRegister') &&
  view.includes('counts.draftRegister') && view.includes('analytics.warnings'),
  'Portal must explain Leave credit and surface missing/draft/unknown data separately.');
const dashboardBlock = controller.slice(controller.indexOf('exports.getDashboard = async (req, res) => {'), controller.indexOf('\n};', controller.indexOf('exports.getDashboard = async (req, res) => {')));
assert(dashboardBlock.includes("require('../services/attendanceAnalyticsService')") && dashboardBlock.includes('attendanceSummaries'),
  'Dashboard attendance summaries must use the shared analytics engine independently for each enrolled section.');
assert(!dashboardBlock.includes('attendancePercentage') && !/presentCount\\s*\\/\\s*attRows/.test(dashboardBlock),
  'Dashboard must not retain its old locally calculated, cross-section attendance percentage.');
assert(dashboardView.includes('attendanceSummaries.forEach') && dashboardView.includes('summary.section_id'),
  'Dashboard must display separate attendance cards for the student\'s enrolled sections.');
assert(view.includes('An unrecorded day is never labelled absent'),
  'Calendar must not imply absence from an unrecorded day.');

console.log('[student-portal-attendance] EJS compilation, shared analytics, exact student/section/class scope, section selector and data-quality messaging passed.');
