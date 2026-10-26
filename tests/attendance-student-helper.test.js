'use strict';

const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const db = require('../utils/db');
const { getAttendanceStudents } = require('../utils/attendanceStudentHelper');

(async () => {
  const originalAll = db.all;
  const calls = [];

  try {
    db.all = async (sql, params) => {
      calls.push({ sql, params });
      return [
        { id: 11, first_name: 'Enrolled', last_name: 'Current', status: null },
        { id: 12, first_name: 'Legacy', last_name: 'Current Class', status: null }
      ];
    };

    const students = await getAttendanceStudents(7, '2026/2027', 1, '2026-10-26');

    assert.deepStrictEqual(students.map(student => student.id), [11, 12]);
    assert.strictEqual(calls.length, 1, 'Attendance list should be fetched in one query');
    assert.deepStrictEqual(calls[0].params, [
      '2026-10-26', 7, 1, 7, '2026/2027', 7, '2026/2027'
    ]);
    assert.match(calls[0].sql, /s\.school_id = \?/,
      'Attendance selection must stay scoped to the current school');
    assert.match(calls[0].sql, /se\.class_id = \?\s+AND se\.session = \?/,
      'Authoritative enrollment must match both class and requested session');
    assert.match(calls[0].sql, /s\.current_class_id = \?/,
      'Legacy current-class assignment must be considered');
    assert.match(calls[0].sql, /NOT EXISTS \([\s\S]*se_current\.session = \?/,
      'Legacy fallback must not override a conflicting enrollment in the requested session');
    assert.match(calls[0].sql, /s\.status = 'active'.*s\.status = 'Active'.*s\.status IS NULL/s,
      'Existing active-status eligibility rules must remain unchanged');
    assert.match(calls[0].sql, /SELECT DISTINCT/,
      'The query must avoid duplicate students');
    assert.match(calls[0].sql, /LEFT JOIN attendance/,
      'Existing attendance status must still be loaded for the selected date');

    calls.length = 0;
    await getAttendanceStudents(7, null, 1, '2026-10-26');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].params, ['2026-10-26', 7, 1, 7, 7]);
    assert.doesNotMatch(calls[0].sql, /se_current\.session/,
      'No-session fallback must not apply a session-only exclusion');

    console.log('[attendance-student-helper] School scope, session membership, legacy fallback, deduplication, and status preservation checks passed.');
  } finally {
    db.all = originalAll;
  }
})().catch(error => {
  console.error('[attendance-student-helper] Test failed:', error);
  process.exitCode = 1;
});
