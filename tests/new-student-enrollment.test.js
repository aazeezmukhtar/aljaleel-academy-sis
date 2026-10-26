'use strict';

// New-student enrollment tests use a mocked database layer only.
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const studentController = require('../controllers/studentController');

function responseRecorder() {
  return {
    redirectedTo: null,
    statusCode: 200,
    body: null,
    redirect(url) { this.redirectedTo = url; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; }
  };
}

async function withMockedDb(runTest) {
  const originals = { all: db.all, get: db.get, run: db.run, transaction: db.transaction };
  try { await runTest(); }
  finally { Object.assign(db, originals); }
}

async function testRejectsClassFromWrongSectionBeforeWrites() {
  await withMockedDb(async () => {
    const writes = [];
    db.all = async (sql) => {
      if (sql.includes('FROM sections WHERE school_id = ?')) {
        return [{ id: 3, name: 'Academy', current_session: '2026/2027', current_term: '2nd Term' }];
      }
      if (sql.includes('FROM classes WHERE school_id = ?')) {
        return [{ id: 10, section_id: 3 }, { id: 20, section_id: 4 }];
      }
      throw new Error('Unexpected list query: ' + sql);
    };
    db.get = async (sql) => {
      if (sql.includes('SELECT id FROM students WHERE admission_number = ?')) return null;
      throw new Error('Invalid assignment should be rejected before extra lookups: ' + sql);
    };
    db.run = async (sql) => { writes.push(sql); return { changes: 1, lastInsertRowid: 77 }; };
    db.transaction = async (callback) => callback({ testClient: true });

    const res = responseRecorder();
    await studentController.enrollStudent({
      schoolId: 1,
      session: { staff: { id: 9, role: 'Admin', school_id: 1 } },
      body: {
        first_name: 'Test', last_name: 'Student', gender: 'Female',
        current_class_id: '10', section_3_class_id: '20'
      },
      ip: '127.0.0.1'
    }, res);

    assert.strictEqual(res.redirectedTo, '/students/enroll?error=Enrollment failed',
      'A class from another section must be rejected');
    assert.strictEqual(writes.length, 0, 'Invalid assignment must be rejected before any writes');
  });
}

async function testEnrollmentUsesSectionSessionAndTermAndOneTransaction() {
  await withMockedDb(async () => {
    const writes = [];
    const fakeClient = { transactionClient: true };
    let transactionStarted = false;
    let transactionRolledBack = false;
    db.all = async (sql) => {
      if (sql.includes('FROM sections WHERE school_id = ?')) {
        return [{ id: 3, name: 'Academy', current_session: '2026/2027', current_term: '2nd Term' }];
      }
      if (sql.includes('FROM classes WHERE school_id = ?')) return [{ id: 10, section_id: 3 }];
      throw new Error('Unexpected list query: ' + sql);
    };
    db.get = async (sql, params, client) => {
      if (sql.includes('SELECT id FROM students WHERE admission_number = ? AND school_id = ?')) {
        assert.strictEqual(client, fakeClient, 'Student lookup should use transaction client');
        return { id: 77 };
      }
      if (sql.includes('SELECT id FROM students WHERE admission_number = ?')) return null;
      if (sql.includes('FROM sections s') && sql.includes('JOIN classes c')) {
        return { current_session: '2026/2027', current_term: '2nd Term' };
      }
      if (sql.includes("key = 'current_session' AND school_id = ?")) return { value: '2026/2027' };
      if (sql.includes("key = 'current_term' AND school_id = ?")) return { value: '2nd Term' };
      throw new Error('Unexpected lookup query: ' + sql);
    };
    db.run = async (sql, params, client) => {
      writes.push({ sql, params, client });
      if (sql.includes('INSERT INTO student_enrollments')) {
        assert.strictEqual(params[2], '2026/2027', 'Enrollment must use active section session');
        assert.strictEqual(params[3], '2nd Term', 'Enrollment must save active section term');
      }
      return { changes: 1, lastInsertRowid: 77 };
    };
    db.transaction = async (callback) => {
      transactionStarted = true;
      try { return await callback(fakeClient); }
      catch (error) { transactionRolledBack = true; throw error; }
    };

    const res = responseRecorder();
    await studentController.enrollStudent({
      schoolId: 1,
      session: { staff: { id: 9, role: 'Admin', school_id: 1 } },
      body: {
        first_name: 'Test', last_name: 'Student', gender: 'Female',
        current_class_id: '10'
      },
      ip: '127.0.0.1'
    }, res);

    assert.strictEqual(transactionStarted, true, 'Student and enrollment writes must share a transaction');
    assert.strictEqual(transactionRolledBack, false, 'Valid enrollment should commit');
    assert.ok(writes.some(w => w.sql.includes('INSERT INTO students')), 'Student row should be inserted');
    assert.ok(writes.some(w => w.sql.includes('INSERT INTO student_enrollments')), 'Enrollment row should be inserted');
    assert.ok(writes.every(w => w.client === fakeClient), 'All writes should use the same transaction client');
    assert.strictEqual(res.redirectedTo, '/students?success=true', 'Successful enrollment should retain existing redirect');
  });
}

(async () => {
  await testRejectsClassFromWrongSectionBeforeWrites();
  await testEnrollmentUsesSectionSessionAndTermAndOneTransaction();
  console.log('[new-student-enrollment] Class validation, session/term context, and transaction tests passed.');
})().catch(error => {
  console.error('[new-student-enrollment] Test failed:', error);
  process.exitCode = 1;
});
