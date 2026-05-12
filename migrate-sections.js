const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'database.sqlite'));

try {
    db.transaction(() => {
        console.log("Starting Sections Migration...");

        // 1. Create Sections table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT
            )
        `).run();
        console.log("Created sections table.");

        // Insert Default Sections
        db.prepare("INSERT OR IGNORE INTO sections (name, description) VALUES (?, ?)").run('Academy', 'Western Education Section');
        db.prepare("INSERT OR IGNORE INTO sections (name, description) VALUES (?, ?)").run('Tahfeez', "Qur'an Memorization Section");
        console.log("Inserted default sections.");

        const academySection = db.prepare("SELECT id FROM sections WHERE name = 'Academy'").get();

        // 2. Add section_id to classes
        try {
            db.prepare("ALTER TABLE classes ADD COLUMN section_id INTEGER REFERENCES sections(id)").run();
            // Default all existing classes to Academy
            db.prepare("UPDATE classes SET section_id = ? WHERE section_id IS NULL").run(academySection.id);
            console.log("Added section_id to classes.");
        } catch(e) {
            if(!e.message.includes('duplicate column name')) throw e;
            console.log("section_id already exists in classes.");
        }

        // 3. Add section_id to term_events
        try {
            db.prepare("ALTER TABLE term_events ADD COLUMN section_id INTEGER REFERENCES sections(id)").run();
            console.log("Added section_id to term_events.");
        } catch(e) {
            if(!e.message.includes('duplicate column name')) throw e;
            console.log("section_id already exists in term_events.");
        }

        // 4. Add section_id to announcements
        try {
            db.prepare("ALTER TABLE announcements ADD COLUMN section_id INTEGER REFERENCES sections(id)").run();
            console.log("Added section_id to announcements.");
        } catch(e) {
            if(!e.message.includes('duplicate column name')) throw e;
            console.log("section_id already exists in announcements.");
        }

        // 5. Create student_enrollments table
        db.prepare(`
            CREATE TABLE IF NOT EXISTS student_enrollments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                class_id INTEGER NOT NULL,
                session TEXT NOT NULL,
                FOREIGN KEY (student_id) REFERENCES students(id),
                FOREIGN KEY (class_id) REFERENCES classes(id),
                UNIQUE(student_id, class_id, session)
            )
        `).run();
        console.log("Created student_enrollments table.");

        // 6. Migrate existing data (Enroll all active students based on current_class_id)
        // Get current session from settings
        const sessionRow = db.prepare("SELECT value FROM settings WHERE key = 'current_session'").get();
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        const result = db.prepare(`
            INSERT OR IGNORE INTO student_enrollments (student_id, class_id, session)
            SELECT id, current_class_id, ? 
            FROM students 
            WHERE current_class_id IS NOT NULL
        `).run(currentSession);
        
        console.log(`Migrated ${result.changes} student enrollments.`);

        console.log("Migration completed successfully.");
    })();
} catch (err) {
    console.error("Migration failed:", err);
} finally {
    db.close();
}
