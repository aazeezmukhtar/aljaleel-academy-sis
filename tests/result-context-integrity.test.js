'use strict';

// This regression test mocks every database operation; it must never touch a real database.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const resultController = require('../controllers/resultController');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    json(body) { this.body = body; return body; },
    status(code) {
      this.statusCode = code;
      return { json: body => { this.body = body; return body; } };
    }
  };
}

async function withMockedDb(runTest) {
  const originals = { all: db.all, get: db.get, run: db.run, transaction: db.transaction };
  try {
    await runTest();
  } finally {
    Object.assign(db, originals);
  }
}

async function testRejectsBatchIfAnyStudentIsNotEnrolled() {
  await withMockedDb(async () => {
    const writes = [];
    const enrollmentLookups = [];
    db.get = async (sql, params = []) => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) return { id: 10 };
      if (sql.includes('SELECT id FROM subjects WHERE id = ? AND school_id = ?')) return { id: 20 };
      if (sql.includes('SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ? LIMIT 1')) return { id: 1 };
      if (sql.includes('FROM student_enrollments se') && sql.includes('s.school_id = ?')) {
        enrollmentLookups.push(params[0]);
        return Number(params[0]) === 101 ? { student_id: 101 } : null;
      }
      throw new Error('Unexpected database lookup: ' + sql);
    };
    db.run = async (...args) => { writes.push(args); return { changes: 1 }; };
    db.transaction = async callback => callback();

    const res = responseRecorder();
    await resultController.saveResults({
      schoolId: 1,
      session: { staff: { id: 7, role: 'Admin' } },
      body: {
        class_id: '10',
        subject_id: '20',
        term: '3rd Term',
        session: '2025/2026',
        status: 'draft',
        results: [
          { student_id: 101, ca1: 10, ca2: 10, exam: 50 },
          { student_id: 202, ca1: 15, ca2: 15, exam: 55 }
        ]
      }
    }, res);

    assert.strictEqual(res.statusCode, 400, 'A batch containing an out-of-class student must be rejected');
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /not enrolled/i);
    assert.deepStrictEqual(enrollmentLookups, [101, 202], 'Every submitted student must be checked');
    assert.strictEqual(writes.length, 0, 'No student result may be written when any submitted student fails validation');
  });
}

async function testRejectsSubjectNotAssignedToClass() {
  await withMockedDb(async () => {
    const writes = [];
    db.get = async sql => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) return { id: 10 };
      if (sql.includes('SELECT id FROM subjects WHERE id = ? AND school_id = ?')) return { id: 20 };
      if (sql.includes('SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ? LIMIT 1')) return null;
      throw new Error('Validation should stop before this lookup: ' + sql);
    };
    db.run = async (...args) => { writes.push(args); return { changes: 1 }; };
    db.transaction = async callback => callback();

    const res = responseRecorder();
    await resultController.saveResults({
      schoolId: 1,
      session: { staff: { id: 7, role: 'Admin' } },
      body: {
        class_id: '10',
        subject_id: '20',
        term: '3rd Term',
        session: '2025/2026',
        status: 'draft',
        results: [{ student_id: 101, ca1: 10, ca2: 10, exam: 50 }]
      }
    }, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.message, /not assigned/i);
    assert.strictEqual(writes.length, 0);
  });
}

(async () => {
  await testRejectsBatchIfAnyStudentIsNotEnrolled();
  await testRejectsSubjectNotAssignedToClass();
  process.stdout.write('PASS: Result context integrity regression tests\\n');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
