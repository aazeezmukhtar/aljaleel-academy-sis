'use strict';

// Controller-level tests only: all database operations are mocked. No real database is opened.
process.env.DB_TYPE = 'sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const db = require('../utils/db');
const sessionHelper = require('../utils/sessionHelper');
const controller = require('../controllers/bulkStudentController');

function makeWorkbook(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acadme-bulk-import-'));
  const filePath = path.join(dir, 'students.xlsx');
  const sheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, sheet, 'Students');
  xlsx.writeFile(workbook, filePath);
  return { dir, file: { path: filePath, originalname: 'students.xlsx' } };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    json(body) { this.body = body; return this; },
    status(code) { this.statusCode = code; return this; }
  };
}

async function withMocks(fn) {
  const original = {
    all: db.all, get: db.get, run: db.run, transaction: db.transaction,
    getAcademicContext: sessionHelper.getAcademicContext
  };
  try { await fn(); }
  finally {
    Object.assign(db, { all: original.all, get: original.get, run: original.run, transaction: original.transaction });
    sessionHelper.getAcademicContext = original.getAcademicContext;
  }
}

function setBaseMocks({ classes = [{ id: 10, section_id: 3 }], existingAdmissions = [] } = {}) {
  db.all = async (sql) => {
    if (sql.includes('SELECT id, section_id FROM classes WHERE school_id = ?')) return classes;
    if (sql.includes('SELECT admission_number FROM students WHERE admission_number IN')) return existingAdmissions;
    throw new Error('Unexpected db.all query: ' + sql);
  };
  db.get = async () => ({ id: 501 });
  sessionHelper.getAcademicContext = async () => ({ session: '2026/2027', term: '2nd Term' });
}

async function invoke(rows) {
  const fixture = makeWorkbook(rows);
  try {
    const res = makeResponse();
    await controller.processBulkImport({
      schoolId: 1, body: { default_class_id: '10' }, file: fixture.file
    }, res);
    return res;
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

async function testRejectsForeignClassBeforeWrites() {
  await withMocks(async () => {
    setBaseMocks({ classes: [{ id: 10, section_id: 3 }] });
    const writes = [];
    let transactionStarted = false;
    db.run = async (...args) => { writes.push(args); return { changes: 1 }; };
    db.transaction = async (cb) => { transactionStarted = true; return cb({}); };

    const res = await invoke([{
      'Admission Number': 'BULK101', 'First Name': 'Amina', 'Last Name': 'Bello',
      Gender: 'Female', 'Class ID': 999
    }]);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.errors.some(e => e.includes('does not belong to this academy')));
    assert.strictEqual(transactionStarted, false);
    assert.strictEqual(writes.length, 0);
  });
}

async function testRejectsDuplicateAdmissionNumbersWithinFile() {
  await withMocks(async () => {
    setBaseMocks();
    let transactionStarted = false;
    db.transaction = async (cb) => { transactionStarted = true; return cb({}); };

    const res = await invoke([
      { 'Admission Number': 'BULK202', 'First Name': 'Amina', 'Last Name': 'Bello', Gender: 'Female' },
      { 'Admission Number': 'BULK202', 'First Name': 'Musa', 'Last Name': 'Ali', Gender: 'Male' }
    ]);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.duplicates.some(d => d.message.includes('repeated')));
    assert.strictEqual(transactionStarted, false);
  });
}

async function testRequiresConfiguredAcademicContext() {
  await withMocks(async () => {
    setBaseMocks();
    sessionHelper.getAcademicContext = async () => ({ session: null, term: null });
    let transactionStarted = false;
    db.transaction = async (cb) => { transactionStarted = true; return cb({}); };

    const res = await invoke([{
      'Admission Number': 'BULK303', 'First Name': 'Amina', 'Last Name': 'Bello',
      Gender: 'Female', 'Class ID': 10
    }]);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.errors.some(e => e.includes('No active academic session and term')));
    assert.strictEqual(transactionStarted, false);
  });
}

async function testEnrollmentFailureRollsBackWholeImport() {
  await withMocks(async () => {
    setBaseMocks();
    const fakeClient = { transactionClient: true };
    const writes = [];
    let rolledBack = false;
    db.run = async (sql, params, client) => {
      writes.push({ sql, params, client });
      if (sql.includes('INSERT INTO student_enrollments')) throw new Error('Injected bulk enrollment failure');
      return { changes: 1 };
    };
    db.get = async (sql, params, client) => {
      assert.strictEqual(client, fakeClient);
      return { id: 501 };
    };
    db.transaction = async (cb) => {
      try { return await cb(fakeClient); }
      catch (err) { rolledBack = true; throw err; }
    };

    const res = await invoke([{
      'Admission Number': 'BULK404', 'First Name': 'Amina', 'Last Name': 'Bello',
      Gender: 'Female', 'Class ID': 10
    }]);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(rolledBack, true);
    assert.ok(writes.some(w => w.sql.includes('INSERT INTO students')));
    assert.ok(writes.some(w => w.sql.includes('INSERT INTO student_enrollments')));
    assert.ok(writes.every(w => w.client === fakeClient));
  });
}

async function testValidImportStoresSessionAndTerm() {
  await withMocks(async () => {
    setBaseMocks();
    const fakeClient = { transactionClient: true };
    const writes = [];
    db.run = async (sql, params, client) => {
      writes.push({ sql, params, client });
      return { changes: 1 };
    };
    db.get = async (sql, params, client) => {
      assert.strictEqual(client, fakeClient);
      return { id: 501 };
    };
    db.transaction = async (cb) => cb(fakeClient);

    const res = await invoke([{
      'Admission Number': 'BULK505', 'First Name': 'Amina', 'Last Name': 'Bello',
      Gender: 'f', 'Class ID': 10
    }]);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.count, 1);
    const enrollment = writes.find(w => w.sql.includes('INSERT INTO student_enrollments'));
    assert.ok(enrollment);
    assert.deepStrictEqual(enrollment.params, [501, 10, '2026/2027', '2nd Term']);
  });
}

(async () => {
  await testRejectsForeignClassBeforeWrites();
  await testRejectsDuplicateAdmissionNumbersWithinFile();
  await testRequiresConfiguredAcademicContext();
  await testEnrollmentFailureRollsBackWholeImport();
  await testValidImportStoresSessionAndTerm();
  console.log('[bulk-student-import] Validation, academic context, atomic rollback, and success tests passed.');
})().catch(err => {
  console.error('[bulk-student-import] Test failed:', err);
  process.exitCode = 1;
});
