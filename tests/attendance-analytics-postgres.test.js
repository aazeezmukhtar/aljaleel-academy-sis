'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
const connectionString=process.env.PG_TEST_URL;
if(!connectionString){console.error('[attendance-analytics-postgres] PG_TEST_URL is required; refusing to use DATABASE_URL.');process.exit(1);}

(async()=>{
 const pool=new Pool({connectionString,max:5});
 const client=await pool.connect();
 const schema='attendance_analytics_'+process.pid;
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
   CREATE TABLE schools(id BIGSERIAL PRIMARY KEY);
   CREATE TABLE sections(id BIGSERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id));
   CREATE TABLE staff(id BIGSERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id));
   CREATE TABLE students(id BIGSERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id));
   CREATE TABLE classes(id BIGSERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id),section_id BIGINT NOT NULL REFERENCES sections(id));
   CREATE TABLE term_events(id BIGSERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id),section_id BIGINT,event_date DATE NOT NULL);
   CREATE TABLE student_enrollment_history(id BIGSERIAL PRIMARY KEY);
   CREATE TABLE attendance(
    id BIGSERIAL PRIMARY KEY,student_id BIGINT NOT NULL,class_id BIGINT NOT NULL,
    section_id BIGINT NOT NULL,date DATE NOT NULL,status TEXT NOT NULL,
    session TEXT NOT NULL,term TEXT NOT NULL,reason TEXT,reason_type TEXT,custom_reason TEXT,
    UNIQUE(student_id,section_id,date,session,term)
   );
   INSERT INTO schools VALUES(1);
   INSERT INTO sections VALUES(10,1),(11,1);
   INSERT INTO staff VALUES(7,1);
   INSERT INTO students VALUES(100,1);
   INSERT INTO classes VALUES(1000,1,10),(1100,1,11);
  `);
  const dir=path.join(__dirname,'..','database','migrations');
  await client.query(fs.readFileSync(path.join(dir,'20261119_attendance_calendar_foundation.postgres.sql'),'utf8'));
  await client.query(fs.readFileSync(path.join(dir,'20261119_attendance_register_submission.postgres.sql'),'utf8'));
  await client.query(fs.readFileSync(path.join(dir,'20261117_student_enrollment_periods.postgres.sql'),'utf8'));
  await client.query(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
    VALUES(1,10,'2026/2027','1st Term','2026-09-01','2026-09-10'),
          (1,11,'2026/2027','1st Term','2026-09-01','2026-09-10')`);
  await client.query(`INSERT INTO class_attendance_schedules
    (school_id,class_id,session,effective_from,monday,tuesday,wednesday,thursday,friday,saturday,sunday,created_by)
    VALUES(1,1000,'2026/2027','2026-09-01',true,true,true,true,true,false,false,7),
          (1,1100,'2026/2027','2026-09-01',true,true,true,true,true,false,false,7)`);
  await client.query(`INSERT INTO student_enrollment_periods
    (school_id,student_id,section_id,class_id,session,start_date,end_date,date_status)
    VALUES(1,100,10,1000,'2026/2027','2026-09-01','2026-09-10','confirmed')`);
  await client.query(`INSERT INTO attendance_registers
    (school_id,section_id,class_id,attendance_date,session,term,status,submission_version)
    VALUES(1,10,1000,'2026-09-01','2026/2027','1st Term','submitted',1),
          (1,10,1000,'2026-09-02','2026/2027','1st Term','submitted',1),
          (1,10,1000,'2026-09-03','2026/2027','1st Term','submitted',1),
          (1,10,1000,'2026-09-04','2026/2027','1st Term','open',0),
          (1,10,1000,'2026-09-08','2026/2027','1st Term','submitted',1),
          (1,10,1000,'2026-09-09','2026/2027','1st Term','submitted',1)`);
  await client.query(`INSERT INTO attendance(student_id,class_id,section_id,date,status,session,term)
    VALUES(100,1000,10,'2026-09-01','Present','2026/2027','1st Term'),
          (100,1000,10,'2026-09-02','Leave','2026/2027','1st Term'),
          (100,1000,10,'2026-09-03','Absent','2026/2027','1st Term'),
          (100,1000,10,'2026-09-09','Late','2026/2027','1st Term')`);

  const adapt=sql=>{let n=0;return sql.replace(/\?/g,()=>'$'+(++n));};
  const fakeDb={
   DB_TYPE:'postgres',
   get:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows[0];},
   all:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows;},
   run:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return {changes:r.rowCount};}
  };
  const dbPath=require.resolve('../utils/db');
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
  const analytics=require('../services/attendanceAnalyticsService');
  const result=await analytics.calculate({
   schoolId:1,sectionId:10,classId:1000,studentId:100,
   session:'2026/2027',term:'1st Term',startDate:'2026-09-01',
   endDate:'2026-09-10',lowAttendanceThreshold:80
  });
  assert.equal(result.counts.expected,8);
  assert.equal(result.counts.recorded,4);
  assert.equal(result.counts.approvedLeave,1);
  assert.equal(result.counts.absent,1);
  assert.equal(result.counts.draftRegister,1);
  assert.equal(result.counts.missingRegister,2);
  assert.equal(result.counts.missingStudentRecord,1);
  assert.equal(result.attendanceRate,75);
  assert.equal(result.lowAttendance,true);
  await assert.rejects(()=>analytics.calculate({
   schoolId:1,sectionId:11,classId:1000,studentId:100,
   session:'2026/2027',term:'1st Term',startDate:'2026-09-01',
   endDate:'2026-09-10',lowAttendanceThreshold:80
  }),/does not belong/);
  console.log('[attendance-analytics-postgres] PostgreSQL submitted denominator, leave credit, drafts, missing registers, incomplete records, threshold and section isolation passed.');
 }finally{
  try{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}
  finally{client.release();await pool.end();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
