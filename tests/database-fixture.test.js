'use strict';

const assert = require('assert');

process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = process.env.DB_PATH || '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const db = require('../utils/db');

(async () => {
  const requiredTables = [
    'schools', 'settings', 'students', 'staff', 'classes', 'subjects',
    'attendance', 'results', 'student_enrollments'
  ];

  for (const table of requiredTables) {
    const found = await db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table]
    );
    assert.ok(found, 'Expected test schema table: ' + table);
  }

  const school = await db.get('SELECT id, name, slug, status FROM schools ORDER BY id ASC LIMIT 1');
  assert.ok(school, 'Migration should seed one synthetic default school');
  assert.strictEqual(school.slug, 'al-jaleel');
  assert.strictEqual(school.status, 'active');

  const students = await db.get('SELECT COUNT(*) AS count FROM students');
  const staff = await db.get('SELECT COUNT(*) AS count FROM staff');
  assert.strictEqual(Number(students.count), 0, 'Fixture must not contain student records');
  assert.strictEqual(Number(staff.count), 0, 'Fixture must not contain staff records');

  console.log('[test-db] Schema smoke test passed; no student or staff records exist.');
})().catch(err => {
  console.error('[test-db] Schema smoke test failed:', err.message);
  process.exitCode = 1;
});
