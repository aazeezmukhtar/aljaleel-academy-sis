-- AcadMe staff profile data foundation (PostgreSQL 17+)
-- Additive/manual only. Existing staff accounts and rows are not modified.
-- All profile attributes are nullable; only row identity and staff ownership are required.
-- Never run automatically at application startup. Production execution requires separate approval.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_personal_details (
    staff_id BIGINT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    date_of_birth DATE,
    gender TEXT,
    phone TEXT,
    residential_address TEXT,
    state_of_origin TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staff_employment_details (
    staff_id BIGINT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    department TEXT,
    employment_type TEXT,
    date_employed DATE,
    employment_status TEXT,
    supervisor_staff_id BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staff_qualifications (
    id BIGSERIAL PRIMARY KEY,
    staff_id BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    qualification TEXT,
    institution TEXT,
    course_of_study TEXT,
    certificate_reference TEXT,
    teaching_specialisation TEXT,
    verification_status TEXT CHECK (verification_status IS NULL OR verification_status IN ('pending', 'verified', 'rejected')),
    verified_by BIGINT REFERENCES staff(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
    id BIGSERIAL PRIMARY KEY,
    staff_id BIGINT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    contact_name TEXT,
    relationship TEXT,
    phone TEXT,
    alternate_phone TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_qualifications_staff
    ON staff_qualifications (staff_id, id);
CREATE INDEX IF NOT EXISTS idx_staff_emergency_contacts_staff
    ON staff_emergency_contacts (staff_id, id);

COMMIT;
