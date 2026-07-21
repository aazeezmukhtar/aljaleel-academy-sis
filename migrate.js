const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'database.sqlite'));

try {
    // 1. Update Students Table (Parent info)
    // SQLite doesn't support adding columns with CHECK constraints easily, 
    // but we can add columns first.
    try {
        db.prepare("ALTER TABLE students ADD COLUMN parent_phone TEXT").run();
        db.prepare("ALTER TABLE students ADD COLUMN parent_address TEXT").run();
        console.log("Added parent columns to students table.");
    } catch (e) {
        if (e.message.includes("duplicate column name")) {
            console.log("Parent columns already exist.");
        } else {
            console.error("Error adding student columns:", e.message);
        }
    }

    // 2. Create Staff Attendance Table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS staff_attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL,
            status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL,
            date DATE NOT NULL,
            session TEXT NOT NULL,
            term TEXT NOT NULL,
            FOREIGN KEY (teacher_id) REFERENCES teachers(id),
            UNIQUE(teacher_id, date, session, term)
        )
    `).run();
    console.log("Created staff_attendance table.");

    // 3. Create Affective & Psychomotor Table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS affective_psychomotor (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            trait_name TEXT NOT NULL,
            score INTEGER CHECK(score >= 1 AND score <= 5),
            term TEXT NOT NULL,
            session TEXT NOT NULL,
            FOREIGN KEY (student_id) REFERENCES students(id),
            UNIQUE(student_id, trait_name, term, session)
        )
    `).run();
    console.log("Created affective_psychomotor table.");

    // 4. Update Settings
    const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    insertSetting.run('next_term_start_date', '2026-05-04');
    insertSetting.run('show_watermark', 'false');
    // Attendance threshold defaults
    insertSetting.run('attendance.term_absence_limit', '10');
    insertSetting.run('attendance.consecutive_absence_limit', '3');
    console.log("Updated settings.");

    // 5. Clean up Gender (Replace 'Other' with 'Male' to satisfy new constraint if we were to enforce it strictly)
    // For now, we just update the data.
    db.prepare("UPDATE students SET gender = 'Male' WHERE gender NOT IN ('Male', 'Female')").run();
    console.log("Sanitized gender data.");

    // 6. Fix Attendance Table Constraint (Include 'Leave')
    try {
        // We use a transaction and rollback to test the constraint without polluting data
        db.transaction(() => {
            db.prepare("INSERT INTO attendance (student_id, class_id, arm_id, status, date, session, term) VALUES (0, 0, NULL, 'Leave', '1900-01-01', 'Test', 'Test')").run();
            throw new Error("Rollback");
        })();
    } catch (e) {
        if (e.message.includes("CHECK constraint failed") || e.message.includes("NOT NULL constraint failed")) {
            console.log("Recreating attendance table to include 'Leave' status and nullable arm_id...");
            db.transaction(() => {
                db.prepare("CREATE TABLE attendance_new (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL, arm_id INTEGER, status TEXT CHECK(status IN ('Present', 'Absent', 'Late', 'Leave')) NOT NULL, date DATE NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL, FOREIGN KEY (student_id) REFERENCES students(id), FOREIGN KEY (class_id) REFERENCES classes(id), FOREIGN KEY (arm_id) REFERENCES arms(id), UNIQUE(student_id, date, session, term))").run();
                db.prepare("INSERT INTO attendance_new (id, student_id, class_id, arm_id, status, date, session, term) SELECT id, student_id, class_id, arm_id, status, date, session, term FROM attendance").run();
                db.prepare("DROP TABLE attendance").run();
                db.prepare("ALTER TABLE attendance_new RENAME TO attendance").run();
                db.prepare("CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance(class_id, arm_id, date)").run();
            })();
            console.log("Attendance table updated.");
        }
    }

    // 7. Update Students Table (Portal Passwords)
    try {
        db.prepare("ALTER TABLE students ADD COLUMN password TEXT").run();
        console.log("Added password column to students.");
        // Set a default password equal to their admission number for initial login
        db.prepare("UPDATE students SET password = admission_number WHERE password IS NULL").run();
    } catch (e) {
        if (!e.message.includes("duplicate column name")) console.error("Error adding password column:", e.message);
    }

    // 8. Create Public Website CMS Tables
    db.prepare(`
        CREATE TABLE IF NOT EXISTS news_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            content TEXT,
            image_path TEXT,
            is_published INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("Created news_posts table.");

    db.prepare(`
        CREATE TABLE IF NOT EXISTS gallery_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            image_path TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            display_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("Created gallery_images table.");

    db.prepare(`
        CREATE TABLE IF NOT EXISTS public_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("Created public_pages table.");

    console.log("Migration completed successfully.");
} catch (err) {
    console.error("Migration failed:", err);
} finally {
    db.close();
}
