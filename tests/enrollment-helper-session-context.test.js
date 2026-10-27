'use strict';

// Session-specific enrollment helper contract test. All DB calls are mocked;
// this test cannot connect to SQLite or production Supabase.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');

(async () => {
  const originalAll = db.all;
  const calls = [];
  try {
    db.all = async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('JOIN student_enrollments se')) {
        return [{
          id: 101,
          first_name: 'Enrolled',
          last_name: 'Student',
          admission_number: 'CTX101',
          status: 'active'
        }];
      }
      throw new Error('A session-specific lookup must not use the legacy current_class_id fallback.');
    };

    const students = await getEnrolledStudents(25, '2025/2026');

    assert.deepStrictEqual(students.map(student => student.id), [101],
      'Only students returned by the exact class/session enrollment query should be listed');
    assert.strictEqual(calls.length, 1,
      'A session-specific lookup must not run a second legacy current_class_id query');
    assert.match(calls[0].sql, /JOIN student_enrollments se/i);
    assert.match(calls[0].sql, /se\.class_id = \?/i);
    assert.match(calls[0].sql, /se\.session = \?/i);
    assert.deepStrictEqual(calls[0].params, [25, '2025/2026'],
      'The selected class and session must both constrain enrollment lookup');

    console.log('[enrollment-helper-session-context] Session-specific class lists use enrollment history only.');
  } finally {
    db.all = originalAll;
  }
})().catch(error => {
  console.error('[enrollment-helper-session-context] Test failed:', error);
  process.exitCode = 1;
});
