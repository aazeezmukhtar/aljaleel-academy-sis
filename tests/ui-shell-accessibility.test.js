'use strict';

const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const header = read('views/partials/header.ejs');
const sidebar = read('views/partials/sidebar.ejs');
const css = read('public/css/main.css');
const attendance = read('views/attendance/take.ejs');
const results = read('views/results/manager.ejs');
const students = read('views/students/index.ejs');
const fees = read('views/fees/manager.ejs');
const portalNav = read('views/partials/student_shell_nav.ejs');
const portalCss = read('public/css/student-portal.css');

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('mobile menu trigger exposes its controlled navigation state', () => {
  assert.match(header, /aria-controls="main-sidebar"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(sidebar, /aria-controls="main-sidebar"/);
  assert.match(sidebar, /aria-expanded="false"/);
});

check('mobile sidebar can close with Escape and overlay interaction', () => {
  assert.match(sidebar, /event\.key === 'Escape'/);
  assert.match(sidebar, /overlay\.addEventListener\('click'/);
  assert.match(sidebar, /setSidebarOpen\(false\)/);
});

check('mobile sidebar state is synchronized with trigger and viewport changes', () => {
  assert.match(sidebar, /button\.setAttribute\('aria-expanded'/);
  assert.match(sidebar, /window\.matchMedia\('\(max-width: 991px\)'\)/);
  assert.match(sidebar, /sidebar\.classList\.remove\('active'\)/);
});

check('mobile menu closes after selecting a navigation destination', () => {
  assert.match(sidebar, /sidebar\.querySelectorAll\('a'\)/);
  assert.match(sidebar, /if \(mobileQuery\.matches\) setSidebarOpen\(false\)/);
});

check('mobile layout accounts for device safe areas', () => {
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /bottom: calc\(60px \+ env\(safe-area-inset-bottom/);
});

check('interactive navigation has visible keyboard focus and reduced motion is respected', () => {
  assert.match(css, /\.mobile-hamburger:focus-visible/);
  assert.match(css, /\.sidebar a:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

check('attendance provides a live summary of all four attendance statuses', () => {
  assert.match(attendance, /id="attendance-status-summary"[^>]*aria-live="polite"/);
  assert.match(attendance, /function updateAttendanceSummary\(\)/);
  assert.match(attendance, /Object\.entries\(counts\)/);
  assert.match(attendance, /updateAttendanceSummary\(\);/);
});

check('attendance status controls announce the selected student and status', () => {
  assert.match(attendance, /aria-label="Attendance status for/);
  assert.match(attendance, /Activate to change status/);
  assert.match(attendance, /btn\.setAttribute\('aria-label'/);
});

check('mark-all-present warns before replacing existing attendance statuses', () => {
  assert.match(attendance, /window\.confirm\('Mark all '/);
  assert.match(attendance, /This will replace their current statuses/);
});

check('result save button state is available to both success and error handlers', () => {
  const saveFunction = results.slice(results.indexOf('async function saveResults'), results.indexOf('async function updateStatus'));
  assert.match(saveFunction, /const oldText = btn \? btn\.innerHTML : ''/);
  assert.doesNotMatch(saveFunction, /const oldText = btn\.innerHTML/);
  assert.match(saveFunction, /finally \{/);
});

check('result score validation rejects negative values and rechecks before saving', () => {
  assert.match(results, /val < 0 \|\| val > max/);
  assert.match(results, /\[ca1, ca2, exam\]\.forEach\(input => validateInput\(input\)\)/);
});

check('result score inputs identify the student and score component to assistive technology', () => {
  assert.match(results, /aria-label="CA 1 score for/);
  assert.match(results, /aria-label="CA 2 score for/);
  assert.match(results, /aria-label="Exam score for/);
  assert.match(results, /aria-invalid="false"/);
  assert.match(results, /input\.setAttribute\('aria-invalid'/);
});

check('student directory mobile cards retain clickable student and parent contacts', () => {
  assert.match(students, /td\[data-label="Contact Numbers"\][\s\S]*grid-row: 3/);
  assert.match(students, /td\[data-label="Status"\][\s\S]*grid-row: 4/);
  assert.match(students, /td\[data-label="Action"\][\s\S]*grid-row: 4/);
});

check('student directory filter controls have accessible names and expanded state', () => {
  assert.match(students, /aria-label="Filter students by class"/);
  assert.match(students, /aria-label="Filter students by gender"/);
  assert.match(students, /aria-label="Filter students by status"/);
  assert.match(students, /aria-controls="moreFiltersPopover" aria-expanded="false"/);
  assert.match(students, /event\.key === 'Escape'/);
});

check('fee management class selection and empty state are clear', () => {
  assert.match(fees, /<label>Class<\/label>/);
  assert.match(fees, /No students found for the selected criteria/);
  assert.match(fees, /Choose a class above to view student fee balances/);
  assert.match(fees, /alt="Student photo for/);
});

check('student portal navigation identifies the current page', () => {
  assert.match(portalNav, /aria-current="page"/);
  assert.match(portalNav, /acm-nav-item/);
  assert.match(portalNav, /acm-sidebar-item/);
});

check('student portal navigation has 44px touch targets and visible keyboard focus', () => {
  assert.match(portalCss, /\.acm-icon-btn\s*\{[\s\S]*min-width: 44px/);
  assert.match(portalCss, /\.acm-nav-item:focus-visible/);
  assert.match(portalCss, /\.acm-sidebar-item:focus-visible/);
  assert.match(portalCss, /prefers-reduced-motion: reduce/);
});

const studentProfile = read('views/students/view.ejs');
const enrollmentForm = read('views/students/enroll.ejs');

check('student profile uses the shared responsive, offline-aware staff shell', () => {
  assert.match(studentProfile, /include\('\.\.\/partials\/header'\)/);
  assert.match(studentProfile, /include\('\.\.\/partials\/footer'\)/);
  assert.doesNotMatch(studentProfile, /<!DOCTYPE html>|<head>|<\/head>|<body>|<\/body>|<\/html>/i);
  assert.match(studentProfile, /@media \(max-width: 640px\)[\s\S]*\.detail-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(header, /\/js\/offline-handler\.js/);
  assert.match(header, /\/js\/image-optimizer\.js/);
});

check('student enrollment loads shared navigation and browser-side photo cropping', () => {
  assert.match(enrollmentForm, /include\('\.\.\/partials\/header'\)/);
  assert.match(enrollmentForm, /include\('\.\.\/partials\/footer'\)/);
  assert.match(enrollmentForm, /data-crop="square"/);
  assert.doesNotMatch(enrollmentForm, /<!DOCTYPE html>|<head>|<\/head>|<body>|<\/body>|<\/html>/i);
  assert.match(enrollmentForm, /@media \(max-width: 640px\)[\s\S]*\.grid-2 \{ grid-template-columns: 1fr; \}/);
  assert.match(header, /\/js\/image-optimizer\.js/);
});

const adminDashboard = read('views/dashboard.ejs');
const dashboardController = read('controllers/homeController.js');

check('admin dashboard distinguishes missing attendance records from zero attendance', () => {
  assert.match(adminDashboard, /stats\.attendance === 'N\/A' \? '—' : stats\.attendance/);
  assert.match(dashboardController, /FROM staff WHERE status = 'active' AND school_id = \?/);
});

const staffDirectory = read('views/staff/index.ejs');
const staffAdd = read('views/staff/add.ejs');
const staffEdit = read('views/staff/edit.ejs');
const staffProfile = read('views/staff/view.ejs');
const staffDashboard = read('views/dashboard_staff.ejs');
const notificationBar = read('views/partials/notification_bar.ejs');

check('staff directory supports accessible live search and role/status filtering', () => {
  assert.match(staffDirectory, /label for="staff-directory-search"/);
  assert.match(staffDirectory, /label for="staff-role-filter"/);
  assert.match(staffDirectory, /label for="staff-status-filter"/);
  assert.match(staffDirectory, /aria-live="polite"/);
  assert.match(staffDirectory, /function filterStaff\(\)/);
  assert.match(staffDirectory, /staff-directory-no-results/);
  assert.match(staffDirectory, /data-label="Staff ID"/);
});

check('staff registration has associated labels and consistent system roles', () => {
  ['staff-first-name', 'staff-last-name', 'staff-login-id', 'staff-role', 'staff-designation', 'staff-avatar', 'staff-public-bio'].forEach(id => {
    assert.ok(staffAdd.includes('for="' + id + '"'), 'Missing label for ' + id);
  });
  ['Admin', 'Teacher', 'Bursar', 'Principal', 'Staff'].forEach(role => {
    assert.ok(staffAdd.includes('value="' + role + '"'), 'Registration role missing: ' + role);
  });
  assert.match(staffAdd, /data-crop="square"/);
});

check('staff editing preserves website bio, visibility and supports replacing the profile photo', () => {
  ['edit-staff-first-name', 'edit-staff-last-name', 'edit-staff-login-id', 'edit-staff-designation', 'edit-staff-role', 'edit-staff-status', 'edit-staff-avatar', 'edit-staff-public-bio'].forEach(id => {
    assert.ok(staffEdit.includes('for="' + id + '"'), 'Missing label for ' + id);
  });
  assert.match(staffEdit, /name="public_bio"/);
  assert.match(staffEdit, /name="show_on_website"/);
  assert.match(staffEdit, /member\.show_on_website \? 'checked'/);
  assert.match(staffEdit, /data-crop="square"/);
  ['Admin', 'Teacher', 'Bursar', 'Principal', 'Staff'].forEach(role => {
    assert.ok(staffEdit.includes('value="' + role + '"'), 'Edit role missing: ' + role);
  });
});

check('staff profile displays the saved photo and assignment dialogs support keyboard dismissal', () => {
  assert.match(staffProfile, /member\.avatar_image/);
  assert.match(staffProfile, /alt="Profile photo of/);
  assert.match(staffProfile, /role="dialog" aria-modal="true"/);
  assert.match(staffProfile, /event\.key === "Escape"/);
  assert.match(staffProfile, /assignmentModalTrigger\.focus\(\)/);
  assert.match(staffProfile, /min-width: 44px/);
  assert.match(staffProfile, /event\.target !== modal/);
});

check('staff notification dropdowns are keyboard operable and expose expanded state', () => {
  assert.match(staffDashboard, /role="button" tabindex="0"/);
  assert.match(staffDashboard, /event\.key === 'Enter'/);
  assert.match(staffDashboard, /aria-expanded="false"/);
  assert.match(notificationBar, /setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(notificationBar, /trigger\.setAttribute\('aria-expanded', 'false'\)/);
});

check('changed staff EJS templates compile without syntax errors', () => {
  [
    'views/staff/index.ejs',
    'views/staff/add.ejs',
    'views/staff/edit.ejs',
    'views/staff/view.ejs',
    'views/dashboard_staff.ejs',
    'views/partials/header.ejs',
    'views/partials/notification_bar.ejs'
  ].forEach(file => {
    ejs.compile(read(file), { filename: path.join(__dirname, '..', file) });
  });
});
