'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createAttendanceRegisterService, isoWeekday, localDateTimeToUtc } =
  require('../services/attendanceRegisterGenerationService');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');

const db = {
  all: async (sql, params = []) => sqlite.prepare(sql).all(params),
  get: async (sql, params = []) => sqlite.prepare(sql).get(params),
  run: async (sql, params = []) => {
    const result = sqlite.prepare(sql).run(params);
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

(async () => {
  try {
    sqlite.exec(`
      CREATE TABLE schools(id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), name TEXT);
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), status TEXT);
      CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
      CREATE TABLE student_enrollment_history(id INTEGER PRIMARY KEY);
      CREATE TABLE student_enrollment_periods(
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id),
        student_id INTEGER REFERENCES students(id),
        section_id INTEGER REFERENCES sections(id),
        class_id INTEGER REFERENCES classes(id),
        session TEXT,
        start_date DATE,
        end_date DATE,
        start_event_id INTEGER REFERENCES student_enrollment_history(id),
        end_event_id INTEGER REFERENCES student_enrollment_history(id),
        date_status TEXT
      );
      INSERT INTO schools VALUES (1, 'Al-Jaleel Academy');
      INSERT INTO sections VALUES (10, 1, 'Academy');
      INSERT INTO staff VALUES (20, 1), (21, 1);
      INSERT INTO students VALUES (30, 1, 'active'), (31, 1, 'active'), (32, 1, 'active');
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (100, 1, 30, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed'),
               (101, 1, 31, 10, 40, '2026/2027', '2026-11-19', NULL, NULL, NULL, 'confirmed'),
               (102, 1, 32, 10, 40, '2026/2027', '2026-11-19', NULL, NULL, NULL, 'review_needed');
    `);

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.sqlite.sql'),
      'utf8'
    );
    sqlite.exec(migration);

    sqlite.prepare(`
      INSERT INTO section_academic_periods
        (school_id, section_id, session, term, start_date, end_date, status)
      VALUES (1, 10, '2026/2027', '1st Term', '2026-09-01', '2026-12-20', 'active')
    `).run();
    sqlite.prepare(`
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-09-01', 20)
    `).run(isoWeekday('2026-11-19'), isoWeekday('2026-11-20'), isoWeekday('2026-11-21'));
    sqlite.prepare(`
      INSERT INTO class_attendance_settings
        (school_id, class_id, section_id, effective_from, submission_deadline_time,
         subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by)
      VALUES (1, 40, 10, '2026-09-01', '14:00', '[60,120]', 80, 20)
    `).run();
    sqlite.prepare(`
      INSERT INTO class_attendance_responsibilities
        (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, created_by)
      VALUES (1, 40, 10, 20, 'primary', '2026-09-01', 20),
             (1, 40, 10, 21, 'substitute', '2026-11-19', 20)
    `).run();

    const service = createAttendanceRegisterService(db);
    const generated = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(generated.created, true);
    assert.strictEqual(generated.expectedStudentCount, 2);
    assert.strictEqual(generated.responsibleStaffId, 21, 'active substitute takes precedence over primary');
    assert.strictEqual(generated.deadlineAt, '2026-11-19T13:00:00.000Z', '14:00 Africa/Lagos must be stored as 13:00 UTC');
    assert.deepStrictEqual(
      sqlite.prepare('SELECT student_id FROM attendance_register_students WHERE register_id = ? ORDER BY student_id')
        .all(generated.registerId).map(row => row.student_id),
      [30, 31]
    );
    assert.strictEqual(
      sqlite.prepare('SELECT COUNT(*) AS count FROM attendance_register_events WHERE register_id = ?')
        .get(generated.registerId).count,
      1
    );

    const repeated = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(repeated.created, false);
    assert.strictEqual(repeated.alreadyExists, true);
    assert.strictEqual(repeated.registerId, generated.registerId);
    assert.strictEqual(
      sqlite.prepare('SELECT COUNT(*) AS count FROM attendance_registers').get().count,
      1,
      'repeated generation must not create duplicate registers'
    );

    sqlite.prepare(`
      INSERT INTO class_attendance_closures
        (school_id, scope_type, section_id, class_id, start_date, end_date, reason,
         status, requested_by, approved_by, approved_at)
      VALUES (1, 'class', 10, 40, '2026-11-20', '2026-11-20', 'School activity',
              'approved', 20, 20, '2026-11-18T10:00:00Z')
    `).run();
    const closure = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-20'
    });
    assert.strictEqual(closure.skipped, true);
    assert.strictEqual(closure.reason, 'approved_closure');

    const reviewNeeded = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-21'
    });
    assert.strictEqual(reviewNeeded.skipped, true);
    assert.strictEqual(reviewNeeded.reason, 'enrollment_dates_need_review');

    const outsidePeriod = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2027-01-04'
    });
    assert.strictEqual(outsidePeriod.skipped, true);
    assert.strictEqual(outsidePeriod.reason, 'no_academic_period');

    assert.throws(
      () => localDateTimeToUtc('2026-11-19', '25:00', 'Africa/Lagos'),
      /HH:MM/
    );
    assert.throws(
      () => normalizeDateForTest('2026-02-30'),
      /valid calendar date/
    );

    console.log('[attendance-register-generation] schedule, academic-period, closure, dated-roster, review-needed, substitute, deadline, idempotency and event checks passed.');
  } finally {
    sqlite.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

function normalizeDateForTest(value) {
  const date = String(value || '').trim();
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('format');
  const parsed = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('not a valid calendar date');
  }
  return date;
}
