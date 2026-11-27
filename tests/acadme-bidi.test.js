'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const script = read('public/js/acadme-bidi.js');
new vm.Script(script, { filename: 'acadme-bidi.js' });
assert.match(script, /\\u0600-\\u06FF/, 'Arabic Unicode ranges must be detected');
assert.match(script, /MutationObserver/, 'Dynamically inserted content must be oriented');
assert.match(script, /element\.dir = isArabic\(value\) \? 'rtl' : 'ltr'/);

const css = read('public/css/acadme-bidi.css');
assert.match(css, /unicode-bidi:\s*plaintext/);
assert.match(css, /:dir\(rtl\)/);
for (const file of ['views/partials/header.ejs', 'views/partials/student_shell_head.ejs']) {
  const source = read(file);
  assert.match(source, /acadme-bidi\.css/);
  assert.match(source, /acadme-bidi\.js/);
  ejs.compile(source, { filename: path.join(__dirname, '..', file) });
}
const contentPages = [
  'views/announcements/view.ejs',
  'views/portal/announcement.ejs',
  'views/portal/assignment.ejs',
  'views/portal/academics/class-board.ejs',
  'views/staff/board.ejs',
  'views/announcements/form.ejs'
];
for (const file of contentPages) {
  const source = read(file);
  ejs.compile(source, { filename: path.join(__dirname, '..', file) });
}
assert.match(read('views/announcements/view.ejs'), /announcement-content[^>]*dir="auto"/);
assert.match(read('views/portal/announcement.ejs'), /acm-detail-body[^>]*dir="auto"/);
assert.match(read('views/portal/assignment.ejs'), /acm-detail-body[^>]*dir="auto"/);
assert.match(read('views/staff/board.ejs'), /name="content" dir="auto"/);
assert.match(read('views/announcements/form.ejs'), /name="content" dir="auto"/);

const studentLogin = read('views/auth/student_login.ejs');
const staffLogin = read('views/auth/login.ejs');
assert.match(studentLogin, /id="toggle-pwd-icon"/);
assert.match(staffLogin, /id="toggle-pwd-icon"/);\nassert.match(staffLogin, /portal-login\.css/);\nassert.match(staffLogin, /role-login-refresh\.css\?v=7/);
assert.match(staffLogin, /getElementById\('toggle-pwd-icon'\)/);
assert.match(read('public/css/role-login-refresh.css'), /width:100vw/);
console.log('AcadMe bidirectional text and login polish checks passed.');
