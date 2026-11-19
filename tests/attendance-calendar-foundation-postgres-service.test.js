'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.PG_TEST_URL;
if (!connectionString) {
  console.error('[attendance-foundation-postgres-service] PG_TEST_URL is required; refusing to use DATABASE_URL.');
  process.exit(1);
}
(async()=>{
  const pool=new Pool({connectionString,max:1});
  const client=await pool.connect();
  const schema='attendance_foundation_service_'+process.pid;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE schools(id SERIAL PRIMARY KEY);
      CREATE TABLE sections(id SERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id));
      CREATE TABLE staff(id SERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id));
      CREATE TABLE classes(id SERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id),section_id BIGINT NOT NULL REFERENCES sections(id));
      CREATE TABLE term_events(id SERIAL PRIMARY KEY,school_id BIGINT NOT NULL REFERENCES schools(id),section_id BIGINT,event_date DATE NOT NULL);
      INSERT INTO schools VALUES(1),(2);
      INSERT INTO sections VALUES(10,1),(20,2);
      INSERT INTO staff VALUES(7,1),(8,2);
      INSERT INTO classes VALUES(100,1,10),(200,2,20);
      INSERT INTO term_events VALUES(500,1,10,'2026-12-25');
    `);
    const migration=fs.readFileSync(path.join(__dirname,'..','database','migrations','20261119_attendance_calendar_foundation.postgres.sql'),'utf8');
    await client.query(migration);

    const adapt=sql=>{let n=0;return sql.replace(/\\?/g,()=>'$'+(++n));};
    const fakeDb={
      DB_TYPE:'postgres',
      get:async(sql,params=[],tx=null)=>{const r=await (tx||client).query(adapt(sql),params.map(v=>v===undefined?null:v));return r.rows[0];},
      all:async(sql,params=[],tx=null)=>{const r=await (tx||client).query(adapt(sql),params.map(v=>v===undefined?null:v));return r.rows;},
      run:async(sql,params=[],tx=null)=>{const r=await (tx||client).query(adapt(sql),params.map(v=>v===undefined?null:v));return {changes:r.rowCount,lastInsertRowid:null};},
      transaction:async callback=>{await client.query('BEGIN');try{const v=await callback(client);await client.query('COMMIT');return v;}catch(e){await client.query('ROLLBACK');throw e;}}
    };
    fakeDb.transactionImmediate=fakeDb.transaction;
    const dbPath=require.resolve('../utils/db');
    require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
    const service=require('../services/attendanceFoundationService');

    const period=await service.create('academic_period',{schoolId:1,sectionId:10,session:'2026/2027',term:'1st Term',startDate:'2026-09-01',endDate:'2026-12-20',createdBy:7});
    assert.ok(period.id>0);
    await assert.rejects(()=>service.create('academic_period',{schoolId:1,sectionId:10,session:'2026/2027',term:'2nd Term',startDate:'2026-12-20',endDate:'2027-03-20',createdBy:7}),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT');

    const schedule=await service.create('attendance_schedule',{schoolId:1,classId:100,session:'2026/2027',effectiveFrom:'2026-09-01',effectiveTo:'2026-12-31',weekdays:{monday:true,wednesday:true,friday:true},createdBy:7});
    assert.ok(schedule.id>0);
    const stored=await client.query('SELECT monday,wednesday,friday FROM class_attendance_schedules WHERE id=$1',[schedule.id]);
    assert.deepStrictEqual(stored.rows[0],{monday:true,wednesday:true,friday:true});
    await assert.rejects(()=>service.create('attendance_schedule',{schoolId:1,classId:100,session:'2026/2027',effectiveFrom:'2026-10-01',weekdays:{saturday:true},createdBy:7}),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT');
    await assert.rejects(()=>service.create('attendance_schedule',{schoolId:1,classId:200,session:'2026/2027',effectiveFrom:'2026-09-01',weekdays:{monday:true},createdBy:7}),/does not belong to this school/);

    const responsibility=await service.create('attendance_responsibility',{schoolId:1,classId:100,staffId:7,session:'2026/2027',effectiveFrom:'2026-09-01',createdBy:7});
    assert.ok(responsibility.id>0);
    const closure=await service.create('attendance_closure',{schoolId:1,scopeType:'section',sectionId:10,closureDate:'2026-12-25',reason:'Public holiday',sourceEventId:500,createdBy:7});
    assert.ok(closure.id>0);
    await service.cancelClosure(closure.id,1,7,'Closure entered in error');
    const cancelled=await client.query("SELECT status FROM class_attendance_closures WHERE id=$1",[closure.id]);
    assert.equal(cancelled.rows[0].status,'cancelled');

    await client.query(`CREATE FUNCTION fail_foundation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`);
    await client.query('CREATE TRIGGER reject_foundation_audit BEFORE INSERT ON attendance_foundation_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_foundation_audit()');
    await assert.rejects(()=>service.create('attendance_closure',{schoolId:1,scopeType:'school',closureDate:'2026-12-31',reason:'Year end',createdBy:7}));
    const rolledBack=await client.query("SELECT COUNT(*)::int AS n FROM class_attendance_closures WHERE closure_date='2026-12-31'");
    assert.equal(rolledBack.rows[0].n,0,'Business row must roll back when audit insert fails');
    console.log('[attendance-foundation-postgres-service] PostgreSQL transactions, overlap, tenant ownership, boolean schedules, closure cancellation and audit atomicity passed.');
  } finally {
    try{await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}
    finally{client.release();await pool.end();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
