'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE schools(id INTEGER PRIMARY KEY);
  CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER NOT NULL REFERENCES sections(id));
  CREATE TABLE term_events(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER, event_date DATE NOT NULL);
  CREATE TABLE student_enrollment_history(id INTEGER PRIMARY KEY);
  CREATE TABLE attendance(
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL,
    section_id INTEGER NOT NULL, date DATE NOT NULL, status TEXT NOT NULL,
    session TEXT NOT NULL, term TEXT NOT NULL, reason TEXT, reason_type TEXT, custom_reason TEXT,
    UNIQUE(student_id,section_id,date,session,term)
  );
  INSERT INTO schools VALUES(1);
  INSERT INTO sections VALUES(10,1),(11,1);
  INSERT INTO staff VALUES(7,1);
  INSERT INTO students VALUES(100,1);
  INSERT INTO classes VALUES(1000,1,10),(1100,1,11);
`);
const migrationDir = path.join(__dirname, '..', 'database', 'migrations');
sqlite.exec(fs.readFileSync(path.join(migrationDir,'20261119_attendance_calendar_foundation.sqlite.sql'),'utf8'));
sqlite.exec(fs.readFileSync(path.join(migrationDir,'20261119_attendance_register_submission.sqlite.sql'),'utf8'));
sqlite.exec(fs.readFileSync(path.join(migrationDir,'20261117_student_enrollment_periods.sqlite.sql'),'utf8'));
sqlite.prepare(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
  VALUES(1,10,'2026/2027','1st Term','2026-09-01','2026-09-10'),
        (1,11,'2026/2027','1st Term','2026-09-01','2026-09-10')`).run();
sqlite.prepare(`INSERT INTO class_attendance_schedules
  (school_id,class_id,session,effective_from,monday,tuesday,wednesday,thursday,friday,saturday,sunday,created_by)
  VALUES(1,1000,'2026/2027','2026-09-01',1,1,1,1,1,0,0,7),
        (1,1100,'2026/2027','2026-09-01',1,1,1,1,1,0,0,7)`).run();
sqlite.prepare(`INSERT INTO student_enrollment_periods
  (school_id,student_id,section_id,class_id,session,start_date,end_date,date_status)
  VALUES(1,100,10,1000,'2026/2027','2026-09-01','2026-09-10','confirmed')`).run();

const insertRegister = sqlite.prepare(`INSERT INTO attendance_registers
  (school_id,section_id,class_id,attendance_date,session,term,status,submission_version)
  VALUES(1,10,1000,?,'2026/2027','1st Term',?,?)`);
insertRegister.run('2026-09-01','submitted',1);
insertRegister.run('2026-09-02','submitted',1);
insertRegister.run('2026-09-03','submitted',1);
insertRegister.run('2026-09-04','open',0);
insertRegister.run('2026-09-08','submitted',1);
insertRegister.run('2026-09-09','submitted',1);
sqlite.prepare(`INSERT INTO attendance(student_id,class_id,section_id,date,status,session,term)
  VALUES(100,1000,10,'2026-09-01','Present','2026/2027','1st Term'),
        (100,1000,10,'2026-09-02','Leave','2026/2027','1st Term'),
        (100,1000,10,'2026-09-03','Absent','2026/2027','1st Term'),
        (100,1000,10,'2026-09-09','Late','2026/2027','1st Term')`).run();

const fakeDb = {
  DB_TYPE:'sqlite',
  get:async(sql,params=[])=>sqlite.prepare(sql).get(params),
  all:async(sql,params=[])=>sqlite.prepare(sql).all(params),
  run:async(sql,params=[])=>{const r=sqlite.prepare(sql).run(params);return {changes:r.changes,lastInsertRowid:r.lastInsertRowid};}
};
const dbPath=require.resolve('../utils/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const analytics=require('../services/attendanceAnalyticsService');

(async()=>{
  try {
    const result=await analytics.calculate({
      schoolId:1,sectionId:10,classId:1000,studentId:100,
      session:'2026/2027',term:'1st Term',
      startDate:'2026-09-01',endDate:'2026-09-10',lowAttendanceThreshold:80
    });
    assert.equal(result.counts.expected,8,'All enrolled expected opening days remain visible, including unsubmitted days.');
    assert.equal(result.counts.recorded,4,'Only submitted registers with a student row enter the denominator.');
    assert.equal(result.counts.present,1);
    assert.equal(result.counts.approvedLeave,1,'Leave receives full attendance credit.');
    assert.equal(result.counts.absent,1);
    assert.equal(result.counts.late,1);
    assert.equal(result.counts.draftRegister,1,'Draft register is not absence.');
    assert.equal(result.counts.missingRegister,2,'Missing register is not absence.');
    assert.equal(result.counts.missingStudentRecord,1);
    assert.equal(result.attendanceCredits,3);
    assert.equal(result.attendanceRate,75);
    assert.equal(result.lowAttendance,true);
    assert.equal(result.days.find(day=>day.date==='2026-09-02').credit,1);
    assert.equal(result.days.find(day=>day.date==='2026-09-03').credit,0);
    assert.equal(result.days.find(day=>day.date==='2026-09-04').status,'draft_register');
    assert.equal(result.days.find(day=>day.date==='2026-09-07').status,'missing_register');
    assert.equal(result.days.find(day=>day.date==='2026-09-08').status,'missing_student_record');
    await assert.rejects(()=>analytics.calculate({
      schoolId:1,sectionId:11,classId:1000,studentId:100,session:'2026/2027',
      term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-10',lowAttendanceThreshold:80
    }),/does not belong/);
    await assert.rejects(()=>analytics.calculate({
      schoolId:1,sectionId:10,classId:1000,studentId:100,session:'2026/2027',
      term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-10',lowAttendanceThreshold:101
    }),/0 to 100/);
    console.log('[attendance-analytics-sqlite] submitted-register denominator, Leave credit, absence, drafts, missing registers, incomplete rows, threshold and section isolation passed.');
  } finally { sqlite.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
