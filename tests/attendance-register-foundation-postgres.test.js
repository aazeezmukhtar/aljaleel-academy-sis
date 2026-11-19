'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const url = process.env.PG_TEST_URL;
if (!url) { console.error('[attendance-register-postgres] PG_TEST_URL required; refusing application DB fallback.'); process.exit(1); }
(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_register_test_' + process.pid;
  try {
    await client.query('CREATE SCHEMA ' + '"' + schema + '"');
    await client.query('SET search_path TO ' + '"' + schema + '"');
    await client.query("CREATE TABLE schools(id BIGINT PRIMARY KEY); CREATE TABLE sections(id BIGINT PRIMARY KEY,school_id BIGINT REFERENCES schools(id)); CREATE TABLE staff(id BIGINT PRIMARY KEY); CREATE TABLE students(id BIGINT PRIMARY KEY,school_id BIGINT REFERENCES schools(id)); CREATE TABLE classes(id BIGINT PRIMARY KEY,school_id BIGINT REFERENCES schools(id),section_id BIGINT REFERENCES sections(id)); CREATE TABLE student_enrollment_history(id BIGINT PRIMARY KEY); CREATE TABLE student_enrollment_periods(id BIGINT PRIMARY KEY,school_id BIGINT REFERENCES schools(id),student_id BIGINT REFERENCES students(id),section_id BIGINT REFERENCES sections(id),class_id BIGINT REFERENCES classes(id),session TEXT,start_date DATE,end_date DATE,start_event_id BIGINT REFERENCES student_enrollment_history(id),end_event_id BIGINT REFERENCES student_enrollment_history(id),date_status TEXT); CREATE TABLE attendance(id BIGINT PRIMARY KEY,status TEXT); INSERT INTO schools VALUES(1); INSERT INTO sections VALUES(10,1); INSERT INTO staff VALUES(20); INSERT INTO students VALUES(30,1); INSERT INTO classes VALUES(40,1,10); INSERT INTO student_enrollment_periods VALUES(50,1,30,10,40,'2026/2027','2026-09-01',NULL,NULL,NULL,'confirmed'); INSERT INTO attendance VALUES(60,'Leave');");
    const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.postgres.sql'), 'utf8');
    await client.query(migration);
    const found = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('section_academic_periods','class_attendance_schedules','class_attendance_responsibilities','class_attendance_settings','class_attendance_closures','attendance_registers','attendance_register_students','attendance_register_events','attendance_register_reminders','attendance_foundation_audit_logs')", [schema]);
    assert.strictEqual(found.rows[0].n, 10);
    await client.query("INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date) VALUES(1,10,'2026/2027','1st Term','2026-09-01','2026-12-20')");
    await client.query("INSERT INTO class_attendance_schedules(school_id,class_id,section_id,weekday,effective_from,created_by) VALUES(1,40,10,3,'2026-09-01',20)");
    await client.query("INSERT INTO attendance_registers(school_id,class_id,section_id,academic_period_id,schedule_id,register_date,submission_deadline_at,expected_student_count) VALUES(1,40,10,1,1,'2026-11-18','2026-11-18T14:00:00Z',1)");
    await client.query('INSERT INTO attendance_register_students(register_id,student_id,enrollment_period_id) VALUES(1,30,50)');
    await assert.rejects(() => client.query("INSERT INTO attendance_registers(school_id,class_id,section_id,academic_period_id,schedule_id,register_date,submission_deadline_at) VALUES(1,40,10,1,1,'2026-11-18','2026-11-18T14:00:00Z')"), e => e.code === '23505');
    const legacy = await client.query('SELECT status FROM attendance WHERE id=60');
    assert.strictEqual(legacy.rows[0].status, 'Leave');
    console.log('[attendance-register-postgres] PostgreSQL migration, unique register key, roster FK and legacy attendance preservation passed.');
  } finally { await client.query('SET search_path TO public'); await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); client.release(); await pool.end(); }
})().catch(e => { console.error(e); process.exitCode = 1; });