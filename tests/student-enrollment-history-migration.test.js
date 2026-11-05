'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const migrationPath = path.join(__dirname, '..', 'database', 'migrations',
  '20261105_student_enrollment_history.sqlite.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const db = new Database(':memory:');

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE schools (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE sections (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE students (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL
    );
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id),
      section_id INTEGER REFERENCES sections(id),
      name TEXT NOT NULL
    );
    CREATE TABLE student_enrollments (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      class_id INTEGER NOT NULL REFERENCES classes(id),
      session TEXT NOT NULL,
      UNIQUE(student_id, class_id, session)
    );
  `);

  db.transaction(() => {
    db.prepare('INSERT INTO schools (id, name) VALUES (1, ?)').run('Test School');
    db.prepare('INSERT INTO sections (id, name) VALUES (10, ?)').run('Academy');
    db.prepare('INSERT INTO sections (id, name) VALUES (20, ?)').run('Tahfeez');
    db.prepare('INSERT INTO students (id, school_id, name) VALUES (100, 1, ?)').run('Student One');
    db.prepare('INSERT INTO classes (id, school_id, section_id, name) VALUES (1000, 1, 10, ?)').run('Primary 2');
    db.prepare('INSERT INTO classes (id, school_id, section_id, name) VALUES (2000, 1, 20, ?)').run('Tahfeez 1');
    db.prepare('INSERT INTO student_enrollments (id, student_id, class_id, session) VALUES (5000, 100, 1000, ?)').run('2025/2026');
    db.prepare('INSERT INTO student_enrollments (id, student_id, class_id, session) VALUES (5001, 100, 2000, ?)').run('2025/2026');
  })();

  const before = db.prepare('SELECT * FROM student_enrollments ORDER BY id').all();
  db.exec(migration);

  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'student_enrollment_history'"
  ).get();
  assert.ok(tableExists, 'History table should be created');

  const history = db.prepare(
    'SELECT * FROM student_enrollment_history ORDER BY source_enrollment_id'
  ).all();
  assert.strictEqual(history.length, 2, 'Every existing enrollment should receive one baseline');
  assert.deepStrictEqual(history.map(row => row.event_type), ['legacy_baseline', 'legacy_baseline']);
  assert.deepStrictEqual(history.map(row => row.effective_date), [null, null]);
  assert.deepStrictEqual(history.map(row => row.source_enrollment_id), [5000, 5001]);
  assert.deepStrictEqual(history.map(row => row.section_id), [10, 20]);
  assert.deepStrictEqual(db.prepare('SELECT * FROM student_enrollments ORDER BY id').all(), before,
    'Migration must not modify existing enrollment assignments');

  const sourceForeignKeys = db.prepare('PRAGMA foreign_key_list(student_enrollment_history)').all()
    .filter(row => row.from === 'source_enrollment_id');
  assert.strictEqual(sourceForeignKeys.length, 0,
    'source_enrollment_id must remain a historical scalar reference, not a foreign key');

  // Same-session movement removes the mutable assignment row. The baseline
  // history entry must survive and must not block that operation.
  db.prepare('DELETE FROM student_enrollments WHERE id = 5000').run();
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM student_enrollment_history WHERE source_enrollment_id = 5000').get().count,
    1,
    'Deleting a replaced assignment must preserve its baseline history'
  );

  db.exec(migration);
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS count FROM student_enrollment_history').get().count,
    2,
    'Rerunning migration must not duplicate legacy baselines'
  );

  assert.throws(() => db.prepare(`
    INSERT INTO student_enrollment_history (
      school_id, student_id, destination_class_id, destination_session,
      event_type, source_enrollment_id
    ) VALUES (1, 100, 1000, '2025/2026', 'invalid_event', NULL)
  `).run(), /CHECK constraint failed/, 'Unknown event types must be rejected');

  assert.throws(() => db.prepare(`
    INSERT INTO student_enrollment_history (
      school_id, student_id, destination_class_id, destination_session,
      event_type, source_enrollment_id
    ) VALUES (1, 100, 1000, '2025/2026', 'legacy_baseline', 5001)
  `).run(), /UNIQUE constraint failed/, 'A source enrollment must not be imported twice');

  console.log('[test-enrollment-history] migration, provenance deletion, idempotency and preservation checks passed.');
} finally {
  db.close();
}
