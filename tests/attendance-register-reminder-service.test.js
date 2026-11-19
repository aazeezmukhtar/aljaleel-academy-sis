'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE schools(id INTEGER PRIMARY KEY);
  CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, name TEXT, current_session TEXT, current_term TEXT);
  CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL);
  CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, section_id INTEGER NOT NULL, name TEXT);
  CREATE TABLE term_events(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, section_id INTEGER, event_date DATE NOT NULL);
  CREATE TABLE attendance_registers(id INTEGER PRIMARY KEY, school_id INTEGER, section_id INTEGER, class_id INTEGER, attendance_date DATE, session TEXT, term TEXT, status TEXT);
  INSERT INTO schools VALUES(1);
  INSERT INTO sections VALUES(10,1,'Academy','2026/2027','1st Term');
  INSERT INTO staff VALUES(7,1),(8,1);
  INSERT INTO classes VALUES(100,1,10,'Nursery 1'),(101,1,10,'Nursery 2'),
    (102,1,10,'Primary 1'),(103,1,10,'Primary 2'),(104,1,10,'Primary 3');
`);
const calendar = fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_calendar_foundation.sqlite.sql'),'utf8');
const reminders = fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_register_reminders.sqlite.sql'),'utf8');
sqlite.exec(calendar);
sqlite.exec(reminders);
sqlite.exec(reminders);
sqlite.prepare(`INSERT INTO section_academic_periods
  (school_id,section_id,session,term,start_date,end_date)
  VALUES(1,10,'2026/2027','1st Term','2026-11-16','2026-11-30')`).run();
sqlite.prepare(`INSERT INTO class_attendance_schedules
  (school_id,class_id,session,effective_from,monday,tuesday,wednesday,thursday,created_by)
  VALUES(1,100,'2026/2027','2026-11-01',1,0,1,0,7),
        (1,101,'2026/2027','2026-11-01',0,0,0,1,7),
        (1,103,'2026/2027','2026-11-01',0,0,1,0,7),
        (1,104,'2026/2027','2026-11-01',0,0,0,1,8)`).run();
sqlite.prepare(`INSERT INTO class_attendance_responsibilities
  (school_id,class_id,staff_id,session,effective_from,created_by)
  VALUES(1,100,7,'2026/2027','2026-11-01',7),
        (1,101,7,'2026/2027','2026-11-01',7),
        (1,102,7,'2026/2027','2026-11-01',7),
        (1,103,7,'2026/2027','2026-11-01',7),
        (1,104,8,'2026/2027','2026-11-01',8)`).run();
sqlite.prepare(`INSERT INTO class_attendance_closures
  (school_id,scope_type,class_id,closure_date,reason,created_by)
  VALUES(1,'class',103,'2026-11-18','Class closure',7)`).run();
sqlite.prepare(`INSERT INTO attendance_registers
  (id,school_id,section_id,class_id,attendance_date,session,term,status)
  VALUES(1,1,10,100,'2026-11-16','2026/2027','1st Term','submitted')`).run();

const fakeDb = {
  DB_TYPE:'sqlite',
  get:async(sql,params=[])=>sqlite.prepare(sql).get(params),
  all:async(sql,params=[])=>sqlite.prepare(sql).all(params),
  run:async(sql,params=[])=>{const r=sqlite.prepare(sql).run(params);return {changes:r.changes,lastInsertRowid:r.lastInsertRowid};}
};
const dbPath=require.resolve('../utils/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const service=require('../services/attendanceRegisterReminderService');

(async()=>{
  try{
    const first=await service.collectForStaff({schoolId:1,staffId:7,today:'2026-11-19'});
    assert.deepStrictEqual(first.map(row=>Number(row.class_id)),[100],
      'Only expected, unsubmitted dates with an explicit responsibility should create reminders.');
    assert.equal(first.length,1);
    assert.equal(String(first[0].attendance_date).slice(0,10),'2026-11-18');
    const second=await service.collectForStaff({schoolId:1,staffId:7,today:'2026-11-19'});
    assert.equal(second.length,1,'Repeated notification requests must not duplicate reminders.');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attendance_register_reminders').get().n,1);
    const otherStaff=await service.collectForStaff({schoolId:1,staffId:8,today:'2026-11-19'});
    assert.equal(otherStaff.length,0,'Reminders must be visible only to the assigned staff member.');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM attendance_register_reminders WHERE class_id IN (101,102,103,104)").get().n,0,
      'Non-opening, unknown schedule, closed, and other staff classes must not create reminders.');
    console.log('[attendance-register-reminders-sqlite] expected-day filtering, closure handling, explicit responsibility, submitted exclusion, tenant/staff scope and idempotency passed.');
  }finally{sqlite.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
