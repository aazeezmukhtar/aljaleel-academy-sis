'use strict';

// These regression tests mock the database layer. They never query or modify
// AcadMe's real database.
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const academicController = require('../controllers/academicController');

async function attemptDeleteWithHistory(historyType) {
  const originals = { get: db.get, all: db.all, run: db.run, transaction: db.transaction };
  const writes = [];
  let statusCode = 200;
  let body = null;
  let redirected = false;

  try {
    db.get = async (sql) => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) return { id: 42 };
      if (sql.toLowerCase().includes('count(') && sql.includes('student_enrollments')) {
        return { count: historyType === 'enrollment' ? 1 : 0 };
      }
      if (sql.toLowerCase().includes('count(') && sql.includes('attendance')) {
        return { count: historyType === 'attendance' ? 1 : 0 };
      }
      throw new Error('Unexpected database read: ' + sql);
    };
    db.all = async () => [];
    db.run = async (sql) => { writes.push(sql); return { changes: 1 }; };
    db.transaction = async (callback) => callback();

    const req = { params: { id: '42' }, schoolId: 1 };
    const res = {
      status(code) { statusCode = code; return this; },
      send(value) { body = value; return this; },
      redirect() { redirected = true; return this; }
    };

    await academicController.deleteClass(req, res);
    assert.strictEqual(statusCode, 409, 'Deletion must be blocked when ' + historyType + ' history exists');
    assert.strictEqual(redirected, false, 'Blocked deletion must not redirect as successful');
    assert.ok(/historical|records|history/i.test(String(body)), 'Response should explain why deletion is blocked');
    assert.strictEqual(writes.length, 0, 'Blocked deletion must not issue database writes');
  } finally {
    Object.assign(db, originals);
  }
}

(async () => {
  await attemptDeleteWithHistory('enrollment');
  await attemptDeleteWithHistory('attendance');
  console.log('[class-deletion-history] Historical enrollment and attendance protection tests passed.');
})().catch(error => {
  console.error('[class-deletion-history] Test failed:', error);
  process.exitCode = 1;
});
