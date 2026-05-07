-- PostgreSQL Session table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    staff_id TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('Admin', 'Teacher', 'Staff')) NOT NULL DEFAULT 'Staff',
    designation TEXT,
    status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    email TEXT,
    passport_photo_path TEXT,
    show_on_website INTEGER DEFAULT 0,
    public_bio TEXT,
    avatar_image TEXT
);

CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    form_teacher_id INTEGER REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS arms (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    class_id INTEGER REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    dob DATE,
    admission_number TEXT UNIQUE,
    passport_photo_path TEXT,
    admission_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_class_id INTEGER REFERENCES classes(id),
    current_arm_id INTEGER REFERENCES arms(id),
    status TEXT DEFAULT 'active',
    parent_phone TEXT,
    parent_address TEXT,
    password TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT
);

CREATE TABLE IF NOT EXISTS fee_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    class_id INTEGER NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS student_fees (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    fee_category_id INTEGER NOT NULL REFERENCES fee_categories(id),
    status TEXT CHECK(status IN ('Unpaid', 'Partial', 'Paid')) DEFAULT 'Unpaid',
    total_amount DOUBLE PRECISION NOT NULL,
    paid_amount DOUBLE PRECISION DEFAULT 0,
    UNIQUE(student_id, fee_category_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    student_fee_id INTEGER NOT NULL REFERENCES student_fees(id),
    amount_paid DOUBLE PRECISION NOT NULL,
    payment_method TEXT,
    payment_date DATE DEFAULT CURRENT_DATE,
    receipt_number TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS affective_psychomotor (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    trait_name TEXT NOT NULL,
    score INTEGER CHECK(score >= 1 AND score <= 5),
    term TEXT NOT NULL,
    session TEXT NOT NULL,
    UNIQUE(student_id, trait_name, term, session)
);

CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    arm_id INTEGER REFERENCES arms(id),
    status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL,
    date DATE NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    UNIQUE(student_id, date, session, term)
);

CREATE TABLE IF NOT EXISTS class_assignments (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    arm_id INTEGER REFERENCES arms(id),
    session TEXT NOT NULL,
    UNIQUE(staff_id, class_id, arm_id, session)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_health (
    student_id INTEGER PRIMARY KEY REFERENCES students(id),
    blood_group TEXT,
    genotype TEXT,
    allergies TEXT,
    medical_conditions TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT
);

CREATE TABLE IF NOT EXISTS grading_systems (
    id SERIAL PRIMARY KEY,
    min_score DOUBLE PRECISION NOT NULL,
    max_score DOUBLE PRECISION NOT NULL,
    grade TEXT NOT NULL,
    remark TEXT NOT NULL,
    CHECK(min_score >= 0 AND max_score <= 100 AND min_score <= max_score)
);

CREATE TABLE IF NOT EXISTS result_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subject_assignments (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    session TEXT NOT NULL,
    UNIQUE(teacher_id, subject_id, class_id, session)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL,
    date DATE NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    UNIQUE(teacher_id, date, session, term)
);

CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT,
    image_path TEXT,
    is_published INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    target_role TEXT DEFAULT 'All',
    type TEXT DEFAULT 'Announcement',
    event_date TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery_images (
    id SERIAL PRIMARY KEY,
    title TEXT,
    image_path TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_pages (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS class_posts (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    post_type TEXT CHECK(post_type IN ('Announcement', 'Assignment')) NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subject_id INTEGER REFERENCES subjects(id),
    attachment_path TEXT,
    student_id INTEGER REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS notification_reads (
    user_id INTEGER NOT NULL,
    user_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, user_type, source_id, source_type)
);

CREATE TABLE IF NOT EXISTS term_events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    session TEXT,
    term TEXT,
    type TEXT CHECK(type IN ('Announcement', 'Exam', 'Holiday', 'Deadline')) DEFAULT 'Announcement',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    term TEXT NOT NULL,
    session TEXT NOT NULL,
    ca1 DOUBLE PRECISION DEFAULT 0,
    ca2 DOUBLE PRECISION DEFAULT 0,
    exam DOUBLE PRECISION DEFAULT 0,
    total DOUBLE PRECISION,
    grade TEXT,
    teacher_remark TEXT,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'locked', 'published')),
    approved_by INTEGER,
    UNIQUE(student_id, subject_id, term, session)
);

CREATE INDEX IF NOT EXISTS idx_payment_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance(class_id, arm_id, date);
CREATE INDEX IF NOT EXISTS idx_result_lookup ON results(student_id, session, term);
