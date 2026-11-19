'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createAttendanceRegisterService, isoWeekday } =
  require('../services/attendanceRegisterGenerationService');

const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('[attendance-register-generation-postgres] PG_TEST_URL required; refusing application DB fallback.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_register_generation_' + process.pid;

  const convert = sql => {
    let index = 0;
    return sql.replace(/\?/g, () => '$' + (++index));
  };
  const db = {
    all: async (sql, params = [], tx = null) => (await (tx || client).query(convert(sql), params)).rows,
    get: async (sql, params = [], tx = null) => {
      const result = await (tx || client).query(convert(sql), params);
      return result.rows[0];
    },
    run: async (sql, params = [], tx = null) => {
      const result = await (tx || client).query(convert(sql), params);
      return { changes: result.rowCount, lastInsertRowid: null };
    },
    transaction: async callback => {
      await client.query('BEGIN');
      try {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  };

  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '"');

    // Production-shaped fixture: core IDs are INTEGER; enrollment IDs and
    // enrollment-period references are BIGINT.
    await client.query(`
      CREATE TABLE schools(id INTEGER PRIMARY KEY);
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), status TEXT);
      CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
      CREATE TABLE student_enrollment_history(id BIGINT PRIMARY KEY);
      CREATE TABLE student_enrollment_periods(
        id BIGINT PRIMARY KEY,
        school_id BIGINT REFERENCES schools(id),
        student_id BIGINT REFERENCES students(id),
        section_id BIGINT REFERENCES sections(id),
        class_id BIGINT REFERENCES classes(id),
        session TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        start_event_id BIGINT REFERENCES student_enrollment_history(id),
        end_event_id BIGINT REFERENCES student_enrollment_history(id),
        date_status TEXT NOT NULL
      );
      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (10, 1);
      INSERT INTO staff VALUES (20, 1), (21, 1);
      INSERT INTO students VALUES (30, 1, 'active'), (31, 1, 'active'), (32, 1, 'active');
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (100, 1, 30, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed'),
               (101, 1, 31, 10, 40, '2026/2027', '2026-11-19', NULL, NULL, NULL, 'confirmed'),
               (102, 1, 32, 10, 40, '2026/2027', '2026-11-21', NULL, NULL, NULL, 'review_needed');
    `);

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.postgres.sql'),
      'utf8'
    );
    await client.query(migration);

    await client.query(`
      INSERT INTO section_academic_periods
        (school_id, section_id, session, term, start_date, end_date, status)
      VALUES (1, 10, '2026/2027', '1st Term', '2026-09-01', '2026-12-20', 'active');
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ${isoWeekday('2026-11-19')}, '2026-09-01', 20),
             (1, 40, 10, ${isoWeekday('2026-11-20')}, '2026-09-01', 20),
             (1, 40, 10, ${isoWeekday('2026-11-21')}, '2026-09-01', 20);
      INSERT INTO class_attendance_settings
        (school_id, class_id, section_id, effective_from, submission_deadline_time,
         subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by)
      VALUES (1, 40, 10, '2026-09-01', '14:00', '[60,120]'::jsonb, 80, 20);
      INSERT INTO class_attendance_responsibilities
        (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, created_by)
      VALUES (1, 40, 10, 20, 'primary', '2026-09-01', 20),
             (1, 40, 10, 21, 'substitute', '2026-11-19', 20);
    `);

    const service = createAttendanceRegisterService(db);
    const generated = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(generated.created, true);
    assert.strictEqual(generated.expectedStudentCount, 2);
    assert.strictEqual(String(generated.responsibleStaffId), '21');
    assert.strictEqual(generated.deadlineAt, '2026-11-19T13:00:00.000Z');

    const roster = await client.query(
      'SELECT student_id FROM attendance_register_students WHERE register_id = $1 ORDER BY student_id',
      [generated.registerId]
    );
    assert.deepStrictEqual(roster.rows.map(row => Number(row.student_id)), [30, 31]);

    const repeated = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(repeated.alreadyExists, true);
    assert.strictEqual(String(repeated.registerId), String(generated.registerId));

    await client.query(`
      INSERT INTO class_attendance_closures
        (school_id, scope_type, section_id, class_id, start_date, end_date, reason,
         status, requested_by, approved_by, approved_at)
      VALUES (1, 'class', 10, 40, '2026-11-20', '2026-11-20', 'School activity',
              'approved', 20, 20, '2026-11-18T10:00:00Z');
    `);
    const closure = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-20'
    });
    assert.strictEqual(closure.reason, 'approved_closure');

    const reviewNeeded = await service.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-21'
    });
    assert.strictEqual(reviewNeeded.reason, 'enrollment_dates_need_review');

    console.log('[attendance-register-generation-postgres] Production-shaped PostgreSQL register generation, dated roster, substitute, deadline, idempotency and closure checks passed.');
  } finally {
    await client.query('SET search_path TO public');
    await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    client.release();
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
