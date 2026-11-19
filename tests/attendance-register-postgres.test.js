'use strict';
const assert = require('assert');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.PG_TEST_URL;
if (!connectionString) {
  console.error('[attendance-register-postgres] PG_TEST_URL is required; refusing to use DATABASE_URL.');
  process.exit(1);
}

(async () => {
  const adminPool = new Pool({ connectionString, max: 1 });
  const schema = 'attendance_register_test_' + process.pid;
  let appPool;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const client = await adminPool.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE schools(id BIGINT PRIMARY KEY);
        CREATE TABLE sections(id BIGINT PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id));
        CREATE TABLE staff(id BIGINT PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id));
        CREATE TABLE classes(id BIGINT PRIMARY KEY, school_id BIGINT NOT NULL REFERENCES schools(id), section_id BIGINT NOT NULL REFERENCES sections(id));
        CREATE TABLE students(id BIGINT PRIMARY KEY, school_id BIGINT NOT NULL, status TEXT, current_class_id BIGINT);
        CREATE TABLE student_enrollments(id BIGINT PRIMARY KEY, student_id BIGINT NOT NULL, class_id BIGINT NOT NULL, session TEXT NOT NULL);
        CREATE TABLE class_attendance_responsibilities(id BIGINT PRIMARY KEY, school_id BIGINT NOT NULL, class_id BIGINT NOT NULL, staff_id BIGINT NOT NULL, session TEXT NOT NULL, effective_from DATE NOT NULL, effective_to DATE);
        CREATE TABLE attendance(id BIGSERIAL PRIMARY KEY, student_id BIGINT NOT NULL, class_id BIGINT NOT NULL, section_id BIGINT NOT NULL, date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL, reason TEXT, reason_type TEXT, custom_reason TEXT, UNIQUE(student_id,section_id,date,session,term));
        INSERT INTO schools VALUES(1);
        INSERT INTO sections VALUES(1,1);
        INSERT INTO staff VALUES(1,1),(2,1);
        INSERT INTO classes VALUES(10,1,1);
        INSERT INTO students VALUES(101,1,'active',10),(102,1,'active',10);
        INSERT INTO student_enrollments VALUES(1,101,10,'2026/2027'),(2,102,10,'2026/2027');
        INSERT INTO class_attendance_responsibilities VALUES(1,1,10,1,'2026/2027','2026-09-01',NULL);
      `);
      const migration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261119_attendance_register_submission.postgres.sql'), 'utf8');
      await client.query(migration);
      await client.query(migration);
    } finally { client.release(); }

    process.env.DB_TYPE = 'postgres';
    process.env.DATABASE_URL = connectionString + (connectionString.includes('?') ? '&' : '?') +
      'options=' + encodeURIComponent('-c search_path=' + schema);
    const db = require('../utils/db');
    appPool = db.pool;
    const service = require('../services/attendanceRegisterService');
    const base = { schoolId:1, classId:10, sectionId:1, date:'2026-11-19', session:'2026/2027', term:'1st Term', actorId:1, actorRole:'Teacher' };

    const draft = await service.saveDraft({ ...base, attendance:{101:'Present'} });
    assert.equal(draft.status, 'open');
    await assert.rejects(service.submit({ ...base, attendance:{101:'Present'} }), /incomplete/);
    const submitted = await service.submit({ ...base, attendance:{101:'Present',102:'Leave'} });
    assert.equal(submitted.version, 1);
    await assert.rejects(service.saveDraft({ ...base, attendance:{101:'Absent'} }), /submitted and locked/);
    await assert.rejects(service.reopen({ ...base, actorRole:'Teacher', reason:'Not authorised' }), /Only an administrator/);
    await service.reopen({ ...base, actorRole:'Admin', reason:'Correction approved by administrator' });
    await service.saveDraft({ ...base, attendance:{101:'Late',102:'Leave'} });
    const second = await service.submit({ ...base, attendance:{101:'Late',102:'Leave'} });
    assert.equal(second.version, 2);
    const register = await service.getRegister(base);
    assert.deepStrictEqual(register.events.map(event=>event.action), ['submitted','reopened','submitted']);
    assert.equal(register.events[1].reason, 'Correction approved by administrator');
    assert.deepStrictEqual(JSON.parse(register.events[1].old_values).map(row => row.status), ['Present','Leave']);
    assert.deepStrictEqual(JSON.parse(register.events[2].new_values).map(row => row.status), ['Late','Leave']);
    console.log('[attendance-register-postgres] draft, complete submission, locking, admin reopen, audit and versioned resubmission passed.');
  } finally {
    if (appPool) await appPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
})().catch(error=>{ console.error('[attendance-register-postgres] failed:', error); process.exitCode=1; });
