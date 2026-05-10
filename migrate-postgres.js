const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const schema = `
-- 1. Classes
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    form_teacher_id INTEGER
);

-- 2. Arms
CREATE TABLE IF NOT EXISTS arms (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    class_id INTEGER REFERENCES classes(id)
);

-- 3. Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT
);

-- 4. Staff
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    staff_id TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Staff',
    designation TEXT,
    status TEXT DEFAULT 'active',
    email TEXT,
    passport_photo_path TEXT,
    show_on_website INTEGER DEFAULT 0,
    public_bio TEXT,
    avatar_image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT staff_role_check CHECK (role IN ('Admin', 'Teacher', 'Staff')),
    CONSTRAINT staff_status_check CHECK (status IN ('active', 'inactive'))
);

-- Update classes with form_teacher_id reference
ALTER TABLE classes ADD CONSTRAINT classes_form_teacher_id_fkey FOREIGN KEY (form_teacher_id) REFERENCES staff(id);

-- 5. Students
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

-- 6. Attendance
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    arm_id INTEGER REFERENCES arms(id),
    status TEXT NOT NULL,
    date DATE NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    CONSTRAINT attendance_status_check CHECK (status IN ('Present', 'Absent', 'Late', 'Leave')),
    UNIQUE(student_id, date, session, term)
);

-- 7. Results
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
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
    CONSTRAINT results_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'locked', 'published'))
);

-- 8. Fee Categories
CREATE TABLE IF NOT EXISTS fee_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    session TEXT NOT NULL,
    term TEXT NOT NULL
);

-- 9. Student Fees
CREATE TABLE IF NOT EXISTS student_fees (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    fee_category_id INTEGER NOT NULL REFERENCES fee_categories(id),
    status TEXT DEFAULT 'Unpaid',
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    CONSTRAINT student_fees_status_check CHECK (status IN ('Unpaid', 'Partial', 'Paid')),
    UNIQUE(student_id, fee_category_id)
);

-- 10. Payments
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    student_fee_id INTEGER NOT NULL REFERENCES student_fees(id),
    amount_paid REAL NOT NULL,
    payment_method TEXT,
    payment_date DATE DEFAULT CURRENT_DATE,
    receipt_number TEXT UNIQUE
);

-- 11. Affective & Psychomotor
CREATE TABLE IF NOT EXISTS affective_psychomotor (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id),
    trait_name TEXT NOT NULL,
    score INTEGER,
    term TEXT NOT NULL,
    session TEXT NOT NULL,
    CONSTRAINT affective_score_check CHECK (score >= 1 AND score <= 5),
    UNIQUE(student_id, trait_name, term, session)
);

-- 12. Class Assignments
CREATE TABLE IF NOT EXISTS class_assignments (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    arm_id INTEGER REFERENCES arms(id),
    session TEXT NOT NULL,
    UNIQUE(staff_id, class_id, arm_id, session)
);

-- 13. Subject Assignments
CREATE TABLE IF NOT EXISTS subject_assignments (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    session TEXT NOT NULL,
    UNIQUE(teacher_id, subject_id, class_id, session)
);

-- 14. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Student Health
CREATE TABLE IF NOT EXISTS student_health (
    student_id INTEGER PRIMARY KEY REFERENCES students(id),
    blood_group TEXT,
    genotype TEXT,
    allergies TEXT,
    medical_conditions TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT
);

-- 16. Staff Attendance
CREATE TABLE IF NOT EXISTS staff_attendance (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    status TEXT NOT NULL,
    date DATE NOT NULL,
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    CONSTRAINT staff_attendance_status_check CHECK (status IN ('Present', 'Absent', 'Late', 'Leave')),
    UNIQUE(teacher_id, date, session, term)
);

-- 17. Announcements
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    content TEXT,
    image_path TEXT,
    is_published INTEGER DEFAULT 0,
    target_role TEXT DEFAULT 'All',
    type TEXT DEFAULT 'Announcement',
    event_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 18. Gallery Images
CREATE TABLE IF NOT EXISTS gallery_images (
    id SERIAL PRIMARY KEY,
    title TEXT,
    image_path TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 19. Public Pages
CREATE TABLE IF NOT EXISTS public_pages (
    id SERIAL PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 20. Class Posts
CREATE TABLE IF NOT EXISTS class_posts (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    teacher_id INTEGER NOT NULL REFERENCES staff(id),
    post_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    due_date DATE,
    subject_id INTEGER REFERENCES subjects(id),
    attachment_path TEXT,
    student_id INTEGER REFERENCES students(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT class_post_type_check CHECK (post_type IN ('Announcement', 'Assignment'))
);

-- 21. Notification Reads
CREATE TABLE IF NOT EXISTS notification_reads (
    user_id INTEGER NOT NULL,
    user_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, user_type, source_id, source_type)
);

-- 22. Term Events
CREATE TABLE IF NOT EXISTS term_events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_date DATE NOT NULL,
    session TEXT,
    term TEXT,
    type TEXT DEFAULT 'Announcement',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT term_event_type_check CHECK (type IN ('Announcement', 'Exam', 'Holiday', 'Deadline'))
);

-- 23. Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 24. Result Config
CREATE TABLE IF NOT EXISTS result_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 25. Grading Systems
CREATE TABLE IF NOT EXISTS grading_systems (
    id SERIAL PRIMARY KEY,
    min_score REAL NOT NULL,
    max_score REAL NOT NULL,
    grade TEXT NOT NULL,
    remark TEXT NOT NULL,
    CONSTRAINT grading_score_check CHECK(min_score >= 0 AND max_score <= 100 AND min_score <= max_score)
);

-- Session table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
`;

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("Starting PostgreSQL migration...");
        await client.query(schema);
        console.log("Migration completed successfully.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
