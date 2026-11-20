'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('[attendance-register-postgres] PG_TEST_URL required; refusing application DB fallback.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_register_test_' + process.pid;

  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '"');

    // Mirror the production ID widths: core entities use INTEGER, while the
    // enrollment history/period foundation uses BIGINT, including its FKs
    // back to the INTEGER core tables.
    await client.query(`
      CREATE TABLE schools (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE sections (
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id)
      );
      CREATE TABLE staff (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE students (
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id)
      );
      CREATE TABLE classes (
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id),
        section_id INTEGER REFERENCES sections(id)
      );
      CREATE TABLE student_enrollment_history (
        id BIGINT PRIMARY KEY
      );
      CREATE TABLE student_enrollment_periods (
        id BIGINT PRIMARY KEY,
        school_id BIGINT REFERENCES schools(id),
        student_id BIGINT REFERENCES students(id),
        section_id BIGINT REFERENCES sections(id),
        class_id BIGINT REFERENCES classes(id),
        session TEXT,
        start_date DATE,
        end_date DATE,
        start_event_id BIGINT REFERENCES student_enrollment_history(id),
        end_event_id BIGINT REFERENCES student_enrollment_history(id),
        date_status TEXT
      );
      CREATE TABLE attendance (
        id INTEGER PRIMARY KEY,
        status TEXT
      );

      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (10, 1);
      INSERT INTO staff VALUES (20);
      INSERT INTO students VALUES (30, 1);
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (50, 1, 30, 10, 40, '2026/2027', '2026-09-01',
                NULL, NULL, NULL, 'confirmed');
      INSERT INTO attendance VALUES (60, 'Leave');
    `);

    const productionTypeShape = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND (
          (table_name IN ('schools', 'sections', 'staff', 'students', 'classes', 'attendance')
            AND column_name = 'id')
          OR (table_name IN ('student_enrollment_history', 'student_enrollment_periods')
            AND column_name = 'id')
          OR (table_name = 'student_enrollment_periods'
            AND column_name IN ('school_id', 'student_id', 'section_id', 'class_id'))
        )
      ORDER BY table_name, column_name
    `, [schema]);

    const actualTypes = Object.fromEntries(
      productionTypeShape.rows.map(row => [row.table_name + '.' + row.column_name, row.data_type])
    );
    assert.deepStrictEqual(actualTypes, {
      'attendance.id': 'integer',
      'classes.id': 'integer',
      'schools.id': 'integer',
      'sections.id': 'integer',
      'staff.id': 'integer',
      'student_enrollment_history.id': 'bigint',
      'student_enrollment_periods.class_id': 'bigint',
      'student_enrollment_periods.id': 'bigint',
      'student_enrollment_periods.school_id': 'bigint',
      'student_enrollment_periods.section_id': 'bigint',
      'student_enrollment_periods.student_id': 'bigint',
      'students.id': 'integer'
    }, 'Test fixture must retain the production ID-width shape');

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.postgres.sql'),
      'utf8'
    );
    await client.query(migration);

    const schedulerHistoryMigration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261120_attendance_scheduler_runs.postgres.sql'),
      'utf8'
    );
    await client.query(schedulerHistoryMigration);
    const schedulerHistory = await client.query(`
      INSERT INTO attendance_scheduler_runs (status, started_at)
      VALUES ('running', '2026-11-20T10:00:00Z')
      RETURNING id, status, completed_at
    `);
    assert.strictEqual(schedulerHistory.rows[0].status, 'running');
    assert.strictEqual(schedulerHistory.rows[0].completed_at, null);
    await client.query(`
      UPDATE attendance_scheduler_runs
      SET status = 'succeeded', completed_at = '2026-11-20T10:00:01Z',
          summary = '{"scheduledCount":2}'::jsonb
      WHERE id = $1
    `, [schedulerHistory.rows[0].id]);
    const completedRun = await client.query(
      'SELECT status, summary->>\'scheduledCount\' AS scheduled_count FROM attendance_scheduler_runs WHERE id = $1',
      [schedulerHistory.rows[0].id]
    );
    assert.deepStrictEqual(completedRun.rows[0], { status: 'succeeded', scheduled_count: '2' });
    await assert.rejects(
      () => client.query(`
        INSERT INTO attendance_scheduler_runs (status, started_at)
        VALUES ('failed', '2026-11-20T10:00:00Z')
      `),
      error => error.code === '23514'
    );

    const found = await client.query(`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name IN (
          'section_academic_periods',
          'class_attendance_schedules',
          'class_attendance_responsibilities',
          'class_attendance_settings',
          'class_attendance_closures',
          'attendance_registers',
          'attendance_register_students',
          'attendance_register_events',
          'attendance_register_reminders',
          'attendance_foundation_audit_logs'
        )
    `, [schema]);
    assert.strictEqual(found.rows[0].n, 10);

    await client.query(`
      INSERT INTO section_academic_periods
        (school_id, section_id, session, term, start_date, end_date)
      VALUES (1, 10, '2026/2027', '1st Term', '2026-09-01', '2026-12-20')
    `);
    await client.query(`
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, 3, '2026-09-01', 20)
    `);
    await client.query(`
      INSERT INTO attendance_registers
        (school_id, class_id, section_id, academic_period_id, schedule_id,
         register_date, submission_deadline_at, expected_student_count)
      VALUES (1, 40, 10, 1, 1, '2026-11-18', '2026-11-18T14:00:00Z', 1)
    `);
    await client.query(`
      INSERT INTO attendance_register_students
        (register_id, student_id, enrollment_period_id)
      VALUES (1, 30, 50)
    `);

    await assert.rejects(
      () => client.query(`
        INSERT INTO attendance_registers
          (school_id, class_id, section_id, academic_period_id, schedule_id,
           register_date, submission_deadline_at)
        VALUES (1, 40, 10, 1, 1, '2026-11-18', '2026-11-18T14:00:00Z')
      `),
      error => error.code === '23505'
    );

    const legacy = await client.query('SELECT status FROM attendance WHERE id = 60');
    assert.strictEqual(legacy.rows[0].status, 'Leave');

    console.log('[attendance-register-postgres] Production-shaped ID widths, migration, unique register key, roster FK and legacy attendance preservation passed.');
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
