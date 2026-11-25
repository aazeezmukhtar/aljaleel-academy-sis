'use strict';

const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const routes = read('routes/portalRoutes.js');
const head = read('views/partials/student_shell_head.ejs');
const nav = read('views/partials/student_shell_nav.ejs');
const modernCss = read('public/css/student-portal-modern.css');
const referenceCss = read('public/css/student-dashboard-reference.css');
const sharedHeader = read('views/partials/header.ejs');
const studentHeader = read('views/partials/student_shell_header.ejs');
const portalController = read('controllers/portalController.js');

const templates = [
  'views/portal/index.ejs',
  'views/portal/profile.ejs',
  'views/portal/change_password.ejs',
  'views/portal/calendar.ejs',
  'views/portal/announcement.ejs',
  'views/portal/assignment.ejs',
  'views/portal/attendance.ejs',
  'views/portal/notifications.ejs',
  'views/portal/academics/index.ejs',
  'views/portal/academics/results.ejs',
  'views/portal/academics/class-board.ejs',
  'views/portal/academics/subjects.ejs',
  'views/portal/academics/timetable.ejs'
];

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('all student portal routes remain registered without changing their handlers', () => {
  [
    "router.get('/', portalController.getDashboard)",
    "router.get('/profile', portalController.getProfile)",
    "router.get('/attendance', portalController.getAttendance)",
    "router.get('/calendar', portalController.getCalendar)",
    "router.get('/notifications', portalController.getNotifications)",
    "router.get('/academics', portalController.getAcademicsHub)",
    "router.get('/academics/results', portalController.getAcademicsResults)",
    "router.get('/academics/class-board', portalController.getAcademicsClassBoard)",
    "router.get('/academics/subjects', portalController.getAcademicsSubjects)",
    "router.get('/academics/timetable', portalController.getAcademicsTimetable)",
    "router.get('/results/termly', portalController.viewTermlyResult)",
    "router.get('/results/cumulative', portalController.viewCumulativeResult)"
  ].forEach(route => assert.ok(routes.includes(route), 'Missing route: ' + route));
});

check('shared student shell loads the unified portal presentation stylesheet after base styles', () => {
  assert.match(head, /student-portal\.css/);
  assert.match(head, /student-portal-modern\.css/);
  assert.ok(head.indexOf('student-portal-modern.css') > head.indexOf('student-portal.css'));
});

check('mobile and desktop navigation expose the calendar and preserve active-page semantics', () => {
  assert.match(nav, /href="\/portal\/calendar"/);
  assert.match(nav, /currentPath\.startsWith\('\/portal\/calendar'\)/);
  assert.match(nav, /aria-current="page"/);
  assert.match(nav, /acm-bottom-nav/);
  assert.match(nav, /acm-sidebar/);
});

check('unified portal stylesheet provides responsive layouts, focus states and reduced-motion support', () => {
  assert.match(modernCss, /@media \(max-width: 767px\)/);
  assert.match(modernCss, /@media \(min-width: 768px\)/);
  assert.match(modernCss, /:focus-visible/);
  assert.match(modernCss, /prefers-reduced-motion: reduce/);
  assert.match(modernCss, /overflow-x: auto/);
  assert.match(modernCss, /safe-area-inset-bottom/);
});

check('every student portal page compiles as EJS and uses the shared shell', () => {
  templates.forEach(file => {
    const source = read(file);
    assert.match(source, /student_shell_nav/ , file + ' must use shared navigation');
    if (file !== 'views/portal/calendar.ejs') {
      assert.match(source, /student_shell_head|include\('\.\/head'\)/, file + ' must load shared head');
    }
    ejs.compile(source, { filename: path.join(__dirname, '..', file) });
  });
});

check('calendar uses the shared portal shell and preserves event rendering fields', () => {
  const calendar = read('views/portal/calendar.ejs');
  assert.match(calendar, /student_shell_head/);
  assert.match(calendar, /student_shell_nav/);
  assert.match(calendar, /event\.event_date/);
  assert.match(calendar, /event\.title/);
  assert.match(calendar, /event\.description/);
  assert.match(calendar, /event\.type/);
  assert.match(calendar, /No upcoming events/);
});

check('student identity and section-owned academic context remain represented in portal templates', () => {
  const dashboard = read('views/portal/index.ejs');
  const profile = read('views/portal/profile.ejs');
  const academicResults = read('views/portal/academics/results.ejs');
  assert.match(dashboard, /sectionInfo/);
  assert.match(profile, /sectionInfo/);
  assert.match(academicResults, /selectedClassId/);
  assert.match(academicResults, /selectedClass\.section_name/);
});


check('student dashboard matches the reference composition and only offers Academy/Tahfeez switching for dual-section students', () => {
  const dashboard = read('views/portal/index.ejs');
  assert.match(dashboard, /acm-attendance-feature/);
  assert.match(dashboard, /acm-student-stat-grid/);
  assert.match(dashboard, /acm-smart-analysis/);
  assert.match(dashboard, /acm-dashboard-results/);
  assert.match(dashboard, /acm-dashboard-announcements/);
  assert.match(dashboard, /sectionNames\.includes\('academy'\).*sectionNames\.includes\('tahfeez'\)/);
  assert.match(dashboard, /data-section-switch/);
  assert.match(portalController, /dashboardSectionStats/);
  assert.match(portalController, /r\.class_id = \? AND r\.session = \? AND r\.term = \?/);
  assert.match(portalController, /JOIN classes c ON c\.id = r\.class_id/);
});
check('student dashboard keeps performance data section-owned and compact typography is loaded', () => {
  assert.match(portalController, /section_id, r\.session, r\.term/);
  assert.match(portalController, /sectionId: Number\(section\.section_id\)/);
  assert.match(referenceCss, /\.acm-attendance-feature/);
  assert.match(referenceCss, /\.acm-student-stat-grid/);
  assert.match(referenceCss, /@media\(max-width:380px\)/);
});
check('student, staff and admin mobile headers use the same single-line school-name treatment', () => {
  assert.match(studentHeader, /mobile-topbar-title/);
  assert.match(studentHeader, /school\.school_name/);
  assert.match(sharedHeader, /school\.school_name/);
  assert.match(sharedHeader, /currentSchool\.school_name/);
});
