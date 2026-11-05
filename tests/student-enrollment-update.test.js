'use strict';

process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const servicePath = require.resolve('../services/studentEnrollmentHistoryService');
const historyCalls = [];
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: {
    changeEnrollment: async (input, options) => {
      historyCalls.push({ input, options });
      return { changed: true };
    }
  }
};
const studentController = require('../controllers/studentController');

(async () => {
  const originalAll = db.all;
  const originalGet = db.get;
  const originalRun = db.run;
  const originalTransaction = db.transaction;
  const writes = [];
  let currentClassId = 9;
  let statusCode = 200;
  let responseBody = null;

  const req = classId => ({
    params: { id: '55' },
    schoolId: 1,
    session: { staff: { id: 1, role: 'Admin', school_id: 1 } },
    body: {
      first_name: 'Test', last_name: 'Student', gender: 'Female',
      dob: '2015-01-01', admission_number: 'TEST-55',
      status: 'active', section_3_class_id: String(classId)
    }
  });
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; }
  };

  try {
    db.all = async sql => {
      if (sql.includes('FROM sections WHERE school_id = ?')) {
        return [{ id: 3, name: 'Academy', current_session: '2026/2027', current_term: '2nd Term' }];
      }
      if (sql.includes('FROM classes WHERE school_id = ?')) {
        return [{ id: 9, section_id: 3 }, { id: 10, section_id: 3 }];
      }
      if (sql.includes('student_enrollments se JOIN classes c')) {
        return [{ id: 77, class_id: currentClassId }];
      }
      throw new Error('Unexpected database list query: ' + sql);
    };
    db.get = async sql => {
      if (sql.includes("SELECT value FROM settings WHERE key = 'current_session'")) return { value: '2026/2027' };
      if (sql.includes("SELECT value FROM settings WHERE key = 'current_term'")) return { value: '2nd Term' };
      throw new Error('Unexpected database lookup: ' + sql);
    };
    db.run = async sql => { writes.push(sql); return { changes: 1 }; };
    db.transaction = async callback => callback(null);

    await studentController.updateStudent(req(999), res);
    assert.strictEqual(statusCode, 400, 'Invalid class ID must be rejected');
    assert.strictEqual(writes.length, 0, 'Invalid class ID must be rejected before writes');
    assert.strictEqual(historyCalls.length, 0, 'Invalid class ID must not create history events');
    console.log('[student-enrollment-update] Invalid class assignment is rejected before writes.');

    writes.length = 0;
    historyCalls.length = 0;
    statusCode = 200;
    responseBody = null;
    const fakeClient = { transactionClient: true };
    let transactionStarted = false;
    let transactionCommitted = false;
    let transactionRolledBack = false;

    db.get = async (sql, params) => {
      if (sql.includes("key = 'current_session' AND school_id = ?")) return { value: '2026/2027' };
      if (sql.includes('SELECT current_session, current_term FROM sections')) {
        return { current_session: '2026/2027', current_term: '2nd Term' };
      }
      if (sql.includes('SELECT id, status FROM students WHERE id = ? AND school_id = ?')) return { id: 55, status: 'active' };
      throw new Error('Unexpected database lookup: ' + sql);
    };
    db.run = async (sql, params, client) => {
      writes.push({ sql, client });
      if (sql.includes('UPDATE students SET')) throw new Error('Injected profile update failure');
      return { changes: 1 };
    };
    db.transaction = async callback => {
      transactionStarted = true;
      try {
        const result = await callback(fakeClient);
        transactionCommitted = true;
        return result;
      } catch (error) {
        transactionRolledBack = true;
        throw error;
      }
    };

    await studentController.updateStudent(req(10), res);
    assert.strictEqual(transactionStarted, true, 'Profile and history updates must share a transaction');
    assert.strictEqual(transactionCommitted, false, 'Injected failure must prevent commit');
    assert.strictEqual(transactionRolledBack, true, 'Injected failure must roll back the transaction');
    assert.strictEqual(historyCalls.length, 1, 'Changing an existing class must create one history event');
    assert.strictEqual(historyCalls[0].input.eventType, 'correction');
    assert.strictEqual(historyCalls[0].input.sourceClassId, 9);
    assert.strictEqual(historyCalls[0].input.destinationClassId, 10);
    assert.strictEqual(historyCalls[0].input.recordedBy, 1);
    assert.strictEqual(historyCalls[0].options.inTransaction, true);
    assert.strictEqual(historyCalls[0].options.client, fakeClient);
    assert.strictEqual(statusCode, 500, 'Failed update should report an error');
    console.log('[student-enrollment-update] Profile corrections append history using the same rollback-capable transaction.');

    // An unchanged placement still receives the current term, without a
    // spurious correction event.
    writes.length = 0;
    historyCalls.length = 0;
    currentClassId = 10;
    statusCode = 200;
    db.run = async (sql, params, client) => {
      writes.push({ sql, params, client });
      return { changes: 1 };
    };
    db.transaction = async callback => callback(fakeClient);
    await studentController.updateStudent(req(10), res);
    assert.strictEqual(historyCalls.length, 0, 'Unchanged placement must not create a correction event');
    assert.ok(writes.some(write => write.sql.includes('UPDATE student_enrollments SET term = ?')),
      'Unchanged placement must retain the current term');
    console.log('[student-enrollment-update] Unchanged placements preserve their term without creating history noise.');

    // Clearing an existing placement in the profile form must not silently
    // delete it; the dedicated transfer/departure workflow owns that action.
    historyCalls.length = 0;
    currentClassId = 9;
    statusCode = 200;
    responseBody = null;
    db.get = async sql => {
      if (sql.includes("key = 'current_session' AND school_id = ?")) return { value: '2026/2027' };
      if (sql.includes('SELECT current_session, current_term FROM sections')) {
        return { current_session: '2026/2027', current_term: '2nd Term' };
      }
      if (sql.includes('FROM student_enrollments se JOIN classes c')) return { id: 77, class_id: 9 };
      if (sql.includes('SELECT id, status FROM students WHERE id = ? AND school_id = ?')) return { id: 55, status: 'active' };
      throw new Error('Unexpected database lookup: ' + sql);
    };
    db.transaction = async callback => callback(null);
    await studentController.updateStudent(req(''), res);
    assert.strictEqual(historyCalls.length, 0, 'A blank class field must not silently create or delete a placement');
    assert.strictEqual(statusCode, 400, 'Clearing an existing placement must be blocked with a validation response');
    console.log('[student-enrollment-update] Existing placement cannot be silently cleared from profile editing.');
  } finally {
    db.all = originalAll;
    db.get = originalGet;
    db.run = originalRun;
    db.transaction = originalTransaction;
    delete require.cache[servicePath];
  }
})().catch(error => {
  console.error('[student-enrollment-update] Test failed:', error);
  process.exitCode = 1;
});
