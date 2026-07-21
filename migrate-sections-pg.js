const db = require('./utils/db');

async function migrate() {
    console.log("Starting Sections Migration for PostgreSQL...");

    try {
        // 1. Create Sections table
        await db.run(`
            CREATE TABLE IF NOT EXISTS sections (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT
            )
        `);
        console.log("Created sections table.");

        // Insert Default Sections
        await db.run("INSERT INTO sections (name, description) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['Academy', 'Western Education Section']);
        await db.run("INSERT INTO sections (name, description) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['Tahfeez', "Qur'an Memorization Section"]);
        console.log("Inserted default sections.");

        const academySection = await db.get("SELECT id FROM sections WHERE name = 'Academy'");

        // 2. Add section_id to classes
        try {
            await db.run("ALTER TABLE classes ADD COLUMN section_id INTEGER REFERENCES sections(id)");
            await db.run("UPDATE classes SET section_id = $1 WHERE section_id IS NULL", [academySection.id]);
            console.log("Added section_id to classes.");
        } catch(e) {
            if(!e.message.includes('column "section_id" of relation "classes" already exists')) {
                console.error("Classes alter error (might exist already):", e.message);
            }
        }

        // 3. Add section_id to term_events
        try {
            await db.run("ALTER TABLE term_events ADD COLUMN section_id INTEGER REFERENCES sections(id)");
            console.log("Added section_id to term_events.");
        } catch(e) {
            if(!e.message.includes('column "section_id" of relation "term_events" already exists')) {
                console.error("Term_events alter error:", e.message);
            }
        }

        // 4. Add section_id to announcements
        try {
            await db.run("ALTER TABLE announcements ADD COLUMN section_id INTEGER REFERENCES sections(id)");
            console.log("Added section_id to announcements.");
        } catch(e) {
            if(!e.message.includes('column "section_id" of relation "announcements" already exists')) {
                console.error("Announcements alter error:", e.message);
            }
        }

        // 5. Create student_enrollments table
        await db.run(`
            CREATE TABLE IF NOT EXISTS student_enrollments (
                id SERIAL PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES students(id),
                class_id INTEGER NOT NULL REFERENCES classes(id),
                session TEXT NOT NULL,
                UNIQUE(student_id, class_id, session)
            )
        `);
        console.log("Created student_enrollments table.");

        // 6. Migrate existing data (Enroll all active students based on current_class_id)
        // Get current session from settings
        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';

        const result = await db.run(`
            INSERT INTO student_enrollments (student_id, class_id, session)
            SELECT id, current_class_id, $1 
            FROM students 
            WHERE current_class_id IS NOT NULL
            ON CONFLICT DO NOTHING
        `, [currentSession]);
        
        console.log(`Migrated student enrollments. Result:`, result);

        console.log("Migration completed successfully.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit();
    }
}

migrate();
