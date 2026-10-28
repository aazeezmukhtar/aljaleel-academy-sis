'use strict';

// Explicit, opt-in SQLite migration. Never invoked automatically at application startup.
// Legacy rows retain NULL class_id until ownership is proven by a reviewed backfill.
module.exports = function migrateSectionOwnedRecords(db) {
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);

  const migrate = db.transaction(() => {
    if (!hasColumn('results', 'class_id')) {
      db.exec(`
        CREATE TABLE results_section_owned (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id),
          subject_id INTEGER NOT NULL REFERENCES subjects(id),
          class_id INTEGER REFERENCES classes(id),
          term TEXT NOT NULL,
          session TEXT NOT NULL,
          ca1 REAL DEFAULT 0,
          ca2 REAL DEFAULT 0,
          exam REAL DEFAULT 0,
          total REAL,
          grade TEXT,
          teacher_remark TEXT,
          status TEXT DEFAULT 'draft',
          approved_by INTEGER REFERENCES staff(id),
          UNIQUE(student_id, class_id, subject_id, term, session)
        );
        INSERT INTO results_section_owned
          (id, student_id, subject_id, term, session, ca1, ca2, exam, total, grade, teacher_remark, status, approved_by)
        SELECT id, student_id, subject_id, term, session, ca1, ca2, exam, total, grade, teacher_remark, status, approved_by
        FROM results;
        DROP TABLE results;
        ALTER TABLE results_section_owned RENAME TO results;
        CREATE INDEX IF NOT EXISTS idx_result_lookup
          ON results(student_id, session, term);
      `);
    }

    if (!hasColumn('affective_psychomotor', 'class_id')) {
      db.exec(`
        CREATE TABLE affective_psychomotor_section_owned (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id),
          class_id INTEGER REFERENCES classes(id),
          trait_name TEXT NOT NULL,
          score INTEGER CHECK(score >= 1 AND score <= 5),
          term TEXT NOT NULL,
          session TEXT NOT NULL,
          UNIQUE(student_id, class_id, trait_name, term, session)
        );
        INSERT INTO affective_psychomotor_section_owned
          (id, student_id, trait_name, score, term, session)
        SELECT id, student_id, trait_name, score, term, session
        FROM affective_psychomotor;
        DROP TABLE affective_psychomotor;
        ALTER TABLE affective_psychomotor_section_owned RENAME TO affective_psychomotor;
      `);
    }
  });

  migrate();
};
