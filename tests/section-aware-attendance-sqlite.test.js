'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(':memory:');
try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schools(id INTEGER PRIMARY KEY);
    CREATE TABLE sections(id INTEGER PRIMARY KEY);
    CREATE TABLE students(id INTEGER PRIMARY KEY, school_id INTEGER);
    CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER, section_id INTEGER REFERENCES sections(id));
    CREATE TABLE arms(id INTEGER PRIMARY KEY);
    CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      class_id INTEGER NOT NULL REFERENCES classes(id),
      arm_id INTEGER REFERENCES arms(id),
      status TEXT NOT NULL CHECK(status IN ('Present','Absent','Late','Leave')),
      date DATE NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL,
      reason TEXT, reason_type TEXT, custom_reason TEXT,
      UNIQUE(student_id, date, session, term)
    );
    INSERT INTO schools VALUES(1);
    INSERT INTO sections VALUES(1),(2);
    INSERT INTO students VALUES(10,1);
    INSERT INTO classes VALUES(100,1,1),(200,1,2);
    INSERT INTO arms VALUES(7);
    INSERT INTO attendance(id,student_id,class_id,arm_id,status,date,session,term,reason,reason_type,custom_reason)
      VALUES(5,10,100,7,'Present','2026-11-18','2026/2027','1st Term','',NULL,NULL);
  `);
  const sql = fs.readFileSync(path.join(__dirname,'..','database','migrations',
    '20261118_section_aware_attendance.sqlite.sql'),'utf8');
  db.exec(sql);
  const row = db.prepare('SELECT * FROM attendance WHERE id=5').get();
  assert.strictEqual(row.section_id,1);
  assert.strictEqual(row.arm_id,7);
  assert.strictEqual(row.status,'Present');
  assert.strictEqual(row.reason,'');
  db.prepare(`INSERT INTO attendance(student_id,class_id,section_id,status,date,session,term)
    VALUES(10,200,2,'Absent','2026-11-18','2026/2027','1st Term')`).run();
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,2);
  assert.throws(()=>db.prepare(`INSERT INTO attendance(student_id,class_id,section_id,status,date,session,term)
    VALUES(10,100,1,'Late','2026-11-18','2026/2027','1st Term')`).run(),/UNIQUE constraint failed/);
  assert.strictEqual(db.pragma('foreign_key_check').length,0);
  console.log('[attendance-sqlite] table rebuild, data preservation, arm_id, section uniqueness and FK checks passed.');
} finally { db.close(); }
