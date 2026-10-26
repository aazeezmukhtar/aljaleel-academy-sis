'use strict';

// Regression tests for class deletion. These tests mock the database layer:
// they never query or modify AcadMe's real database.
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const academicController = require('../controllers/academicController');

async function attemptDeleteWithHistory(historyType) {
  const originals = {
    get: db.get,
    all: db.all,
    run: db.run,
    transaction: db.transaction
  };
  const executedWrites = [];
  let responseStatus = 200;
  let responseBody = null;
  let redirected = false;

  try {
    db.get = async (sql) => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) {
        return { id: 42 };
      }
      if (sql.toLowerCase().includes('count(') && sql.includes('student_enrollments')) {
        return { count: historyType === 'enrollment' ? 1 : 0 };
      }
      if (sql.toLowerCase().includes('count(') && sql.includes('attendance')) {
        return { count: historyType === 'attendance' ? 1 : 0 };
      }
      throw new Error('Unexpected database read in class-deletion test: ' + sql);
    };
    db.all = async () => [];
    db.run = async (sql) => {
      executedWrites.push(sql);
      return { changes: 1 };
    };
    db.transaction = async (callback) => callback();

    const req = { params: { id: '42' }, schoolId: 1 };
    const res = {
      status(code) {
        responseStatus = code;
        return this;
      },
      send(body) {
        responseBody = body;
        return this;
      },
      redirect() {
        redirected = true;
        return this;
      }
    };

    await academicController.deleteClass(req, res);

    assert.strictEqual(responseStatus, 409,
      'Class deletion must be blocked when historical ' + historyType + ' records exist');
    assert.strictEqual(redirected, false, 'Blocked deletion must not redirect as if successful');
    assert.ok(/historical|records|history/i.test(String(responseBody)),
      'Blocked deletion should explain that records must be preserved');
    assert.strictEqual(executedWrites.length, 0,
      'Blocked deletion must not issue database writes');
  } finally {
    db.get = originals.get;
    db.all = originals.all;
    db.run = originals.run;
    db.transaction = originals.transaction;
  }
}

(async () => {
  await attemptDeleteWithHistory('enrollment');
  await attemptDeleteWithHistory('attendance');
  console.log('[class-deletion-history] Historical enrollment and attendance protection tests passed.');
})().catch((error) => {
  console.error('[class-deletion-history] Test failed:', error);
  process.exitCode = 1;
});
