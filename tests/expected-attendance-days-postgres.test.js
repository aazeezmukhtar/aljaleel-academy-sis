'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
const connectionString=process.env.PG_TEST_URL;
if(!connectionString){console.error('[expected-attendance-days-postgres] PG_TEST_URL is required; refusing to use DATABASE_URL.');process.exit(1);}

(async()=>{
 const pool=new Pool({connectionString,max:5});
 const client=await pool.connect();
 const schema='expected_attendance_days_'+process.pid;
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
   INSERT INTO schools VALUES(1),(2);
   INSERT INTO sections VALUES(10,1),(11,1),(20,2);
   INSERT INTO staff VALUES(7,1),(8,2);
   INSERT INTO students VALUES(100,1),(200,2);
   INSERT INTO classes VALUES(1000,1,10),(1001,1,10),(1100,1,11),(2000,2,20);
  `);
  await client.query(fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_calendar_foundation.postgres.sql'),'utf8'));
  await client.query(fs.readFileSync(path.join(__dirname,'..','database/migrations/20261117_student_enrollment_periods.postgres.sql'),'utf8'));
  await client.query(`INSERT INTO section_academic_periods(school_id,section_id,session,term,start_date,end_date)
    VALUES(1,10,'2026/2027','1st Term','2026-09-01','2026-09-10'),(1,11,'2026/2027','1st Term','2026-09-01','2026-09-10')`);
  await client.query(`INSERT INTO class_attendance_schedules
    (school_id,class_id,session,effective_from,effective_to,monday,tuesday,wednesday,thursday,friday,saturday,sunday,created_by)
    VALUES(1,1000,'2026/2027','2026-09-01','2026-09-04',true,true,true,true,false,false,false,7),
          (1,1000,'2026/2027','2026-09-05',NULL,false,false,false,false,false,true,true,7),
          (1,1100,'2026/2027','2026-09-01',NULL,true,true,true,true,true,false,false,7)`);
  await client.query(`INSERT INTO class_attendance_closures(school_id,scope_type,closure_date,reason,created_by)
    VALUES(1,'school','2026-09-02','School-wide closure',7)`);
  await client.query(`INSERT INTO class_attendance_closures(school_id,scope_type,section_id,closure_date,reason,created_by)
    VALUES(1,'section',10,'2026-09-02','Academy closure',7)`);
  await client.query(`INSERT INTO class_attendance_closures(school_id,scope_type,class_id,closure_date,reason,created_by)
    VALUES(1,'class',1000,'2026-09-02','Class event',7),(1,'class',1000,'2026-09-05','Cancelled event',7)`);
  await client.query("UPDATE class_attendance_closures SET status='cancelled' WHERE closure_date='2026-09-05'");
  await client.query(`INSERT INTO student_enrollment_periods
    (school_id,student_id,section_id,class_id,session,start_date,end_date,date_status)
    VALUES(1,100,10,1000,'2026/2027','2026-09-02','2026-09-06','confirmed'),
          (1,100,10,1000,'2026/2027','2026-09-08','2026-09-09','review_needed')`);

  const adapt=sql=>{let n=0;return sql.replace(/\?/g,()=>'$'+(++n));};
  const fakeDb={
   DB_TYPE:'postgres',
   get:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows[0];},
   all:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows;},
   run:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return {changes:r.rowCount};}
  };
  const dbPath=require.resolve('../utils/db');
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
  const service=require('../services/expectedAttendanceDaysService');

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

  const student=await service.calculate({schoolId:1,sectionId:10,classId:1000,studentId:100,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-10'});
  const studentDays=Object.fromEntries(student.days.map(d=>[d.date,d]));
  assert.equal(studentDays['2026-09-01'].status,'outside_enrollment');
  assert.equal(studentDays['2026-09-06'].status,'expected');
  assert.equal(studentDays['2026-09-07'].status,'outside_enrollment');
  assert.equal(studentDays['2026-09-08'].status,'unknown_enrollment');
  const otherSection=await service.calculate({schoolId:1,sectionId:11,classId:1100,session:'2026/2027',term:'1st Term',startDate:'2026-09-03',endDate:'2026-09-03'});\n  assert.equal(otherSection.days[0].status,'expected','A section closure must not affect a different section.');\n  const noSchedule=await service.calculate({schoolId:1,sectionId:10,classId:1001,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'});
  assert.equal(noSchedule.days[0].status,'unknown_schedule');
  const missingPeriod=await service.calculate({schoolId:1,sectionId:10,classId:1000,session:'2026/2027',term:'2nd Term',startDate:'2026-09-01',endDate:'2026-09-02'});
  assert.equal(missingPeriod.days[0].status,'unknown_period');
  await assert.rejects(()=>service.calculate({schoolId:1,sectionId:11,classId:1000,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'}),/does not belong/);
  await assert.rejects(()=>service.calculate({schoolId:2,sectionId:20,classId:2000,studentId:100,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-09-02'}),/student does not belong/);
  console.log('[expected-attendance-days-postgres] PostgreSQL classifications, inclusive dates, closure scopes, tenant/section isolation and unknown history passed.');
 }finally{
  try{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}
  finally{client.release();await pool.end();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
