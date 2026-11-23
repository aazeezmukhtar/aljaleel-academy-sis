'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const shell = read('views/partials/header.ejs');
const tokens = shell.indexOf('acadme-tokens.css');
const students = shell.indexOf('acadme-students.css');
const feature = shell.indexOf('acadme-student-import.css');
assert.ok(tokens >= 0 && students > tokens && feature > students,
  'Bulk import styles must load after shared tokens and student styles');

const css = read('public/css/acadme-student-import.css');
for (const selector of [
  '.bulk-student-import-page', '#importForm', '#studentFile',
  '#statusSection', '#errorList', '#duplicateList'
]) {
  assert.ok(css.includes(selector), `Bulk import styles must cover ${selector}`);
}
assert.match(css, /var\(--acm-/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /prefers-reduced-motion: reduce/);

const page = read('views/students/bulk-import.ejs');
assert.match(page, /class="main-content bulk-student-import-page"/);
assert.match(page, /id="importForm"/);
assert.match(page, /name="default_class_id"/);
assert.match(page, /name="studentFile"/);
assert.match(page, /accept="\.xlsx,\.xls"/);
assert.match(page, /fetch\('\/students\/bulk-import'/);
assert.match(page, /result\.errors/);
assert.match(page, /result\.duplicates/);
assert.match(page, /window\.location\.href = '\/students'/);

const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.scripts['test:acadme-student-import-ui'],
  'node tests/acadme-student-import-ui.test.js');

console.log('AcadMe Student Bulk Import UI source checks passed.');
