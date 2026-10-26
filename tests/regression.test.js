'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const tests = [
  ['role-access-control.test.js', 'Static recovery baseline'],
  ['auth-middleware.test.js', 'Authentication middleware unit tests'],
  ['session-secret.test.js', 'Session secret configuration unit tests'],
  ['database-fixture.test.js', 'Isolated SQLite schema smoke test'],
  ['result-helper.test.js', 'Result scoring unit tests'],
  ['attendance-streak.test.js', 'Attendance streak and history unit tests'],
  ['attendance-student-helper.test.js', 'Attendance missing-student rows regression tests'],
  ['enrollment-session.test.js', 'Enrollment session isolation unit tests'],
  ['student-enrollment-update.test.js', 'Student update class validation tests'],
  ['new-student-enrollment.test.js', 'New student enrollment consistency tests'],
  ['bulk-student-import.test.js', 'Bulk student import validation and atomicity tests'],
  ['section-calendar-isolation.test.js', 'Global and section academic calendar isolation tests'],
  ['class-deletion-history.test.js', 'Historical enrollment and attendance protection tests'],
  ['promotion-regression.test.js', 'Promotion history, session, rollback, and calendar regression tests'],
  ['promotion-preview-rendering.test.js', 'Promotion preview HTML escaping checks'],
  ['app-smoke.test.js', 'Application HTTP smoke test'],
  ['offline-cache-policy.test.js', 'Offline service-worker cache privacy policy tests'],
  ['offline-sync-recovery.test.js', 'Offline sync lock recovery regression tests']
];

let failed = 0;
console.log('=== AcadMe Recovery Regression Checks ===');
console.log('Database tests use disposable SQLite only; result scoring and attendance streak tests are pure unit tests. No production credentials or data are used.');

for (const [file, label] of tests) {
  console.log('\n--- ' + label + ' ---');
  const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DB_TYPE: 'sqlite',
    DB_PATH: process.env.DB_PATH || '.test-database.sqlite',
    SESSION_SECRET: 'ci-only-session-secret-that-is-long-enough-123456'
  };
  // Never pass production database connection strings to child test processes.
  delete testEnv.DATABASE_URL;
  delete testEnv.DB_POOL_URL;
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: testEnv,
    timeout: 30000
  });
  if (result.error || result.status !== 0) {
    failed++;
    console.error('FAILED: ' + label + (result.error ? ' (' + result.error.message + ')' : ''));
  } else {
    console.log('PASSED: ' + label);
  }
}

console.log('\nSummary: ' + (tests.length - failed) + ' passed, ' + failed + ' failed.');
if (failed) process.exit(1);
