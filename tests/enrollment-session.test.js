'use strict';

const assert = require('assert');
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = process.env.DB_PATH || '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const db = require('../utils/db');
const { getEnrolledStudents } = require('../utils/enrollmentHelper');

(async () => {
  const originalAll = db.all;
  const calls = [];
  const currentSessionStudent = {
    id: 101, first_name: 'Current', last_name: 'Session',
    admission_number: 'TEST-CURRENT', status: 'active'
  };
  const previousSessionStudent = {
    id: 102, first_name: 'Previous', last_name: 'Session',
    admission_number: 'TEST-PREVIOUS', status: 'active'
  };
  const legacyStudent = {
    id: 103, first_name: 'Legacy', last_name: 'Record',
    admission_number: 'TEST-LEGACY', status: 'active'
  };

  try {
    // A session-specific query must not fall back to current_class_id. That
    // fallback can incorrectly include students whose only enrollment is old.
    db.all = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('JOIN student_enrollments')) {
        assert.deepStrictEqual(params, [7, '2026/2027']);
        return [currentSessionStudent];
      }
      if (sql.includes('WHERE current_class_id = ?')) {
        return [previousSessionStudent, legacyStudent];
      }
      throw new Error('Unexpected enrollment query: ' + sql);
    };

    const current = await getEnrolledStudents(7, '2026/2027');
    assert.deepStrictEqual(current.map(s => s.id), [101],
      'Only students with an enrollment in the requested session should be returned');
    assert.strictEqual(calls.length, 1,
      'Session-specific lookups must not run the legacy current_class_id fallback');

    // Legacy callers without a session retain the fallback and deduplication.
    calls.length = 0;
    db.all = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('JOIN student_enrollments')) {
        assert.deepStrictEqual(params, [7]);
        return [currentSessionStudent];
      }
      if (sql.includes('WHERE current_class_id = ?')) {
        assert.deepStrictEqual(params, [7]);
        return [currentSessionStudent, legacyStudent];
      }
      throw new Error('Unexpected enrollment query: ' + sql);
    };

    const legacy = await getEnrolledStudents(7);
    assert.deepStrictEqual(legacy.map(s => s.id), [101, 103],
      'Non-session lookups should retain fallback behavior and deduplicate students');
    assert.strictEqual(calls.length, 2,
      'Non-session lookups should retain the legacy fallback');

    console.log('[enrollment-session] Session filtering and legacy fallback tests passed.');
  } finally {
    db.all = originalAll;
  }
})().catch(err => {
  console.error('[enrollment-session] Test failed:', err);
  process.exitCode = 1;
});
