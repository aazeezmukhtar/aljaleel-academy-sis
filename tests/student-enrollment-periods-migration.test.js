'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const migrationPath = path.join(__dirname, '..', 'database', 'migrations',
  '20261117_student_enrollment_periods.sqlite.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const db = new Database(':memory:');

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schools (id INTEGER PRIMARY KEY);
    CREATE TABLE sections (id INTEGER PRIMARY KEY);
    CREATE TABLE staff (id INTEGER PRIMARY KEY);
    CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
    CREATE TABLE classes (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
    CREATE TABLE student_enrollment_history (id INTEGER PRIMARY KEY);
  `);

  db.exec(migration);
  const columns = db.prepare('PRAGMA table_info(student_enrollment_periods)').all();
  const names = new Set(columns.map(column => column.name));
  for (const required of [
    'school_id', 'student_id', 'section_id', 'class_id', 'session',
    'start_date', 'end_date', 'start_event_id', 'end_event_id',
    'date_status', 'created_at', 'updated_at'
  ]) assert.ok(names.has(required), 'Missing period column: ' + required);

  db.prepare('INSERT INTO schools (id) VALUES (1)').run();
  db.prepare('INSERT INTO sections (id) VALUES (10)').run();
  db.prepare('INSERT INTO students (id, school_id) VALUES (100, 1)').run();
  db.prepare('INSERT INTO classes (id, school_id) VALUES (1000, 1)').run();
  db.prepare('INSERT INTO student_enrollment_history (id) VALUES (700)').run();

  const insert = db.prepare(`
    INSERT INTO student_enrollment_periods
      (school_id, student_id, section_id, class_id, session, start_date, start_event_id)
    VALUES (1, 100, 10, 1000, '2026/2027', '2026-09-01', 700)
  `);
  insert.run();

  const period = db.prepare('SELECT * FROM student_enrollment_periods').get();
  assert.strictEqual(period.end_date, null, 'New placement should be open by default');
  assert.strictEqual(period.date_status, 'confirmed');

  assert.throws(() => db.prepare(`
    INSERT INTO student_enrollment_periods
      (school_id, student_id, section_id, class_id, session, start_date, end_date)
    VALUES (1, 100, 10, 1000, '2026/2027', '2026-09-10', '2026-09-09')
  `).run(), /CHECK constraint failed/, 'End date must not precede start date');

  assert.throws(() => db.prepare(`
    INSERT INTO student_enrollment_periods
      (school_id, student_id, section_id, class_id, session, start_date, date_status)
    VALUES (1, 100, 10, 1000, '2026/2027', '2026-09-01', 'unverified')
  `).run(), /CHECK constraint failed/, 'Only supported date statuses are accepted');

  db.exec(migration);
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM student_enrollment_periods').get().count,
    1,
    'Rerunning the additive schema migration must preserve existing periods'
  );

  console.log('[test-enrollment-periods-migration] schema, constraints and idempotency checks passed.');
} finally {
  db.close();
}
