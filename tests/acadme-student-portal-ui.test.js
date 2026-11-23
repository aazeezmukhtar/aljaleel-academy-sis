const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const head = read('views/partials/student_shell_head.ejs');
const calendarLink = head.indexOf('/css/acadme-calendar.css');
const portalLink = head.indexOf('/css/acadme-student-portal.css');
assert(calendarLink >= 0 && portalLink > calendarLink, 'Student Portal stylesheet must load after shared calendar styles');
const css = read('public/css/acadme-student-portal.css');
for (const token of ['--acm-', 'max-width:640px', 'prefers-reduced-motion', ':focus-visible']) {
  assert(css.includes(token), 'Missing expected responsive/accessibility styling: ' + token);
}
const pages = [
  ['views/portal/index.ejs', 'portal-home-page'],
  ['views/portal/profile.ejs', 'portal-profile-page'],
  ['views/portal/attendance.ejs', 'portal-attendance-page'],
  ['views/portal/academics/index.ejs', 'portal-academics-page'],
  ['views/portal/academics/results.ejs', 'portal-results-page'],
  ['views/portal/academics/subjects.ejs', 'portal-subjects-page'],
  ['views/portal/academics/timetable.ejs', 'portal-timetable-page'],
  ['views/portal/academics/class-board.ejs', 'portal-class-board-page'],
  ['views/portal/announcement.ejs', 'portal-announcement-page'],
  ['views/portal/assignment.ejs', 'portal-assignment-page'],
  ['views/portal/notifications.ejs', 'portal-notifications-page'],
  ['views/portal/calendar.ejs', 'portal-calendar-ui-page'],
  ['views/portal/change_password.ejs', 'portal-password-page']
];
for (const [file, scope] of pages) {
  const source = read(file);
  assert(source.includes(scope), file + ' must have its page scope class');
  assert(source.includes('student_shell_head'), file + ' must retain Student Portal shell');
  ejs.compile(source, { filename: path.join(root, file) });
}
const profile = read('views/portal/profile.ejs');
assert(profile.includes('action="/portal/profile"') && profile.includes('name="passport"'), 'Profile photo upload must remain intact');
const password = read('views/portal/change_password.ejs');
for (const field of ['current_password', 'new_password', 'confirm_password']) assert(password.includes('name="' + field + '"'), 'Password field missing: ' + field);
const notifications = read('views/portal/notifications.ejs');
assert(notifications.includes('/portal/notifications/mark-all-read') && notifications.includes('?filter=unread'), 'Notification actions/filters must remain intact');
console.log('AcadMe Student Portal UI source checks passed.');
