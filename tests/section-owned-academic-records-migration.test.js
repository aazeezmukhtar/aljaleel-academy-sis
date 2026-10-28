'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const migrate = require('../migrations/sqlite/001_section_owned_academic_records');

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

const db = new Database(':memory:');
try {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE classes (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      term TEXT NOT NULL, session TEXT NOT NULL,
      ca1 REAL DEFAULT 0, ca2 REAL DEFAULT 0, exam REAL DEFAULT 0,
      total REAL, grade TEXT, teacher_remark TEXT, status TEXT DEFAULT 'draft',
      approved_by INTEGER REFERENCES staff(id),
      UNIQUE(student_id, subject_id, term, session)
    );
    CREATE TABLE affective_psychomotor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      trait_name TEXT NOT NULL, score INTEGER CHECK(score >= 1 AND score <= 5),
      term TEXT NOT NULL, session TEXT NOT NULL,
      UNIQUE(student_id, trait_name, term, session)
    );
    INSERT INTO students VALUES (1, 'Dual-enrolled student');
    INSERT INTO subjects VALUES (10, 'Mathematics');
    INSERT INTO classes VALUES (20, 'Academy Primary 2');
    INSERT INTO classes VALUES (30, 'Tahfeez R 2');
    INSERT INTO staff VALUES (7, 'Exam Officer');
    INSERT INTO results (id, student_id, subject_id, term, session, ca1, ca2, exam, total, grade, teacher_remark, status, approved_by)
      VALUES (101, 1, 10, 'First Term', '2026/2027', 10, 15, 50, 75, 'A', 'legacy mark', 'approved', 7);
    INSERT INTO affective_psychomotor (id, student_id, trait_name, score, term, session)
      VALUES (201, 1, 'Responsibility', 4, 'First Term', '2026/2027');
  `);

  migrate(db);

  assert(hasColumn(db, 'results', 'class_id'), 'results should gain class_id');
  assert(hasColumn(db, 'affective_psychomotor', 'class_id'), 'traits should gain class_id');

  const legacyResult = db.prepare('SELECT * FROM results WHERE id = 101').get();
  assert.strictEqual(legacyResult.class_id, null, 'legacy result ownership must remain unresolved');
  assert.strictEqual(legacyResult.total, 75);
  assert.strictEqual(legacyResult.status, 'approved');
  assert.strictEqual(legacyResult.approved_by, 7);

  const legacyTrait = db.prepare('SELECT * FROM affective_psychomotor WHERE id = 201').get();
  assert.strictEqual(legacyTrait.class_id, null, 'legacy trait ownership must remain unresolved');
  assert.strictEqual(legacyTrait.score, 4);

  db.prepare('INSERT INTO results (student_id, subject_id, class_id, term, session, total) VALUES (?, ?, ?, ?, ?, ?)').run(1, 10, 20, 'First Term', '2026/2027', 45);
  db.prepare('INSERT INTO results (student_id, subject_id, class_id, term, session, total) VALUES (?, ?, ?, ?, ?, ?)').run(1, 10, 30, 'First Term', '2026/2027', 92);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM results WHERE student_id=1 AND subject_id=10 AND class_id IS NOT NULL').get().n, 2,
    'same student and subject must support independent class-owned marks');

  db.prepare('INSERT INTO affective_psychomotor (student_id, class_id, trait_name, score, term, session) VALUES (?, ?, ?, ?, ?, ?)').run(1, 20, 'Responsibility', 2, 'First Term', '2026/2027');
  db.prepare('INSERT INTO affective_psychomotor (student_id, class_id, trait_name, score, term, session) VALUES (?, ?, ?, ?, ?, ?)').run(1, 30, 'Responsibility', 5, 'First Term', '2026/2027');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM affective_psychomotor WHERE student_id=1 AND trait_name='Responsibility' AND class_id IS NOT NULL').get().n, 2,
    'same trait must support independent class-owned assessments');

  migrate(db);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM results').get().n, 3, 'rerunning migration must not drop result rows');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM affective_psychomotor').get().n, 3, 'rerunning migration must not drop trait rows');

  console.log('PASS: section-owned SQLite migration preserves legacy rows and permits independent section records');
} finally {
  db.close();
}
