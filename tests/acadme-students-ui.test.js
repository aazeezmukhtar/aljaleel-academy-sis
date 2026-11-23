'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const shell = read('views/partials/header.ejs');
const tokens = shell.indexOf('acadme-tokens.css');
const components = shell.indexOf('acadme-components.css');
const shells = shell.indexOf('acadme-shells.css');
const feature = shell.indexOf('acadme-students.css');
assert.ok(tokens >= 0 && components > tokens && shells > components && feature > shells,
  'Students feature styles must load after shared tokens, components and shell styles');

const css = read('public/css/acadme-students.css');
for (const selector of [
  '.student-mobile-cards', '.profile-header', '.student-edit-card', '.student-enroll-page'
]) {
  assert.ok(css.includes(selector), `Students stylesheet must cover ${selector}`);
}
assert.match(css, /var\(--acm-/,
  'Students styles must consume shared AcadMe design tokens');
assert.match(css, /@media \(max-width: 640px\)/,
  'Students pages must define a mobile layout');
assert.match(css, /prefers-reduced-motion: reduce/,
  'Students transitions must respect reduced-motion preferences');

const directory = read('views/students/index.ejs');
const profile = read('views/students/view.ejs');
const edit = read('views/students/edit.ejs');
const enroll = read('views/students/enroll.ejs');
assert.match(directory, /id="studentSearchForm"/);
assert.match(directory, /id="studentTableBody"/);
assert.match(profile, /prepareOfflineStudentProfile/);
assert.match(profile, /resetPassword\(/);
assert.match(edit, /student-edit-card/);
assert.match(enroll, /studentEnrollmentForm/);
assert.match(enroll, /enctype="multipart\/form-data"/);

console.log('AcadMe Students UI presentation checks passed.');
