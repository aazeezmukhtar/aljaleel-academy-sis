'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const header = read('views/partials/header.ejs');
const tokens = header.indexOf('acadme-tokens.css');
const components = header.indexOf('acadme-components.css');
const shells = header.indexOf('acadme-shells.css');
const students = header.indexOf('acadme-students.css');
const attendance = header.indexOf('acadme-attendance.css');
assert.ok(tokens >= 0 && components > tokens && shells > components && students > shells && attendance > students,
  'Attendance styles must load after all shared layers and Students feature styles');
assert.doesNotMatch(header, /\\\\n\s*<link[^>]*acadme-attendance/,
  'Attendance stylesheet link must be a real HTML line, not a literal escaped newline');

const css = read('public/css/acadme-attendance.css');
for (const selector of [
  '.attendance-page', '.attendance-take-page', '.attendance-tracking-page',
  '.staff-attendance-page', '.attendance-analytics', '.attendance-operations-page'
]) assert.ok(css.includes(selector), `Missing Attendance page styling scope: ${selector}`);
assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /prefers-reduced-motion:reduce/);

const tokenSource = read('public/css/acadme-tokens.css');
const defined = new Set([...tokenSource.matchAll(/(--acm-[\w-]+)\s*:/g)].map(match => match[1]));
const used = [...css.matchAll(/var\((--acm-[\w-]+)/g)].map(match => match[1]);
for (const token of used) assert.ok(defined.has(token), `Undefined AcadMe token: ${token}`);

const files = [
  'views/attendance/index.ejs',
  'views/attendance/take.ejs',
  'views/attendance/tracking.ejs',
  'views/attendance/staff.ejs',
  'views/attendance/analytics.ejs',
  'views/attendance/operations.ejs'
];
for (const file of files) ejs.compile(read(file), { filename: path.join(__dirname, '..', file) });

const directory = read('views/attendance/index.ejs');
const take = read('views/attendance/take.ejs');
const offline = read('public/js/offline-handler.js');
const worker = read('public/sw.js');
assert.match(directory, /function buildAttendancePreparationDates\(today, selectedDate\)/);
assert.match(directory, /X-AcadMe-Offline-Prepare/);
assert.match(take, /await offline\.saveAttendanceOffline\(collectAttendanceFormData\(\)\)/);
assert.match(take, /replaceUnrecordedWithAbsent\(\)/);
assert.match(offline, /async function saveAttendanceOffline\(data, options = \{\}\)/);
assert.match(offline, /async function getPreparedDatasetStatus/);
assert.match(worker, /url\.pathname === '\/attendance\/take'/);

console.log('AcadMe Attendance UI presentation checks passed.');
