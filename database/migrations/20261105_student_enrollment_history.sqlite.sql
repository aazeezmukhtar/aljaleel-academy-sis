-- AcadMe student enrollment history foundation (SQLite)
-- Additive migration. Does not alter or delete existing enrollment rows.
-- Run explicitly against a verified backup / disposable database first.

CREATE TABLE IF NOT EXISTS student_enrollment_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL REFERENCES schools(id),
    student_id INTEGER NOT NULL REFERENCES students(id),
    section_id INTEGER REFERENCES sections(id),
    source_class_id INTEGER REFERENCES classes(id),
    destination_class_id INTEGER REFERENCES classes(id),
    source_session TEXT,
    destination_session TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'admission',
        'internal_transfer',
        'promotion',
        'repetition',
        'correction',
        'section_exit',
        'external_transfer',
        'graduation',
        'legacy_baseline'
    )),
    effective_date DATE,
    reason TEXT,
    destination_school TEXT,
    recorded_by INTEGER REFERENCES staff(id),
    source_enrollment_id INTEGER UNIQUE REFERENCES student_enrollments(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (source_class_id IS NOT NULL OR destination_class_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_student_enrollment_history_student
    ON student_enrollment_history (school_id, student_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_student_enrollment_history_section
    ON student_enrollment_history (school_id, student_id, section_id, created_at, id);

-- Import a baseline for each existing assignment. Dates are intentionally NULL:
-- the current enrollment table does not establish when the placement began.
-- source_enrollment_id + UNIQUE makes this import safe to rerun.
INSERT INTO student_enrollment_history (
    school_id,
    student_id,
    section_id,
    destination_class_id,
    destination_session,
    event_type,
    effective_date,
    reason,
    source_enrollment_id
)
SELECT
    s.school_id,
    se.student_id,
    c.section_id,
    se.class_id,
    se.session,
    'legacy_baseline',
    NULL,
    'Imported from existing enrollment; original placement date is unknown.',
    se.id
FROM student_enrollments se
JOIN students s ON s.id = se.student_id
JOIN classes c ON c.id = se.class_id
WHERE s.school_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM student_enrollment_history h
      WHERE h.source_enrollment_id = se.id
  );
