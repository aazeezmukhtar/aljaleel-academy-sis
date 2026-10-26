'use strict';

// Tests the student-update controller with a mocked database layer only.
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const studentController = require('../controllers/studentController');

(async () => {
  const originalAll = db.all;
  const originalGet = db.get;
  const originalRun = db.run;
  const originalTransaction = db.transaction;
  const writes = [];
  let statusCode = 200;
  let responseBody = null;

  try {
    db.all = async (sql) => {
      if (sql.includes('FROM sections WHERE school_id = ?')) {
        return [{ id: 3, name: 'Academy', current_session: '2026/2027', current_term: '2nd Term' }];
      }
      if (sql.includes('FROM classes WHERE school_id = ?')) {
        return [{ id: 10, section_id: 3 }];
      }
      throw new Error('Unexpected database list query: ' + sql);
    };
    db.get = async (sql) => {
      if (sql.includes("SELECT value FROM settings WHERE key = 'current_session'")) return { value: '2026/2027' };
      if (sql.includes("SELECT value FROM settings WHERE key = 'current_term'")) return { value: '2nd Term' };
      throw new Error('Unexpected database lookup: ' + sql);
    };
    db.run = async (sql) => {
      writes.push(sql);
      return { changes: 1 };
    };
    db.transaction = async (callback) => callback();

    const req = {
      params: { id: '55' },
      schoolId: 1,
      session: { staff: { id: 1, role: 'Admin', school_id: 1 } },
      body: {
        first_name: 'Test', last_name: 'Student', gender: 'Female',
        dob: '2015-01-01', admission_number: 'TEST-55',
        status: 'active', section_3_class_id: '999'
      }
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; }
    };

    await studentController.updateStudent(req, res);

    assert.strictEqual(statusCode, 400, 'Invalid class ID must be rejected');
    assert.strictEqual(responseBody.success, false, 'Rejected update must report failure');
    assert.strictEqual(writes.length, 0, 'Invalid class ID must be rejected before any database writes');
    console.log('[student-enrollment-update] Invalid class assignment is rejected before writes.');
  } finally {
    db.all = originalAll;
    db.get = originalGet;
    db.run = originalRun;
    db.transaction = originalTransaction;
  }
})().catch(error => {
  console.error('[student-enrollment-update] Test failed:', error);
  process.exitCode = 1;
});
