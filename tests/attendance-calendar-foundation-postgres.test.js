'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.PG_TEST_URL;
if (!connectionString) {
  console.error('[attendance-foundation-postgres] PG_TEST_URL is required; refusing to use DATABASE_URL.');
  process.exit(1);
}
(async () => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_foundation_test_' + process.pid;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE schools(id BIGSERIAL PRIMARY KEY);
      CREATE TABLE sections(id BIGSERIAL PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id));
      CREATE TABLE staff(id BIGSERIAL PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id));
      CREATE TABLE classes(id BIGSERIAL PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id), section_id BIGINT NOT NULL REFERENCES sections(id));
      CREATE TABLE term_events(id BIGSERIAL PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id), section_id BIGINT, event_date DATE NOT NULL);
      INSERT INTO schools VALUES(1);
      INSERT INTO sections VALUES(1,1),(2,1);
      INSERT INTO staff VALUES(1,1);
      INSERT INTO classes VALUES(10,1,1),(20,1,2);
      INSERT INTO term_events VALUES(100,1,NULL,'2026-12-25');
    `);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
      '20261119_attendance_calendar_foundation.postgres.sql'), 'utf8');
    await client.query(sql);
    await client.query(sql);
    await client.query(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
      VALUES(1,1,'2026/2027','1st Term','2026-09-01','2026-12-20')`);
    await assert.rejects(client.query(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
      VALUES(1,1,'2026/2027','1st Term','2026-09-01','2026-12-20')`), e=>e.code==='23505');
    await client.query(`INSERT INTO class_attendance_schedules
      (school_id,class_id,session,effective_from,monday,tuesday,created_by)
      VALUES(1,10,'2026/2027','2026-09-01',TRUE,TRUE,1)`);
    await assert.rejects(client.query(`INSERT INTO class_attendance_closures
      (school_id,scope_type,section_id,closure_date,reason,created_by)
      VALUES(1,'school',1,'2026-12-25','invalid target',1)`), e=>e.code==='23514');
    await client.query(`INSERT INTO class_attendance_closures
      (school_id,scope_type,closure_date,reason,source_event_id,created_by)
      VALUES(1,'school','2026-12-25','Christmas',100,1)`);
    await assert.rejects(client.query(`INSERT INTO class_attendance_closures
      (school_id,scope_type,closure_date,reason,created_by)
      VALUES(1,'school','2026-12-25','duplicate',1)`), e=>e.code==='23505');
    await client.query(`INSERT INTO attendance_foundation_audit_logs
      (school_id,entity_type,entity_id,action,new_values,reason,changed_by)
      VALUES(1,'attendance_schedule',1,'created','{"monday":true}'::jsonb,'Initial schedule',1)`);
    await assert.rejects(client.query('UPDATE attendance_foundation_audit_logs SET reason=$1 WHERE id=1',['tampered']));
    await assert.rejects(client.query('DELETE FROM attendance_foundation_audit_logs WHERE id=1'));

    // Audit failure must roll back the business write in the same transaction.
    await client.query('BEGIN');
    await client.query(`INSERT INTO class_attendance_closures
      (school_id,scope_type,closure_date,reason,created_by)
      VALUES(1,'school','2026-12-26','Atomicity probe',1)`);
    await assert.rejects(client.query(`INSERT INTO attendance_foundation_audit_logs
      (school_id,entity_type,entity_id,action,reason,changed_by)
      VALUES(1,'attendance_closure',999,'created','Invalid actor',999999)`), e=>e.code==='23503');
    await client.query('ROLLBACK');
    const rolledBack = await client.query(`SELECT COUNT(*)::int AS count FROM class_attendance_closures
      WHERE closure_date='2026-12-26' AND reason='Atomicity probe'`);
    assert.equal(rolledBack.rows[0].count, 0, 'Business write survived failed audit insert');

    console.log('[attendance-foundation-postgres] schema, checks, uniqueness, audit immutability, atomic rollback and rerun checks passed.');
  } finally {
    try { await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { client.release(); await pool.end(); }
  }
})().catch(error=>{ console.error('[attendance-foundation-postgres] failed:',error); process.exitCode=1; });
