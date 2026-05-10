Found tables: settings, classes, sqlite_sequence, arms, subjects, fee_categories, student_fees, payments, affective_psychomotor, attendance, staff, class_assignments, audit_logs, student_health, sessions, grading_systems, result_config, subject_assignments, staff_attendance, announcements, gallery_images, public_pages, class_posts, notification_reads, term_events, students, results

-- SCHEMA FOR settings --
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- SCHEMA FOR classes --
CREATE TABLE classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE -- e.g., Grade 10, JSS 1
, form_teacher_id INTEGER REFERENCES staff(id));

-- SCHEMA FOR arms --
CREATE TABLE arms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, -- e.g., Gold, Blue, A
    class_id INTEGER,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

-- SCHEMA FOR subjects --
CREATE TABLE subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT -- e.g., ENG101
);

-- SCHEMA FOR fee_categories --
CREATE TABLE fee_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    class_id INTEGER NOT NULL, -- Apply to specific class, or 0 for all classes
    session TEXT NOT NULL,
    term TEXT NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id)
);

-- SCHEMA FOR student_fees --
CREATE TABLE student_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    fee_category_id INTEGER NOT NULL,
    status TEXT CHECK(status IN ('Unpaid', 'Partial', 'Paid')) DEFAULT 'Unpaid',
    total_amount REAL NOT NULL,
    paid_amount REAL DEFAULT 0,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (fee_category_id) REFERENCES fee_categories(id),
    UNIQUE(student_id, fee_category_id)
);

-- SCHEMA FOR payments --
CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    student_fee_id INTEGER NOT NULL,
    amount_paid REAL NOT NULL,
    payment_method TEXT,
    payment_date DATE DEFAULT (DATE('now')),
    receipt_number TEXT UNIQUE,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (student_fee_id) REFERENCES student_fees(id)
);

-- SCHEMA FOR affective_psychomotor --
CREATE TABLE affective_psychomotor (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            trait_name TEXT NOT NULL,
            score INTEGER CHECK(score >= 1 AND score <= 5),
            term TEXT NOT NULL,
            session TEXT NOT NULL,
            FOREIGN KEY (student_id) REFERENCES students(id),
            UNIQUE(student_id, trait_name, term, session)
        );

-- SCHEMA FOR attendance --
CREATE TABLE attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            class_id INTEGER NOT NULL,
            arm_id INTEGER,
            status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL,
            date DATE NOT NULL,
            session TEXT NOT NULL,
            term TEXT NOT NULL,
            UNIQUE(student_id, date, session, term)
        );

-- SCHEMA FOR staff --
CREATE TABLE staff (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id TEXT UNIQUE NOT NULL, -- Mandatory Login ID
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT CHECK(role IN ('Admin', 'Teacher', 'Staff')) NOT NULL DEFAULT 'Staff',
                designation TEXT,
                status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            , email TEXT, passport_photo_path TEXT, show_on_website INTEGER DEFAULT 0, public_bio TEXT, avatar_image TEXT);

-- SCHEMA FOR class_assignments --
CREATE TABLE class_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id INTEGER NOT NULL,
                class_id INTEGER NOT NULL,
                arm_id INTEGER, -- Optional, if null, means all arms of that class
                session TEXT NOT NULL,
                FOREIGN KEY (staff_id) REFERENCES staff(id),
                FOREIGN KEY (class_id) REFERENCES classes(id),
                FOREIGN KEY (arm_id) REFERENCES arms(id),
                UNIQUE(staff_id, class_id, arm_id, session)
            );

-- SCHEMA FOR audit_logs --
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SCHEMA FOR student_health --
CREATE TABLE student_health (
    student_id INTEGER PRIMARY KEY,
    blood_group TEXT,
    genotype TEXT,
    allergies TEXT,
    medical_conditions TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    FOREIGN KEY (student_id) REFERENCES students(id)
);

-- SCHEMA FOR sessions --
CREATE TABLE sessions (sid PRIMARY KEY, expired, sess);

-- SCHEMA FOR grading_systems --
CREATE TABLE grading_systems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            min_score REAL NOT NULL,
            max_score REAL NOT NULL,
            grade TEXT NOT NULL,
            remark TEXT NOT NULL,
            CHECK(min_score >= 0 AND max_score <= 100 AND min_score <= max_score)
        );

-- SCHEMA FOR result_config --
CREATE TABLE result_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

-- SCHEMA FOR subject_assignments --
CREATE TABLE "subject_assignments" (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, subject_id INTEGER NOT NULL, class_id INTEGER NOT NULL, session TEXT NOT NULL, FOREIGN KEY (teacher_id) REFERENCES staff(id), FOREIGN KEY (subject_id) REFERENCES subjects(id), FOREIGN KEY (class_id) REFERENCES classes(id), UNIQUE(teacher_id, subject_id, class_id, session));

-- SCHEMA FOR staff_attendance --
CREATE TABLE "staff_attendance" (id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL, date DATE NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL, FOREIGN KEY (teacher_id) REFERENCES staff(id), UNIQUE(teacher_id, date, session, term));

-- SCHEMA FOR announcements --
CREATE TABLE "announcements" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            content TEXT,
            image_path TEXT,
            is_published INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        , target_role TEXT DEFAULT 'All', type TEXT DEFAULT 'Announcement', event_date DATETIME);

-- SCHEMA FOR gallery_images --
CREATE TABLE gallery_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            image_path TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

-- SCHEMA FOR public_pages --
CREATE TABLE public_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

-- SCHEMA FOR class_posts --
CREATE TABLE class_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_id INTEGER NOT NULL,
            teacher_id INTEGER NOT NULL,
            post_type TEXT CHECK(post_type IN ('Announcement', 'Assignment')) NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            due_date DATE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, subject_id INTEGER REFERENCES subjects(id), attachment_path TEXT, student_id INTEGER REFERENCES students(id),
            FOREIGN KEY (class_id) REFERENCES classes(id),
            FOREIGN KEY (teacher_id) REFERENCES staff(id)
        );

-- SCHEMA FOR notification_reads --
CREATE TABLE notification_reads (user_id INTEGER NOT NULL, user_type TEXT NOT NULL, source_id INTEGER NOT NULL, source_type TEXT NOT NULL, read_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, user_type, source_id, source_type));

-- SCHEMA FOR term_events --
CREATE TABLE term_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            event_date DATE NOT NULL,
            session TEXT,
            term TEXT,
            type TEXT CHECK(type IN ('Announcement', 'Exam', 'Holiday', 'Deadline')) DEFAULT 'Announcement',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

-- SCHEMA FOR students --
CREATE TABLE "students" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                gender TEXT NOT NULL,
                dob DATE,
                admission_number TEXT UNIQUE,
                passport_photo_path TEXT,
                admission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                current_class_id INTEGER,
                current_arm_id INTEGER,
                status TEXT DEFAULT 'active',
                parent_phone TEXT,
                parent_address TEXT,
                password TEXT,
                FOREIGN KEY (current_class_id) REFERENCES classes(id)
            );

-- SCHEMA FOR results --
CREATE TABLE "results" (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            subject_id INTEGER NOT NULL,
            term TEXT NOT NULL,
            session TEXT NOT NULL,
            ca1 REAL DEFAULT 0,
            ca2 REAL DEFAULT 0,
            exam REAL DEFAULT 0,
            total REAL,
            grade TEXT,
            teacher_remark TEXT,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'locked', 'published')),
            approved_by INTEGER,
            FOREIGN KEY (student_id) REFERENCES students(id),
            FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
