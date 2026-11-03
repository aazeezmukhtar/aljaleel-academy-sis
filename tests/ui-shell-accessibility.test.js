'use strict';

const assert = require('assert');
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
});
