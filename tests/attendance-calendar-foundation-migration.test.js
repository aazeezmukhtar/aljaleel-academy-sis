'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
  '20261119_attendance_calendar_foundation.sqlite.sql'), 'utf8');
try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schools(id INTEGER PRIMARY KEY);
    CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
    CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
    CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER NOT NULL REFERENCES sections(id));
    CREATE TABLE term_events(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER, event_date DATE NOT NULL);
    INSERT INTO schools VALUES(1);
    INSERT INTO sections VALUES(1,1),(2,1);
    INSERT INTO staff VALUES(1,1);
    INSERT INTO classes VALUES(10,1,1),(20,1,2);
    INSERT INTO term_events VALUES(100,1,NULL,'2026-12-25');
  `);
  db.exec(migration);
  db.exec(migration);
  const expectedTables = ['section_academic_periods','class_attendance_schedules',
    'class_attendance_closures','class_attendance_responsibilities','attendance_foundation_audit_logs'];
  const actual = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  for (const name of expectedTables) assert.ok(actual.has(name), 'Missing table '+name);

  db.prepare(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
    VALUES(1,1,'2026/2027','1st Term','2026-09-01','2026-12-20')`).run();
  assert.throws(()=>db.prepare(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
    VALUES(1,1,'2026/2027','1st Term','2026-09-01','2026-12-20')`).run(), /UNIQUE constraint failed/);
  assert.throws(()=>db.prepare(`INSERT INTO class_attendance_schedules
    (school_id,class_id,session,effective_from,created_by) VALUES(1,10,'2026/2027','2026-09-01',1)`).run(), /CHECK constraint failed/);
  db.prepare(`INSERT INTO class_attendance_schedules
    (school_id,class_id,session,effective_from,monday,tuesday,created_by)
    VALUES(1,10,'2026/2027','2026-09-01',1,1,1)`).run();

  assert.throws(()=>db.prepare(`INSERT INTO class_attendance_closures
    (school_id,scope_type,section_id,closure_date,reason,created_by)
    VALUES(1,'school',1,'2026-12-25','Invalid school target',1)`).run(), /CHECK constraint failed/);
  db.prepare(`INSERT INTO class_attendance_closures
    (school_id,scope_type,closure_date,reason,source_event_id,created_by)
    VALUES(1,'school','2026-12-25','Christmas',100,1)`).run();
  assert.throws(()=>db.prepare(`INSERT INTO class_attendance_closures
    (school_id,scope_type,closure_date,reason,created_by)
    VALUES(1,'school','2026-12-25','Duplicate',1)`).run(), /UNIQUE constraint failed/);
  db.prepare(`UPDATE class_attendance_closures SET status='cancelled' WHERE id=1`).run();
  db.prepare(`INSERT INTO class_attendance_closures
    (school_id,scope_type,closure_date,reason,created_by)
    VALUES(1,'school','2026-12-25','Replacement closure',1)`).run();

  db.prepare(`INSERT INTO class_attendance_responsibilities
    (school_id,class_id,staff_id,session,effective_from,created_by)
    VALUES(1,10,1,'2026/2027','2026-09-01',1)`).run();
  db.prepare(`INSERT INTO attendance_foundation_audit_logs
    (school_id,entity_type,entity_id,action,new_values,reason,changed_by)
    VALUES(1,'attendance_schedule',1,'created','{"monday":true}','Initial schedule',1)`).run();
  assert.throws(()=>db.prepare('UPDATE attendance_foundation_audit_logs SET reason=? WHERE id=1').run('tampered'),
    /immutable/);
  assert.throws(()=>db.prepare('DELETE FROM attendance_foundation_audit_logs WHERE id=1').run(), /immutable/);
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  console.log('[attendance-foundation-sqlite] schema, checks, closure lifecycle, audit immutability, rerun and FK checks passed.');
} finally { db.close(); }
