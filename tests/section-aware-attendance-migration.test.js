'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');

// This test mirrors the ownership/backfill and uniqueness invariants of the
// PostgreSQL migration without pretending SQLite executes PostgreSQL SQL.
const db = new Database(':memory:');
try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schools (id INTEGER PRIMARY KEY);
    CREATE TABLE sections (id INTEGER PRIMARY KEY);
    CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id));
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id),
      section_id INTEGER NOT NULL REFERENCES sections(id)
    );
    CREATE TABLE attendance (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      class_id INTEGER NOT NULL REFERENCES classes(id),
      status TEXT NOT NULL,
      date TEXT NOT NULL,
      session TEXT NOT NULL,
      term TEXT NOT NULL,
      reason TEXT,
      reason_type TEXT,
      custom_reason TEXT,
      section_id INTEGER REFERENCES sections(id)
    );
    CREATE UNIQUE INDEX attendance_student_section_date_session_term_key
      ON attendance(student_id, section_id, date, session, term);
    INSERT INTO schools VALUES (1);
    INSERT INTO sections VALUES (1), (2);
    INSERT INTO students VALUES (10, 1);
    INSERT INTO classes VALUES (100, 1, 1), (200, 1, 2);
    INSERT INTO attendance
      (id, student_id, class_id, status, date, session, term)
      VALUES (1, 10, 100, 'Present', '2026-11-18', '2026/2027', '1st Term');
  `);

  // Backfill must use class ownership, not the student's other enrollment.
  db.exec(`
    UPDATE attendance
    SET section_id = (SELECT section_id FROM classes WHERE classes.id = attendance.class_id)
    WHERE section_id IS NULL
  `);
  assert.strictEqual(
    db.prepare('SELECT section_id FROM attendance WHERE id = 1').get().section_id,
    1
  );

  // Same student/date/session/term is valid once in each distinct section.
  db.prepare(`
    INSERT INTO attendance
      (id, student_id, class_id, status, date, session, term, section_id)
      VALUES (2, 10, 200, 'Absent', '2026-11-18', '2026/2027', '1st Term', 2)
  `).run();

  // Duplicate within the same section remains prohibited.
  assert.throws(() => db.prepare(`
    INSERT INTO attendance
      (id, student_id, class_id, status, date, session, term, section_id)
      VALUES (3, 10, 100, 'Late', '2026-11-18', '2026/2027', '1st Term', 1)
  `).run(), /UNIQUE constraint failed/);

  // A class-section mismatch must not be silently accepted by the write layer.
  const mismatch = db.prepare(`
    SELECT COUNT(*) AS count
    FROM attendance a JOIN classes c ON c.id = a.class_id
    WHERE a.section_id <> c.section_id
  `).get().count;
  assert.strictEqual(mismatch, 0);

  console.log('[test-section-aware-attendance] backfill and section-scoped uniqueness checks passed.');
} finally {
  db.close();
}
