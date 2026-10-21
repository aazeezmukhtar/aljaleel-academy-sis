'use strict';

// The legacy database-backed suites assume a pre-populated application schema.
// The repository does not currently provide a clean schema bootstrap/fixture for
// CI, and running startup migrations alone against an empty SQLite file fails.
// Do not run those suites against production or pretend they passed. Until an
// isolated fixture is added, CI runs only the static recovery-baseline checks.
const { spawnSync } = require('child_process');
const path = require('path');

const staticTest = path.join(__dirname, 'role-access-control.test.js');
console.log('=== AcadMe Recovery Baseline Checks ===');
console.log('Database-backed legacy suites are intentionally not run: clean SQLite schema fixture is missing.');

const result = spawnSync(process.execPath, [staticTest], { stdio: 'inherit', env: { ...process.env } });
if (result.error) {
  console.error('Unable to start static baseline test:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}
console.log('Static baseline checks: PASS');
console.log('Full database regression coverage: NOT RUN (fixture prerequisite outstanding)');
