-- AcadMe staff profile data foundation (SQLite)
-- Additive/manual only. Existing staff accounts and rows are not modified.
-- All profile attributes are nullable; only row identity and staff ownership are required.
-- Never run automatically at application startup. Production execution requires separate approval.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff_personal_details (
    staff_id INTEGER PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    date_of_birth DATE,
    gender TEXT,
    phone TEXT,
    residential_address TEXT,
    state_of_origin TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_employment_details (
    staff_id INTEGER PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    department TEXT,
    employment_type TEXT,
    date_employed DATE,
    employment_status TEXT,
    supervisor_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_qualifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    qualification TEXT,
    institution TEXT,
    course_of_study TEXT,
    certificate_reference TEXT,
    teaching_specialisation TEXT,
    verification_status TEXT CHECK (verification_status IS NULL OR verification_status IN ('pending', 'verified', 'rejected')),
    verified_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    verified_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    contact_name TEXT,
    relationship TEXT,
    phone TEXT,
    alternate_phone TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_qualifications_staff
    ON staff_qualifications (staff_id, id);
CREATE INDEX IF NOT EXISTS idx_staff_emergency_contacts_staff
    ON staff_emergency_contacts (staff_id, id);
