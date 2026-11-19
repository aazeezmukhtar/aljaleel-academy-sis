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
  CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, status TEXT, current_class_id INTEGER, first_name TEXT, last_name TEXT, admission_number TEXT, passport_photo_path TEXT);
  CREATE TABLE student_enrollments(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL, session TEXT NOT NULL);
  CREATE TABLE student_enrollment_history(id INTEGER PRIMARY KEY);
  CREATE TABLE class_attendance_responsibilities(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, class_id INTEGER NOT NULL, staff_id INTEGER NOT NULL, session TEXT NOT NULL, effective_from DATE NOT NULL, effective_to DATE);
  INSERT INTO class_attendance_responsibilities VALUES
    (1,1,10,1,'2026/2027','2026-09-01',NULL),
    (2,1,11,1,'2026/2027','2026-09-01',NULL);
  CREATE TABLE attendance(id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL, section_id INTEGER NOT NULL, date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL, reason TEXT, reason_type TEXT, custom_reason TEXT, UNIQUE(student_id,section_id,date,session,term));
  INSERT INTO schools VALUES(1);
  INSERT INTO sections VALUES(1,1);
  INSERT INTO staff VALUES(1,1),(2,1);
  INSERT INTO classes VALUES(10,1,1),(11,1,1);
  INSERT INTO students(id,school_id,status,current_class_id) VALUES(101,1,'active',11),(102,1,'active',10);
  INSERT INTO student_enrollments VALUES
    (1,101,10,'2026/2027'),(2,102,10,'2026/2027'),(3,101,11,'2026/2027');
`);
raw.close();
const enrollmentMigration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261117_student_enrollment_periods.sqlite.sql'), 'utf8');
const registerMigration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261119_attendance_register_submission.sqlite.sql'), 'utf8');
const reminderMigration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/20261119_attendance_register_reminders.sqlite.sql'), 'utf8');
const migrationDb = new Database(file);
migrationDb.exec(enrollmentMigration);
migrationDb.exec(registerMigration);
migrationDb.exec(registerMigration);
migrationDb.exec(reminderMigration);
migrationDb.exec(reminderMigration);
migrationDb.prepare(`INSERT INTO student_enrollment_periods
  (school_id,student_id,section_id,class_id,session,start_date,end_date,date_status)
  VALUES (1,101,1,10,'2026/2027','2026-09-01','2026-11-09','confirmed'),
         (1,101,1,11,'2026/2027','2026-11-10',NULL,'confirmed'),
         (1,102,1,10,'2026/2027','2026-09-01',NULL,'confirmed')`).run();
migrationDb.close();

const db = require('../utils/db');
const service = require('../services/attendanceRegisterService');
const { getAttendanceRoster } = require('../utils/attendanceStudentHelper');
const base = { schoolId:1, classId:10, sectionId:1, date:'2026-11-05', session:'2026/2027', term:'1st Term', actorId:1, actorRole:'Teacher' };
(async () => {
  try {
    const historicalRoster = await getAttendanceRoster(10, '2026/2027', 1, '2026-11-05', '1st Term');
    assert.deepStrictEqual(historicalRoster.students.map(row => Number(row.id)), [101,102],
      'Both students belong to the source class before the transfer date.');
    const sourceAfterTransfer = await getAttendanceRoster(10, '2026/2027', 1, '2026-11-19', '1st Term');
    assert.deepStrictEqual(sourceAfterTransfer.students.map(row => Number(row.id)), [102],
      'The transferred student must no longer appear in the source class after the transfer.');
    const destinationAfterTransfer = await getAttendanceRoster(11, '2026/2027', 1, '2026-11-19', '1st Term');
    assert.deepStrictEqual(destinationAfterTransfer.students.map(row => Number(row.id)), [101],
      'The transferred student must appear in the destination class after the transfer.');

    await assert.rejects(service.saveDraft({ ...base, actorId:2, attendance:{101:'Present'} }), /not the assigned attendance register holder/);
    await assert.rejects(service.saveDraft({ ...base, sectionId:2, attendance:{101:'Present'} }), /do not belong to the selected school context/);
    const draft = await service.saveDraft({ ...base, attendance:{101:'Present'} });
    assert.equal(draft.status, 'open');
    assert.equal(draft.savedCount, 1);
    await assert.rejects(service.submit({ ...base, attendance:{101:'Present',102:''} }), /incomplete/);
    await db.run(`INSERT INTO attendance_register_reminders
      (school_id,section_id,class_id,staff_id,attendance_date,session,term)
      VALUES (1,1,10,1,'2026-11-05','2026/2027','1st Term')`);
    const submitted = await service.submit({ ...base, attendance:{101:'Present',102:'Leave'} });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.version, 1);
    const reminderState = await db.get('SELECT status FROM attendance_register_reminders WHERE class_id = ? AND attendance_date = ?', [10,'2026-11-05']);
    assert.equal(reminderState.status, 'resolved', 'Register submission must resolve its reminder in the same transaction.');
    await assert.rejects(service.saveDraft({ ...base, attendance:{101:'Absent'} }), /submitted and locked/);
    await assert.rejects(service.reopen({ ...base, actorRole:'Teacher', reason:'Fix' }), /Only an administrator/);
    await assert.rejects(service.reopen({ ...base, actorRole:'Admin', reason:'   ' }), /correction reason is required/);
    const reopened = await service.reopen({ ...base, actorRole:'Admin', reason:'Correct a wrongly marked status' });
    assert.equal(reopened.status, 'open');
    await service.saveDraft({ ...base, attendance:{101:'Late',102:'Leave'} });
    const resubmitted = await service.submit({ ...base, attendance:{101:'Late',102:'Leave'} });
    assert.equal(resubmitted.version, 2);
    const record = await service.getRegister(base);
    assert.equal(record.status, 'submitted');
    assert.deepStrictEqual(record.events.map(event=>event.action), ['submitted','reopened','submitted']);
    assert.equal(record.events[1].reason, 'Correct a wrongly marked status');
    assert.deepStrictEqual(JSON.parse(record.events[0].new_values).map(row => row.status), ['Present','Leave']);
    assert.deepStrictEqual(JSON.parse(record.events[1].old_values).map(row => row.status), ['Present','Leave']);
    assert.deepStrictEqual(JSON.parse(record.events[2].old_values).map(row => row.status), ['Present','Leave']);
    assert.deepStrictEqual(JSON.parse(record.events[2].new_values).map(row => row.status), ['Late','Leave']);
    await assert.rejects(db.run('UPDATE attendance_register_events SET reason = ? WHERE id = ?', ['tampered', record.events[0].id]), /immutable/);

    const oldClass = await service.saveDraft({ ...base, date:'2026-11-06', attendance:{101:'Present'} });
    assert.equal(oldClass.rosterCount, 2, 'The source class roster must include the student before the dated transfer.');
    const newClass = await service.saveDraft({ ...base, classId:11, date:'2026-11-19', attendance:{101:'Present'} });
    assert.equal(newClass.rosterCount, 1, 'The destination class roster must include the student after the dated transfer.');
    const currentSource = await service.saveDraft({ ...base, date:'2026-11-19', attendance:{102:'Present'} });
    assert.equal(currentSource.rosterCount, 1, 'A transferred student must not remain in the source-class roster after the transfer date.');

    const migrationDb2 = new Database(file);
    migrationDb2.prepare(`INSERT INTO students(id,school_id,status,current_class_id) VALUES(103,1,'active',10)`).run();
    migrationDb2.prepare(`INSERT INTO student_enrollments VALUES(4,103,10,'2026/2027')`).run();
    migrationDb2.close();
    const unresolved = await service.saveDraft({ ...base, date:'2026-11-20', attendance:{102:'Present'} });
    assert.equal(unresolved.unknownEnrollmentCount, 1, 'Missing dated placement history must be surfaced, not inferred.');
    await assert.rejects(service.submit({ ...base, date:'2026-11-20', attendance:{102:'Present'} }), /missing or review-needed dated enrollment history/);
    console.log('[attendance-register-sqlite] explicit statuses, transfer-date roster, unresolved enrollment guard, locking, reopen and audit passed.');
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
})().catch(error=>{ console.error('[attendance-register-sqlite] failed:', error); process.exitCode=1; });
