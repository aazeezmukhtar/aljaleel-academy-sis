-- Additive staff information foundation. Manual migration only; never run at startup.
CREATE TABLE IF NOT EXISTS staff_personal_details (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL,
    staff_id INTEGER NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
    date_of_birth DATE,
    gender TEXT,
    phone TEXT,
    alternate_phone TEXT,
    personal_email TEXT,
    residential_address TEXT,
    nationality TEXT,
    marital_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_personal_details_school ON staff_personal_details(school_id, staff_id);

CREATE TABLE IF NOT EXISTS staff_employment_details (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL,
    staff_id INTEGER NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
    department TEXT,
    employment_type TEXT,
    employment_start_date DATE,
    employment_end_date DATE,
    work_email TEXT,
    work_phone TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (employment_end_date IS NULL OR employment_start_date IS NULL OR employment_end_date >= employment_start_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_employment_details_school ON staff_employment_details(school_id, staff_id);

CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    relationship TEXT,
    phone TEXT NOT NULL,
    alternate_phone TEXT,
    email TEXT,
    address TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_emergency_contacts_staff ON staff_emergency_contacts(school_id, staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_emergency_contact_primary
    ON staff_emergency_contacts(staff_id) WHERE is_primary = TRUE;

CREATE TABLE IF NOT EXISTS staff_qualifications (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    qualification TEXT NOT NULL,
    field_of_study TEXT,
    institution TEXT,
    award_year INTEGER,
    certificate_reference TEXT,
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    verified_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (award_year IS NULL OR award_year BETWEEN 1900 AND 2200),
    CHECK ((verification_status = 'verified' AND verified_at IS NOT NULL) OR verification_status <> 'verified')
);
CREATE INDEX IF NOT EXISTS idx_staff_qualifications_staff ON staff_qualifications(school_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_qualifications_verification ON staff_qualifications(school_id, verification_status);
