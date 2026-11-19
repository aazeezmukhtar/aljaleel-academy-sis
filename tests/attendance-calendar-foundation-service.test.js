'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(`
  CREATE TABLE schools(id INTEGER PRIMARY KEY);
  CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
  CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER NOT NULL REFERENCES sections(id));
  CREATE TABLE term_events(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER, event_date DATE NOT NULL);
  INSERT INTO schools VALUES (1),(2);
  INSERT INTO sections VALUES (10,1),(20,2);
  INSERT INTO staff VALUES (7,1),(8,2);
  INSERT INTO classes VALUES (100,1,10),(200,2,20);
  INSERT INTO term_events VALUES (500,1,10,'2026-12-25');
`);
const migration = fs.readFileSync(path.join(__dirname,'..','database','migrations','20261119_attendance_calendar_foundation.sqlite.sql'),'utf8');
sqlite.exec(migration);

const fakeDb = {
  DB_TYPE: 'sqlite',
  get: async (sql, params = []) => sqlite.prepare(sql).get(params),
  all: async (sql, params = []) => sqlite.prepare(sql).all(params),
  run: async (sql, params = []) => { const r=sqlite.prepare(sql).run(params); return {changes:r.changes,lastInsertRowid:r.lastInsertRowid}; },
  transaction: async callback => {
    sqlite.exec('BEGIN');
    try { const value=await callback(null); sqlite.exec('COMMIT'); return value; }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  },
  transactionImmediate: async callback => {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const value=await callback(null); sqlite.exec('COMMIT'); return value; }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  }
};
const dbPath=require.resolve('../utils/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fakeDb};
const service=require('../services/attendanceFoundationService');

(async()=>{
  try {
    const period=await service.create('academic_period',{
      schoolId:1,sectionId:10,session:'2026/2027',term:'1st Term',
      startDate:'2026-09-01',endDate:'2026-12-20',createdBy:7
    });
    assert.ok(period.id>0);
    await assert.rejects(()=>service.create('academic_period',{
      schoolId:1,sectionId:10,session:'2026/2027',term:'2nd Term',
      startDate:'2026-12-20',endDate:'2027-03-20',createdBy:7
    }),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT','Inclusive same-day term overlap must fail');
    const adjacent=await service.create('academic_period',{
      schoolId:1,sectionId:10,session:'2026/2027',term:'2nd Term',
      startDate:'2026-12-21',endDate:'2027-03-20',createdBy:7
    });
    assert.ok(adjacent.id>0);

    const schedule=await service.create('attendance_schedule',{
      schoolId:1,classId:100,session:'2026/2027',
      effectiveFrom:'2026-09-01',effectiveTo:null,
      weekdays:{monday:true,tuesday:true,wednesday:true,thursday:true,friday:true},createdBy:7
    });
    assert.ok(schedule.id>0);
    await assert.rejects(()=>service.create('attendance_schedule',{
      schoolId:1,classId:100,session:'2026/2027',
      effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',
      weekdays:{saturday:true},createdBy:7
    }),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT','Overlapping schedule must fail');
    await assert.rejects(()=>service.create('attendance_schedule',{
      schoolId:1,classId:200,session:'2026/2027',
      effectiveFrom:'2026-09-01',effectiveTo:null,
      weekdays:{monday:true},createdBy:7
    }),/does not belong to this school/,'Cross-school class must fail');

    const nextSchedule=await service.create('attendance_schedule',{\n      schoolId:1,classId:100,session:'2026/2027',\n      effectiveFrom:'2027-01-01',effectiveTo:null,weekdays:{saturday:true},createdBy:7\n    });\n    assert.ok(nextSchedule.id>0);\n\n    const responsibility=await service.create('attendance_responsibility',{
      schoolId:1,classId:100,staffId:7,session:'2026/2027',
      effectiveFrom:'2026-09-01',effectiveTo:null,createdBy:7
    });
    assert.ok(responsibility.id>0);
    await assert.rejects(()=>service.create('attendance_responsibility',{
      schoolId:1,classId:100,staffId:8,session:'2026/2027',
      effectiveFrom:'2026-10-01',effectiveTo:null,createdBy:7
    }),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT','Overlapping responsibility must fail');

    const closure=await service.create('attendance_closure',{
      schoolId:1,scopeType:'section',sectionId:10,closureDate:'2026-12-25',
      reason:'Public holiday',sourceEventId:500,createdBy:7
    });
    assert.ok(closure.id>0);
    await assert.rejects(()=>service.create('attendance_closure',{
      schoolId:1,scopeType:'section',sectionId:10,closureDate:'2026-12-25',
      reason:'Duplicate closure',createdBy:7
    }),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT');
    await assert.rejects(()=>service.create('attendance_closure',{
      schoolId:1,scopeType:'section',sectionId:20,closureDate:'2026-12-26',
      reason:'Cross-school section',createdBy:7
    }),/does not belong to this school/);
    await assert.rejects(()=>service.create('attendance_closure',{
      schoolId:1,scopeType:'section',sectionId:10,closureDate:'2026-12-26',
      reason:'Mismatched event date',sourceEventId:500,createdBy:7
    }),/event date must match/);

    const auditBefore=sqlite.prepare('SELECT COUNT(*) AS n FROM attendance_foundation_audit_logs').get().n;
    await assert.rejects(()=>service.correct('attendance_schedule',schedule.id,{
      effective_to:'2027-01-02'
    },'Move schedule earlier',7,1),e=>e.code==='ATTENDANCE_FOUNDATION_CONFLICT');
    assert.equal(sqlite.prepare('SELECT effective_from FROM class_attendance_schedules WHERE id=?').get(schedule.id).effective_from,'2026-09-01');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attendance_foundation_audit_logs').get().n,auditBefore,
      'Rejected correction must not append an audit event');

    await service.cancelClosure(closure.id,1,7,'Closure entered in error');
    assert.equal(sqlite.prepare('SELECT status FROM class_attendance_closures WHERE id=?').get(closure.id).status,'cancelled');

    sqlite.exec(`CREATE TRIGGER reject_foundation_audit BEFORE INSERT ON attendance_foundation_audit_logs
      BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;`);
    await assert.rejects(()=>service.create('attendance_closure',{
      schoolId:1,scopeType:'school',closureDate:'2026-12-31',
      reason:'Year end',createdBy:7
    }));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM class_attendance_closures WHERE closure_date='2026-12-31'").get().n,0,
      'Business write must roll back if its audit append fails');

    const resolved=await service.getResponsibleStaff({
      schoolId:1,classId:100,session:'2026/2027',onDate:'2026-11-01'
    });
    assert.equal(Number(resolved.staff_id),7);
    assert.deepStrictEqual(sqlite.pragma('foreign_key_check'),[]);
    console.log('[attendance-foundation-service] create, overlap, adjacency, tenant ownership, correction rollback, closure cancellation, audit atomicity and responsibility lookup passed.');
  } finally { sqlite.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
