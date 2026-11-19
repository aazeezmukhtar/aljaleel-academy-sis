'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
try {
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE schools(id INTEGER PRIMARY KEY); CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id)); CREATE TABLE staff(id INTEGER PRIMARY KEY); CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id)); CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id)); CREATE TABLE student_enrollment_history(id INTEGER PRIMARY KEY); CREATE TABLE student_enrollment_periods(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), student_id INTEGER REFERENCES students(id), section_id INTEGER REFERENCES sections(id), class_id INTEGER REFERENCES classes(id), session TEXT, start_date DATE, end_date DATE, start_event_id INTEGER REFERENCES student_enrollment_history(id), end_event_id INTEGER REFERENCES student_enrollment_history(id), date_status TEXT); CREATE TABLE attendance(id INTEGER PRIMARY KEY, status TEXT); INSERT INTO schools VALUES(1); INSERT INTO sections VALUES(10,1); INSERT INTO staff VALUES(20); INSERT INTO students VALUES(30,1); INSERT INTO classes VALUES(40,1,10); INSERT INTO student_enrollment_periods VALUES(50,1,30,10,40,\'2026/2027\',\'2026-09-01\',NULL,NULL,NULL,\'confirmed\'); INSERT INTO attendance VALUES(60,\'Leave\');');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.sqlite.sql'), 'utf8');
  db.exec(sql);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  for (const name of ['section_academic_periods','class_attendance_schedules','class_attendance_responsibilities','class_attendance_settings','class_attendance_closures','attendance_registers','attendance_register_students','attendance_register_events','attendance_register_reminders','attendance_foundation_audit_logs']) assert.ok(names.has(name), 'missing ' + name);
  db.prepare("INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date) VALUES(1,10,'2026/2027','1st Term','2026-09-01','2026-12-20')").run();
  db.prepare("INSERT INTO class_attendance_schedules(school_id,class_id,section_id,weekday,effective_from,created_by) VALUES(1,40,10,3,'2026-09-01',20)").run();
  db.prepare("INSERT INTO attendance_registers(school_id,class_id,section_id,academic_period_id,schedule_id,register_date,submission_deadline_at,expected_student_count) VALUES(1,40,10,1,1,'2026-11-18','2026-11-18T14:00:00Z',1)").run();
  db.prepare('INSERT INTO attendance_register_students(register_id,student_id,enrollment_period_id) VALUES(1,30,50)').run();
  assert.throws(() => db.prepare("INSERT INTO attendance_registers(school_id,class_id,section_id,academic_period_id,schedule_id,register_date,submission_deadline_at) VALUES(1,40,10,1,1,'2026-11-18','2026-11-18T14:00:00Z')").run(), /UNIQUE constraint failed/);
  assert.throws(() => db.prepare("INSERT INTO class_attendance_schedules(school_id,class_id,section_id,weekday,effective_from) VALUES(1,40,10,8,'2026-09-01')").run(), /CHECK constraint failed/);
  assert.strictEqual(db.prepare('SELECT status FROM attendance WHERE id=60').get().status, 'Leave');
  db.exec(sql);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM attendance_registers').get().n, 1);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  console.log('[attendance-register-sqlite] schema, key constraints, idempotency and existing attendance preservation passed.');
} finally { db.close(); }