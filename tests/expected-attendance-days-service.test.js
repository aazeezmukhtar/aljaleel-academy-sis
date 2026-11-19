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
  INSERT INTO schools VALUES (1),(2);
  INSERT INTO sections VALUES (10,1),(11,1),(20,2);
  INSERT INTO staff VALUES (7,1),(8,2);
  INSERT INTO students VALUES (100,1),(200,2);
  INSERT INTO classes VALUES (1000,1,10),(1001,1,10),(1100,1,11),(2000,2,20);
`);
sqlite.exec(fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_calendar_foundation.sqlite.sql'),'utf8'));
sqlite.exec(fs.readFileSync(path.join(__dirname,'..','database/migrations/20261117_student_enrollment_periods.sqlite.sql'),'utf8'));

sqlite.prepare(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
  VALUES (1,10,'2026/2027','1st Term','2026-09-01','2026-09-10'),
         (1,11,'2026/2027','1st Term','2026-09-01','2026-09-10')`).run();
const schedule = sqlite.prepare(`INSERT INTO class_attendance_schedules
  (school_id,class_id,session,effective_from,effective_to,monday,tuesday,wednesday,thursday,friday,saturday,sunday,created_by)
  VALUES (1,1000,'2026/2027','2026-09-01','2026-09-04',1,1,1,1,0,0,0,7),
         (1,1000,'2026/2027','2026-09-05',NULL,0,0,0,0,0,1,1,7),
         (1,1100,'2026/2027','2026-09-01',NULL,1,1,1,1,1,0,0,7)`).run();
sqlite.prepare(`INSERT INTO class_attendance_closures(school_id,scope_type,section_id,class_id,closure_date,reason,created_by)
  VALUES (1,'school',NULL,NULL,'2026-09-02','School-wide closure',7),
         (1,'section',10,NULL,'2026-09-02','Academy closure',7),
         (1,'class',NULL,1000,'2026-09-02','Class event',7),
         (1,'section',10,NULL,'2026-09-03','Section-only closure',7),
         (1,'class',NULL,1000,'2026-09-05','Cancelled event',7)`).run();
sqlite.prepare("UPDATE class_attendance_closures SET status='cancelled' WHERE closure_date='2026-09-05'").run();
sqlite.prepare(`INSERT INTO student_enrollment_periods
  (school_id,student_id,section_id,class_id,session,start_date,end_date,date_status)
  VALUES (1,100,10,1000,'2026/2027','2026-09-02','2026-09-06','confirmed'),
         (1,100,10,1000,'2026/2027','2026-09-08','2026-09-09','review_needed')`).run();

const fakeDb = {
  DB_TYPE:'sqlite',
  get:async(sql,params=[])=>sqlite.prepare(sql).get(params),
  all:async(sql,params=[])=>sqlite.prepare(sql).all(params),
  run:async(sql,params=[])=>{const r=sqlite.prepare(sql).run(params);return {changes:r.changes,lastInsertRowid:r.lastInsertRowid};}
};
const dbPath=require.resolve('../utils/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const service=require('../services/expectedAttendanceDaysService');

(async()=>{
  try {
    const result=await service.calculate({schoolId:1,sectionId:10,classId:1000,session:'2026/2027',term:'1st Term',startDate:'2026-08-31',endDate:'2026-09-10'});
    const byDate=Object.fromEntries(result.days.map(d=>[d.date,d]));
    assert.equal(byDate['2026-08-31'].status,'outside_term');
    assert.equal(byDate['2026-09-01'].status,'expected');
    assert.equal(byDate['2026-09-02'].status,'closed');
    assert.equal(byDate['2026-09-03'].status,'closed');
    assert.equal(byDate['2026-09-04'].status,'expected');
    assert.equal(byDate['2026-09-05'].status,'non_opening');
    assert.equal(byDate['2026-09-06'].status,'expected');
    assert.equal(byDate['2026-09-07'].status,'non_opening');
    assert.equal(byDate['2026-09-10'].status,'non_opening');
    assert.deepEqual(byDate['2026-09-02'].closureIds.length,3,'School, section and class closures apply together but the date is counted only once.');

    const student=await service.calculate({schoolId:1,sectionId:10,classId:1000,studentId:100,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-10'});
    const studentDays=Object.fromEntries(student.days.map(d=>[d.date,d]));
    assert.equal(studentDays['2026-09-01'].status,'outside_enrollment','Enrollment start date is inclusive.');
    assert.equal(studentDays['2026-09-02'].status,'closed');
    assert.equal(studentDays['2026-09-06'].status,'expected','Enrollment end date is inclusive.');
    assert.equal(studentDays['2026-09-07'].status,'outside_enrollment');
    assert.equal(studentDays['2026-09-08'].status,'unknown_enrollment','Review-needed enrollment must not count as confirmed.');
    assert.equal(studentDays['2026-09-09'].status,'unknown_enrollment');

    const otherSection=await service.calculate({schoolId:1,sectionId:11,classId:1100,session:'2026/2027',term:'1st Term',startDate:'2026-09-03',endDate:'2026-09-03'});
    assert.equal(otherSection.days[0].status,'expected','A section closure must not affect a different section.');
    const noSchedule=await service.calculate({schoolId:1,sectionId:10,classId:1001,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'});
    assert.equal(noSchedule.days[0].status,'unknown_schedule','Missing schedule is unknown, not a closure or non-opening day.');
    const missingTerm=await service.calculate({schoolId:1,sectionId:10,classId:1000,session:'2026/2027',term:'2nd Term',startDate:'2026-09-01',endDate:'2026-09-02'});
    assert.equal(missingTerm.days[0].status,'unknown_period');
    await assert.rejects(()=>service.calculate({schoolId:1,sectionId:11,classId:1000,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'}),/does not belong/);
    await assert.rejects(()=>service.calculate({schoolId:2,sectionId:20,classId:2000,studentId:100,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'}),/student does not belong/);
    assert.equal(result.counts.expected+result.counts.closed+result.counts.non_opening+result.counts.unknown_schedule+result.counts.outside_term+result.counts.unknown_period,11);
    console.log('[expected-attendance-days] SQLite term boundaries, effective schedules, closure scopes, cancellation, section isolation, inclusive enrollment and unknown history passed.');
  } finally { sqlite.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
