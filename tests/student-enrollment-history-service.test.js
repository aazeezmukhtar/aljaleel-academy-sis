'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE schools (id INTEGER PRIMARY KEY);
  CREATE TABLE sections (id INTEGER PRIMARY KEY);
  CREATE TABLE staff (id INTEGER PRIMARY KEY);
  CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id),
    section_id INTEGER REFERENCES sections(id)
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
`);

sqlite.exec(`
  INSERT INTO schools VALUES (1);
  INSERT INTO sections VALUES (10), (20);
  INSERT INTO staff VALUES (7);
  INSERT INTO students VALUES (100, 1);
  INSERT INTO classes VALUES (1000, 1, 10), (1001, 1, 10), (2000, 1, 20);
  INSERT INTO student_enrollments (student_id, class_id, session)
    VALUES (100, 1000, '2026/2027'), (100, 2000, '2026/2027');
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
const { changeEnrollment } = require('../services/studentEnrollmentHistoryService');

const base = {
  schoolId: 1, studentId: 100, sectionId: 10,
  sourceClassId: 1000, destinationClassId: 1001,
  sourceSession: '2026/2027', destinationSession: '2026/2027',
  eventType: 'internal_transfer', effectiveDate: '2026-11-05',
  reason: 'Class change approved', recordedBy: 7
};

(async () => {
  try {
    const moved = await changeEnrollment(base);
    assert.strictEqual(moved.changed, true);
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND class_id = 1000 AND session = ?'
    ).get('2026/2027').count, 0, 'Same-session source placement should be replaced');
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND class_id = 1001 AND session = ?'
    ).get('2026/2027').count, 1, 'Destination placement should be created');
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND class_id = 2000 AND session = ?'
    ).get('2026/2027').count, 1, 'Other section placement must remain untouched');

    const promotion = await changeEnrollment({
      ...base,
      sourceClassId: 1001, destinationClassId: 1001,
      sourceSession: '2026/2027', destinationSession: '2027/2028',
      eventType: 'promotion', effectiveDate: null, reason: null
    });
    assert.strictEqual(promotion.changed, true);
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND class_id = 1001 AND session = ?'
    ).get('2026/2027').count, 1, 'Cross-session promotion must preserve source placement');
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND class_id = 1001 AND session = ?'
    ).get('2027/2028').count, 1, 'Cross-session promotion must add destination placement');

    await assert.rejects(() => changeEnrollment({
      ...base, destinationClassId: 2000, eventType: 'internal_transfer'
    }), /between sections/, 'Cross-section movement must be rejected');

    await assert.rejects(() => changeEnrollment({
      ...base, effectiveDate: '2026-02-30'
    }), /valid calendar date/, 'Invalid effective dates must be rejected');

    const events = sqlite.prepare(
      'SELECT event_type, source_class_id, destination_class_id, source_session, destination_session FROM student_enrollment_history ORDER BY id'
    ).all();
    assert.deepStrictEqual(events.map(event => event.event_type), ['internal_transfer', 'promotion']);
    assert.strictEqual(events[0].source_class_id, 1000);
    assert.strictEqual(events[0].destination_class_id, 1001);
    assert.strictEqual(events[0].source_session, '2026/2027');
    const transferDetails = sqlite.prepare("SELECT effective_date, reason, section_id FROM student_enrollment_history WHERE event_type = 'internal_transfer'").get();
    assert.strictEqual(transferDetails.effective_date, '2026-11-05');
    assert.strictEqual(transferDetails.reason, 'Class change approved');
    assert.strictEqual(transferDetails.section_id, 10);
    assert.strictEqual(events[1].source_session, '2026/2027');
    assert.strictEqual(events[1].destination_session, '2027/2028');


    await changeEnrollment({
      ...base, sectionId: 10, sourceClassId: 1001, destinationClassId: null,
      sourceSession: '2026/2027', destinationSession: null,
      eventType: 'external_transfer', effectiveDate: '2026-11-05',
      reason: 'Family relocation', destinationSchool: 'New Horizon School'
    });
    await changeEnrollment({
      ...base, sectionId: 20, sourceClassId: 2000, destinationClassId: null,
      sourceSession: '2026/2027', destinationSession: null,
      eventType: 'section_exit', effectiveDate: '2026-11-05',
      reason: 'School withdrawal', destinationSchool: null
    });
    assert.strictEqual(sqlite.prepare(
      'SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id = 100 AND session = ?'
    ).get('2026/2027').count, 0, 'School departure must close all selected current section placements');
    const departureEvents = sqlite.prepare(
      "SELECT event_type, section_id, destination_school FROM student_enrollment_history WHERE event_type IN ('external_transfer','section_exit') ORDER BY id"
    ).all();
    assert.deepStrictEqual(departureEvents, [
      { event_type: 'external_transfer', section_id: 10, destination_school: 'New Horizon School' },
      { event_type: 'section_exit', section_id: 20, destination_school: null }
    ], 'Departure events must retain each section and destination school details');

    console.log('[test-enrollment-history-service] Same-session transfer, cross-session preservation, section isolation and validation checks passed.');
  } finally {
    sqlite.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
