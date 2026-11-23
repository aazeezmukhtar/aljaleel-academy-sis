'use strict';

const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const header = read('views/partials/header.ejs');
const notificationBar = read('views/partials/notification_bar.ejs');
const modernCss = read('public/css/staff-admin-modern.css');
const adminDashboard = read('views/dashboard.ejs');
const staffDashboard = read('views/dashboard_staff.ejs');
const app = read('app.js');

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('staff and admin pages load the shared modern presentation layer without replacing base styles', () => {
  assert.match(header, /css\/main\.css/);
  assert.match(header, /css\/staff-admin-modern\.css/);
  assert.ok(header.indexOf('staff-admin-modern.css') > header.indexOf('main.css'));
});

check('dashboard notification controls are responsive duplicates, with only the topbar bell visible on mobile', () => {
  [adminDashboard, staffDashboard].forEach((view, index) => {
    const label = index === 0 ? 'admin' : 'staff';
    assert.strictEqual((view.match(/class="notification-bell-container"/g) || []).length, 1,
      label + ' dashboard should retain exactly one desktop content-header notification control');
    assert.match(view, /class="header-actions"/);
  });
  assert.match(header, /class="notification-bell-container"/);
  assert.match(modernCss, /\.content-header \.header-actions \.notification-bell-container\s*\{\s*display: none !important;/);
  assert.match(modernCss, /@media \(max-width: 991px\)/);
  assert.match(header, /id="topbar-notif-badge"/);
  assert.match(notificationBar, /document\.querySelectorAll\('\.notification-badge'\)/);
});

check('notification interactions remain keyboard accessible and update expanded state', () => {
  assert.match(header, /aria-label="Open notifications"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(notificationBar, /setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(notificationBar, /event\.key === 'Escape'/);
});

check('shared presentation layer covers mobile, desktop, touch, focus, and reduced motion', () => {
  assert.match(modernCss, /@media \(max-width: 640px\)/);
  assert.match(modernCss, /@media \(max-width: 991px\)/);
  assert.match(modernCss, /:focus-visible/);
  assert.match(modernCss, /min-height: 44px/);
  assert.match(modernCss, /prefers-reduced-motion: reduce/);
  assert.match(modernCss, /overflow-x: auto/);
});

check('existing staff/admin route mounts and role-specific access boundaries remain unchanged', () => {
  [
    "app.use('/dashboard', isAuthenticated, homeController.getDashboard)",
    "app.use('/students', isAuthenticated, studentRoutes)",
    "app.use('/results', isAuthenticated, resultRoutes)",
    "app.use('/academics', isAuthenticated, academicRoutes)",
    "app.use('/staff', isAuthenticated, staffRoutes)",
    "app.use('/attendance', isAuthenticated, attendanceRoutes)",
    "app.use('/fees', isAuthenticated, feeRoutes)",
    "app.use('/settings', isAuthenticated, settingsRoutes)",
    "app.use('/reports', isAuthenticated, reportRoutes)"
  ].forEach(route => assert.ok(app.includes(route), 'Missing route mount: ' + route));
  const sidebar = read('views/partials/sidebar.ejs');
  assert.match(sidebar, /user\.role==='Admin'/);
  assert.match(sidebar, /user\.role === 'Admin' \|\| user\.role === 'Bursar'/);
  assert.match(sidebar, /user\.role\s*===\s*'Teacher'/);
});

check('shared shell, dashboard templates and notification partial compile as EJS', () => {
  [
    'views/partials/header.ejs',
    'views/partials/notification_bar.ejs',
    'views/partials/sidebar.ejs',
    'views/dashboard.ejs',
    'views/dashboard_staff.ejs'
  ].forEach(file => ejs.compile(read(file), { filename: path.join(__dirname, '..', file) }));
});

check('teacher class and subject panels stack as separate compact rows on phones', () => {
  assert.match(dashboardCss, /\.staff-dashboard-shell \.teacher-dashboard-panels\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(dashboardCss, /teacher-dashboard-panels > \.card,\s*\.staff-dashboard-shell \.teacher-dashboard-panels > \.card:nth-child\(3\)/);
  assert.match(dashboardCss, /assignedClasses\.length > 3/);
  assert.match(dashboardCss, /assignedSubjects\.length > 3/);
});
check('mobile dashboard tiles use compact typography and attendance content stays within its card', () => {
  assert.match(dashboardCss, /font-size: 1\.38rem !important/);
  assert.match(dashboardCss, /admin-attendance-stat \.stat-content\s*\{[\s\S]*?width: calc\(100% - 78px\) !important/);
  assert.match(dashboardCss, /admin-attendance-stat::after\s*\{[\s\S]*?width: 66px !important/);
});
