'use strict';

const assert = require('assert');
const { Pool } = require('pg');
const { createAttendanceRegisterService, isoWeekday } =
  require('../services/attendanceRegisterGenerationService');
const { createAttendanceRegisterWorkflowService } =
  require('../services/attendanceRegisterWorkflowService');

const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('[attendance-register-workflow-postgres] PG_TEST_URL required; refusing application DB fallback.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_register_workflow_' + process.pid;
  const convert = sql => {
    let index = 0;
    return sql.replace(/\?/g, () => '$' + (++index));
  };
  const db = {
    DB_TYPE: 'postgres',
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
    await client.query(`
      CREATE TABLE schools(id INTEGER PRIMARY KEY);
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE students(
        id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id),
        status TEXT, first_name TEXT, last_name TEXT, admission_number TEXT, passport_photo_path TEXT
      );
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
      CREATE TABLE attendance(
        id SERIAL PRIMARY KEY,
        student_id INTEGER, class_id INTEGER, section_id INTEGER NOT NULL,
        date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL,
        reason TEXT, reason_type TEXT, custom_reason TEXT,
        UNIQUE(student_id, section_id, date, session, term)
      );
      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (10, 1);
      INSERT INTO staff VALUES (20, 1), (21, 1);
      INSERT INTO students VALUES
        (30, 1, 'active', 'Amina', 'Adamu', 'A001', NULL),
        (31, 1, 'active', 'Bello', 'Musa', 'A002', NULL);
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (100, 1, 30, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed'),
               (101, 1, 31, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed');
    `);

    const fs = require('fs');
    const path = require('path');
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
      VALUES (1, 40, 10, ${isoWeekday('2026-11-19')}, '2026-09-01', 20);
      INSERT INTO class_attendance_settings
        (school_id, class_id, section_id, effective_from, submission_deadline_time,
         subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by)
      VALUES (1, 40, 10, '2026-09-01', '14:00', '[60]'::jsonb, 80, 20);
      INSERT INTO class_attendance_responsibilities
        (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, created_by)
      VALUES (1, 40, 10, 20, 'primary', '2026-09-01', 20);
    `);

    const generator = createAttendanceRegisterService(db);
    const generated = await generator.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(generated.created, true);

    const workflow = createAttendanceRegisterWorkflowService(db);
    const firstSave = await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 30: 'Present', 31: 'Not recorded' }
    });
    assert.strictEqual(firstSave.savedStudentCount, 1);

    await assert.rejects(
      () => workflow.submitRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
      }),
      /1 student\(s\) are still unmarked/
    );

    await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 31: 'Leave' }
    });
    const submitted = await workflow.submitRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
    });
    assert.strictEqual(submitted.status, 'submitted');
    assert.strictEqual(submitted.submittedStudentCount, 2);

    const stored = await client.query(
      'SELECT status, submitted_student_count FROM attendance_registers WHERE id = $1',
      [generated.registerId]
    );
    assert.strictEqual(stored.rows[0].status, 'submitted');
    assert.strictEqual(Number(stored.rows[0].submitted_student_count), 2);

    await assert.rejects(
      () => workflow.saveRegisterProgress({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 21,
        attendance: { 30: 'Absent' }
      }),
      /responsible class teacher/
    );

    console.log('[attendance-register-workflow-postgres] PostgreSQL progress save, unmarked guard, transactional submission, submitted count and responsible-teacher authorization passed.');
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
