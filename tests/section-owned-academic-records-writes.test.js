'use strict';

// Mocked database only. These tests must not open production or local school databases.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const controller = require('../controllers/resultController');

function responseRecorder() {
  return {
    statusCode: 200, body: null,
    json(body) { this.body = body; return body; },
    status(code) { this.statusCode = code; return { json: body => { this.body = body; return body; } }; }
  };
}

async function withMockedDb(fn) {
  const original = { get: db.get, run: db.run, transaction: db.transaction };
  try { await fn(); } finally { Object.assign(db, original); }
}

async function testResultWriteOwnsSelectedClass() {
  await withMockedDb(async () => {
    const writes = [];
    db.get = async (sql, params = []) => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) return { id: Number(params[0]) };
      if (sql.includes('SELECT id FROM subjects WHERE id = ? AND school_id = ?')) return { id: Number(params[0]) };
      if (sql.includes('SELECT id FROM subject_assignments WHERE class_id = ? AND subject_id = ? AND session = ?')) return { id: 1 };
      if (sql.includes('FROM student_enrollments se') && sql.includes('s.school_id = ?')) return { student_id: Number(params[0]) };
      if (sql.includes('SELECT id FROM students WHERE id = ? AND school_id = ?')) return { id: Number(params[0]) };
      throw new Error('Unexpected lookup: ' + sql);
    };
    db.run = async (...args) => { writes.push(args); return { changes: 1 }; };
    db.transaction = async callback => callback();

    const res = responseRecorder();
    await controller.saveResults({
      schoolId: 1,
      session: { staff: { id: 7, role: 'Admin' } },
      body: {
        class_id: '20', subject_id: '10', term: 'First Term', session: '2026/2027',
        status: 'draft', results: [{ student_id: 101, ca1: 10, ca2: 15, exam: 50 }]
      }
    }, res);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(writes.length, 1);
    assert.match(writes[0][0], /INSERT INTO results \(student_id, class_id, subject_id/);
    assert.match(writes[0][0], /ON CONFLICT\(student_id, class_id, subject_id, term, session\)/);
    assert.strictEqual(writes[0][1][1], '20', 'selected class_id must be written to the result');
  });
}

async function testTraitsAreSectionOwnedAndRequireEnrollment() {
  await withMockedDb(async () => {
    const writes = [];
    db.get = async (sql, params = []) => {
      if (sql.includes('SELECT id FROM classes WHERE id = ? AND school_id = ?')) return { id: Number(params[0]) };
      if (sql.includes('SELECT id FROM students WHERE id = ? AND school_id = ?')) return { id: Number(params[0]) };
      if (sql.includes('FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?')) {
        return { student_id: Number(params[0]) };
      }
      throw new Error('Unexpected lookup: ' + sql);
    };
    db.run = async (...args) => { writes.push(args); return { changes: 1 }; };
    db.transaction = async callback => callback();

    const res = responseRecorder();
    await controller.saveTraits({
      schoolId: 1,
      session: { staff: { id: 7, role: 'Admin' } },
      body: {
        class_id: '30', term: 'First Term', session: '2026/2027',
        traits: { '101': { Responsibility: '5' } }
      }
    }, res);

    assert.strictEqual(res.body.success, true);
    assert.strictEqual(writes.length, 1);
    assert.match(writes[0][0], /INSERT INTO affective_psychomotor \(student_id, class_id, trait_name/);
    assert.match(writes[0][0], /ON CONFLICT\(student_id, class_id, trait_name, term, session\)/);
    assert.strictEqual(writes[0][1][1], '30', 'selected class_id must be written to the trait assessment');
  });
}

(async () => {
  await testResultWriteOwnsSelectedClass();
  await testTraitsAreSectionOwnedAndRequireEnrollment();
  console.log('PASS: class-owned result and section-specific trait write tests');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
