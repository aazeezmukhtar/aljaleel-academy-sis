'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');
const connectionString=process.env.PG_TEST_URL;
if(!connectionString){console.error('[attendance-register-reminders-postgres] PG_TEST_URL is required; refusing to use DATABASE_URL.');process.exit(1);}

(async()=>{
 const pool=new Pool({connectionString,max:2});
 const client=await pool.connect();
 const schema='attendance_reminders_'+process.pid;
 try{
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
   CREATE TABLE schools(id BIGINT PRIMARY KEY);
   CREATE TABLE sections(id BIGINT PRIMARY KEY,school_id BIGINT NOT NULL,name TEXT,current_session TEXT,current_term TEXT);
   CREATE TABLE staff(id BIGINT PRIMARY KEY,school_id BIGINT NOT NULL);
   CREATE TABLE classes(id BIGINT PRIMARY KEY,school_id BIGINT NOT NULL,section_id BIGINT NOT NULL,name TEXT);
   CREATE TABLE term_events(id BIGINT PRIMARY KEY,school_id BIGINT NOT NULL,section_id BIGINT,event_date DATE NOT NULL);
   CREATE TABLE attendance_registers(id BIGINT PRIMARY KEY,school_id BIGINT,section_id BIGINT,class_id BIGINT,attendance_date DATE,session TEXT,term TEXT,status TEXT);
   INSERT INTO schools VALUES(1);
   INSERT INTO sections VALUES(10,1,'Academy','2026/2027','1st Term');
   INSERT INTO staff VALUES(7,1),(8,1);
   INSERT INTO classes VALUES(100,1,10,'Nursery 1'),(101,1,10,'Nursery 2'),
     (102,1,10,'Primary 1'),(103,1,10,'Primary 2'),(104,1,10,'Primary 3');
  `);
  const calendar=fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_calendar_foundation.postgres.sql'),'utf8');
  const reminders=fs.readFileSync(path.join(__dirname,'..','database/migrations/20261119_attendance_register_reminders.postgres.sql'),'utf8');
  await client.query(calendar);
  await client.query(reminders);
  await client.query(reminders);
  await client.query(`INSERT INTO section_academic_periods
    (school_id,section_id,session,term,start_date,end_date)
    VALUES(1,10,'2026/2027','1st Term','2026-11-16','2026-11-30')`);
  await client.query(`INSERT INTO class_attendance_schedules
    (school_id,class_id,session,effective_from,monday,tuesday,wednesday,created_by)
    VALUES(1,100,'2026/2027','2026-11-01',TRUE,FALSE,TRUE,7),
      (1,101,'2026/2027','2026-11-01',FALSE,TRUE,FALSE,7),
      (1,103,'2026/2027','2026-11-01',TRUE,FALSE,TRUE,7),
      (1,104,'2026/2027','2026-11-01',TRUE,FALSE,TRUE,7)`);
  await client.query(`INSERT INTO class_attendance_responsibilities
    (school_id,class_id,staff_id,session,effective_from,created_by)
    VALUES(1,100,7,'2026/2027','2026-11-01',7),
      (1,101,7,'2026/2027','2026-11-01',7),
      (1,102,7,'2026/2027','2026-11-01',7),
      (1,103,7,'2026/2027','2026-11-01',7),
      (1,104,8,'2026/2027','2026-11-01',8)`);
  await client.query(`INSERT INTO class_attendance_closures
    (school_id,scope_type,class_id,closure_date,reason,created_by)
    VALUES(1,'class',103,'2026-11-18','Class closure',7)`);
  await client.query(`INSERT INTO attendance_registers
    (id,school_id,section_id,class_id,attendance_date,session,term,status)
    VALUES(1,1,10,100,'2026-11-16','2026/2027','1st Term','submitted')`);

  const adapt=sql=>sql.replace(/\?/g,((n)=>()=>'$'+(++n))(0));
  const fakeDb={
   DB_TYPE:'postgres',
   get:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows[0];},
   all:async(sql,params=[])=>{const r=await client.query(adapt(sql),params);return r.rows;},
   run:async(sql,params=[])=>{let q=adapt(sql);if(/INSERT OR IGNORE/i.test(q)){q=q.replace(/INSERT OR IGNORE/i,'INSERT')+' ON CONFLICT DO NOTHING';}const r=await client.query(q,params);return {changes:r.rowCount,lastInsertRowid:null};}
  };
  const dbPath=require.resolve('../utils/db');
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
  const service=require('../services/attendanceRegisterReminderService');
  const first=await service.collectForStaff({schoolId:1,staffId:7,today:'2026-11-19'});
  assert.equal(first.length,1);
  assert.equal(Number(first[0].class_id),100);
  assert.equal(String(first[0].attendance_date).slice(0,10),'2026-11-18');
  const second=await service.collectForStaff({schoolId:1,staffId:7,today:'2026-11-19'});
  assert.equal(second.length,1);
  const count=await client.query('SELECT COUNT(*)::int AS n FROM attendance_register_reminders');
  assert.equal(count.rows[0].n,1,'Repeated reminder collection must be idempotent.');
  const other=await service.collectForStaff({schoolId:1,staffId:8,today:'2026-11-19'});
  assert.equal(other.length,0);
  console.log('[attendance-register-reminders-postgres] PostgreSQL expected-day filtering, closures, responsibility scope, submitted exclusion and idempotency passed.');
 }finally{
  try{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}
  finally{client.release();await pool.end();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
