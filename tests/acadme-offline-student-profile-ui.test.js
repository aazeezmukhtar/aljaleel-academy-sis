'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const shell = read('views/partials/header.ejs');
const students = shell.indexOf('acadme-students.css');
const offline = shell.indexOf('acadme-offline-student-profile.css');
assert.ok(students >= 0 && offline > students,
  'Offline profile styles must load after the shared student feature styles');

const page = read('views/students/offline-view.ejs');
assert.match(page, /offline-student-profile-page/);
assert.match(page, /data-acadme-offline-profile="true"/);
assert.match(page, /Limited offline student profile/);
assert.match(page, /student\.dob/);
assert.match(page, /student\.parent_phone_alt/);
assert.match(page, /This offline copy excludes financial information, health records, residential addresses and academic results/);
assert.match(page, /classAssignments\.forEach/);
assert.doesNotMatch(page, /<style>/, 'Offline profile page styles must live in the feature stylesheet');

const css = read('public/css/acadme-offline-student-profile.css');
for (const selector of ['.offline-student-heading', '.offline-student-grid', '.offline-class-chip', '.offline-profile-limit']) {
  assert.ok(css.includes(selector), `Offline profile stylesheet must cover ${selector}`);
}
assert.match(css, /var\(--acm-/);
assert.match(css, /max-width: 640px/);
assert.match(css, /prefers-reduced-motion: reduce/);

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.scripts['test:acadme-offline-student-profile-ui'],
  'node tests/acadme-offline-student-profile-ui.test.js');

console.log('AcadMe offline student profile UI source checks passed.');
