'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.PG_TEST_URL;
if (!connectionString) {
  console.error('[attendance-postgres] PG_TEST_URL is required; refusing to fall back to any application database.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_migration_test_' + process.pid;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE schools (id INTEGER PRIMARY KEY);
      CREATE TABLE sections (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
      CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE classes (
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id),
        section_id INTEGER REFERENCES sections(id)
      );
      CREATE TABLE attendance (
        id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(id),
        class_id INTEGER REFERENCES classes(id),
        arm_id INTEGER,
        status TEXT NOT NULL,
        date DATE NOT NULL,
        session TEXT NOT NULL,
        term TEXT NOT NULL,
        reason TEXT,
        reason_type TEXT,
        custom_reason TEXT,
        CONSTRAINT attendance_student_id_date_session_term_key
          UNIQUE(student_id, date, session, term)
      );
      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (1, 1), (2, 1);
      INSERT INTO students VALUES (10, 1);
      INSERT INTO classes VALUES (100, 1, 1), (200, 1, 2);
      INSERT INTO attendance (student_id, class_id, status, date, session, term)
        VALUES (10, 100, 'Present', '2026-11-18', '2026/2027', '1st Term');
    `);

    const migrationPath = path.join(__dirname, '..', 'database', 'migrations',
      '20261118_section_aware_attendance.postgres.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    await client.query(migration);

    const backfill = await client.query('SELECT section_id FROM attendance WHERE student_id = 10');
    assert.strictEqual(backfill.rows[0].section_id, 1, 'existing row must inherit section from its class');

    await client.query(`
      INSERT INTO attendance (student_id, class_id, section_id, status, date, session, term)
      VALUES (10, 200, 2, 'Absent', '2026-11-18', '2026/2027', '1st Term')
    `);
    const separateSections = await client.query('SELECT COUNT(*)::int AS count FROM attendance WHERE student_id = 10');
    assert.strictEqual(separateSections.rows[0].count, 2,
      'same student/date/session/term must be allowed once in each section');

    let duplicateRejected = false;
    try {
      await client.query(`
        INSERT INTO attendance (student_id, class_id, section_id, status, date, session, term)
        VALUES (10, 100, 1, 'Late', '2026-11-18', '2026/2027', '1st Term')
      `);
    } catch (error) {
      duplicateRejected = error.code === '23505';
    }
    assert.strictEqual(duplicateRejected, true, 'duplicate within the same section must be rejected');

    const fk = await client.query(`
      SELECT COUNT(*)::int AS count FROM information_schema.table_constraints
      WHERE constraint_schema = $1 AND table_name = 'attendance'
        AND constraint_name = 'attendance_section_id_fkey'
    `, [schema]);
    assert.strictEqual(fk.rows[0].count, 1, 'section foreign key must exist');

    console.log('[attendance-postgres] PostgreSQL migration, class-derived backfill, section-scoped uniqueness, and FK checks passed.');
  } finally {
    try {
      await client.query(`SET search_path TO public`);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      client.release();
      await pool.end();
    }
  }
})().catch(error => {
  console.error('[attendance-postgres] Test failed:', error);
  process.exitCode = 1;
});
