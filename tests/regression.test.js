'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const tests = [
  ['role-access-control.test.js', 'Static recovery baseline'],
  ['database-fixture.test.js', 'Isolated SQLite schema smoke test']
];

let failed = 0;
console.log('=== AcadMe Recovery Regression Checks ===');
console.log('Legacy tenant-isolation suites are excluded because they assert multi-school behavior, which is outside this project scope.');

for (const [file, label] of tests) {
  console.log('\n--- ' + label + ' ---');
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: { ...process.env, DB_TYPE: 'sqlite', DB_PATH: process.env.DB_PATH || '.test-database.sqlite' }
  });
  if (result.error || result.status !== 0) {
    failed++;
    console.error('FAILED: ' + label);
  } else {
    console.log('PASSED: ' + label);
  }
}

console.log('\nSummary: ' + (tests.length - failed) + ' passed, ' + failed + ' failed.');
if (failed) process.exit(1);
