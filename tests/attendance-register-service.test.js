'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = 'attendance-register-service-test.sqlite';
const file = path.join(__dirname, '..', process.env.DB_PATH);
try { fs.unlinkSync(file); } catch {}
const Database = require('better-sqlite3');
const raw = new Database(file);
raw.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE schools(id INTEGER PRIMARY KEY);
  CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER NOT NULL REFERENCES sections(id));
  CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, status TEXT, current_class_id INTEGER);
  CREATE TABLE student_enrollments(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL, session TEXT NOT NULL);
  CREATE TABLE class_attendance_responsibilities(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, class_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, session TEXT NOT NULL, effective_from DATE NOT NULL, effective_to DATE);
  INSERT INTO class_attendance_responsibilities VALUES(1,1,10,1,'2026/2027','2026-09-01',NULL);\n  CREATE TABLE attendance(id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL, section_id INTEGER NOT NULL, date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL, reason TEXT, reason_type TEXT, custom_reason TEXT, UNIQUE(student_id,section_id,date,session,term));
  INSERT INTO schools VALUES(1);
  INSERT INTO sections VALUES(1,1);
  INSERT INTO staff VALUES(1,1),(2,1);
  INSERT INTO classes VALUES(10,1,1);
  INSERT INTO students VALUES(101,1,'active',10),(102,1,'active',10);
  INSERT INTO student_enrollments VALUES(1,101,10,'2026/2027'),(2,102,10,'2026/2027');
`);
raw.close();
const migration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261119_attendance_register_submission.sqlite.sql'), 'utf8');
const migrationDb = new Database(file);
migrationDb.exec(migration);
migrationDb.close();

const db = require('../utils/db');
const service = require('../services/attendanceRegisterService');
const base = { schoolId:1, classId:10, sectionId:1, date:'2026-11-19', session:'2026/2027', term:'1st Term', actorId:1, actorRole:'Teacher' };
(async () => {
  try {
    const draft = await service.saveDraft({ ...base, attendance:{101:'Present'} });
    assert.equal(draft.status, 'open');
    assert.equal(draft.savedCount, 1);
    await assert.rejects(service.submit({ ...base, attendance:{101:'Present'} }), /incomplete/);
    const submitted = await service.submit({ ...base, attendance:{101:'Present',102:'Leave'} });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.version, 1);
    await assert.rejects(service.saveDraft({ ...base, attendance:{101:'Absent'} }), /submitted and locked/);
    await assert.rejects(service.reopen({ ...base, actorRole:'Teacher', reason:'Fix' }), /Only an administrator/);
    const reopened = await service.reopen({ ...base, actorRole:'Admin', reason:'Correct a wrongly marked status' });
    assert.equal(reopened.status, 'open');
    await service.saveDraft({ ...base, attendance:{101:'Late',102:'Leave'} });
    const resubmitted = await service.submit({ ...base, attendance:{101:'Late',102:'Leave'} });
    assert.equal(resubmitted.version, 2);
    const record = await service.getRegister(base);
    assert.equal(record.status, 'submitted');
    assert.deepStrictEqual(record.events.map(event=>event.action), ['submitted','reopened','submitted']);
    assert.equal(record.events[1].reason, 'Correct a wrongly marked status');
    console.log('[attendance-register-sqlite] draft, completeness, locking, admin reopen, audited reason, resubmission and history passed.');
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
})().catch(error=>{ console.error('[attendance-register-sqlite] failed:', error); process.exitCode=1; });
