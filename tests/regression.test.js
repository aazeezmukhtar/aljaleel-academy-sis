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
  ['enrollment-session.test.js', 'Enrollment session isolation unit tests'],
  ['app-smoke.test.js', 'Application HTTP smoke test']
];

let failed = 0;
console.log('=== AcadMe Recovery Regression Checks ===');
console.log('Database tests use disposable SQLite only; result scoring and attendance streak tests are pure unit tests. No production credentials or data are used.');

for (const [file, label] of tests) {
  console.log('\n--- ' + label + ' ---');
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_TYPE: 'sqlite',
      DB_PATH: process.env.DB_PATH || '.test-database.sqlite',
      SESSION_SECRET: 'ci-only-session-secret-that-is-long-enough-123456'
    },
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
