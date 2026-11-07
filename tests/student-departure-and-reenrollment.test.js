'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE schools (id INTEGER PRIMARY KEY);
  CREATE TABLE sections (id INTEGER PRIMARY KEY, name TEXT, current_session TEXT, current_term TEXT, school_id INTEGER);
  CREATE TABLE staff (id INTEGER PRIMARY KEY, role TEXT);
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
    section_id INTEGER REFERENCES sections(id), name TEXT
  );
  CREATE TABLE students (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
    first_name TEXT, last_name TEXT, gender TEXT, dob TEXT, admission_number TEXT,
    current_class_id INTEGER REFERENCES classes(id),
    parent_phone TEXT, parent_address TEXT, parent_email TEXT, parent_phone_alt TEXT,
    email TEXT, phone TEXT, address TEXT, passport_photo_path TEXT, status TEXT DEFAULT 'active'
  );
  CREATE TABLE student_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    session TEXT NOT NULL,
    term TEXT,
    UNIQUE(student_id, class_id, session)
  );
  CREATE TABLE student_enrollment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    section_id INTEGER REFERENCES sections(id),
    source_class_id INTEGER REFERENCES classes(id),
    destination_class_id INTEGER REFERENCES classes(id),
    source_session TEXT,
    destination_session TEXT,
    event_type TEXT NOT NULL,
    effective_date DATE,
    reason TEXT,
    destination_school TEXT,
    recorded_by INTEGER REFERENCES staff(id),
    CHECK (source_class_id IS NOT NULL OR destination_class_id IS NOT NULL)
  );
  CREATE TABLE settings (id INTEGER PRIMARY KEY, key TEXT, school_id INTEGER, value TEXT);
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, action TEXT, module TEXT, details TEXT, ip_address TEXT, created_at TEXT
  );
`);

sqlite.exec(`
  INSERT INTO schools VALUES (1);
  INSERT INTO settings (key, school_id, value) VALUES ('current_session', 1, '2026/2027'), ('current_term', 1, '1st Term');
  INSERT INTO sections VALUES (1, 'Academy', '2026/2027', '1st Term', 1), (2, 'Tahfeez', '2026/2027', '1st Term', 1);
  INSERT INTO staff VALUES (1, 'Admin');
  INSERT INTO classes VALUES (10, 1, 1, 'JSS 1A'), (11, 1, 1, 'JSS 1B'), (20, 1, 2, 'Hifz Level 1');
`);

const fakeDb = {
  get: async (sql, params = []) => sqlite.prepare(sql).get(...params),
  all: async (sql, params = []) => sqlite.prepare(sql).all(...params),
  run: async (sql, params = []) => {
    const result = sqlite.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  },
  transaction: async callback => {
    sqlite.exec('BEGIN');
    try {
      const result = await callback(null);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
};

const dbPath = require.resolve('../utils/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const studentController = require('../controllers/studentController');

async function testSectionDepartureAndReenrollment() {
  // 1. Insert dual-enrolled active student
  sqlite.exec(`
    INSERT INTO students (id, school_id, first_name, last_name, admission_number, current_class_id, status)
    VALUES (101, 1, 'Zayd', 'Mukhtar', 'ADM/001', 10, 'active');
    INSERT INTO student_enrollments (student_id, class_id, session, term)
    VALUES (101, 10, '2026/2027', '1st Term'), (101, 20, '2026/2027', '1st Term');
  `);

  const adminSession = { staff: { id: 1, role: 'Admin' } };

  // Test single-section departure (Section 1 - Academy only)
  let resJsonData = null;
  const mockRes = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { resJsonData = data; return this; }
  };

  await studentController.recordStudentDeparture({
    session: adminSession, schoolId: 1, params: { id: 101 },
    body: {
      departure_type: 'section_exit',
      departure_scope: '1',
      effective_date: '2026-11-07',
      reason: 'Withdrawing from Academy section only'
    },
    ip: '127.0.0.1'
  }, mockRes);

  assert.strictEqual(resJsonData.success, true, 'Section departure must succeed');
  assert.ok(resJsonData.message.includes('Academy'), 'Message should reference departed section');

  // Check database state after single section departure:
  const studentAfterSecExit = sqlite.prepare('SELECT status, current_class_id FROM students WHERE id = 101').get();
  assert.strictEqual(studentAfterSecExit.status, 'active', 'Student should remain active after single section departure');
  assert.strictEqual(studentAfterSecExit.current_class_id, 20, 'current_class_id should update to the remaining class (20)');

  const enrollmentsAfterSecExit = sqlite.prepare('SELECT class_id FROM student_enrollments WHERE student_id = 101').all();
  assert.strictEqual(enrollmentsAfterSecExit.length, 1, 'Only one enrollment should remain');
  assert.strictEqual(enrollmentsAfterSecExit[0].class_id, 20, 'Tahfeez enrollment should remain');

  // Test full departure (remaining section)
  await studentController.recordStudentDeparture({
    session: adminSession, schoolId: 1, params: { id: 101 },
    body: {
      departure_type: 'external_transfer',
      departure_scope: 'all',
      effective_date: '2026-11-07',
      reason: 'Relocating to another city',
      destination_school: 'International Islamic Academy'
    },
    ip: '127.0.0.1'
  }, mockRes);

  assert.strictEqual(resJsonData.success, true, 'School departure must succeed');
  const studentAfterFullExit = sqlite.prepare('SELECT status, current_class_id FROM students WHERE id = 101').get();
  assert.strictEqual(studentAfterFullExit.status, 'withdrawn', 'Student should be withdrawn after closing all placements');
  assert.strictEqual(studentAfterFullExit.current_class_id, null, 'current_class_id should be null');

  const remainingEnrollments = sqlite.prepare('SELECT count(*) as count FROM student_enrollments WHERE student_id = 101').get();
  assert.strictEqual(remainingEnrollments.count, 0, 'No active enrollments should remain');

  // Test re-enrollment via updateStudent
  await studentController.updateStudent({
    session: adminSession, schoolId: 1, params: { id: 101 },
    body: {
      first_name: 'Zayd',
      last_name: 'Mukhtar',
      gender: 'Male',
      dob: '2012-05-15',
      admission_number: 'ADM/001',
      section_1_class_id: '11', // assigning to JSS 1B in Academy
      status: 'withdrawn' // client sends withdrawn since it was readonly
    },
    ip: '127.0.0.1'
  }, mockRes);

  assert.strictEqual(resJsonData.success, true, 'Re-enrollment via updateStudent should succeed');
  assert.ok(resJsonData.message.includes('re-enrolled'), 'Success message should confirm re-enrollment');

  const studentAfterReenroll = sqlite.prepare('SELECT status, current_class_id FROM students WHERE id = 101').get();
  assert.strictEqual(studentAfterReenroll.status, 'active', 'Student status must be reactivated to active upon re-enrollment');
  assert.strictEqual(studentAfterReenroll.current_class_id, 11, 'current_class_id must point to the assigned class');

  const enrollmentsAfterReenroll = sqlite.prepare('SELECT class_id, session FROM student_enrollments WHERE student_id = 101').all();
  assert.strictEqual(enrollmentsAfterReenroll.length, 1, 'Re-enrolled student should have new placement');
  assert.strictEqual(enrollmentsAfterReenroll[0].class_id, 11);

  const historyEvents = sqlite.prepare('SELECT event_type, reason FROM student_enrollment_history WHERE student_id = 101 ORDER BY id ASC').all();
  assert.strictEqual(historyEvents.length, 3, 'Should have 3 history events (section_exit, external_transfer, admission)');
  assert.strictEqual(historyEvents[0].event_type, 'section_exit');
  assert.strictEqual(historyEvents[1].event_type, 'external_transfer');
  assert.strictEqual(historyEvents[2].event_type, 'admission');
  assert.strictEqual(historyEvents[2].reason, 'Re-enrollment after departure');

  console.log('[test-student-departure-and-reenrollment] Section departure and re-enrollment unit tests passed successfully.');
}

testSectionDepartureAndReenrollment().catch(err => {
  console.error(err);
  process.exit(1);
});
