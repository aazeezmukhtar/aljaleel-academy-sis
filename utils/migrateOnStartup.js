/**
 * Non-destructive startup migrations.
 * Runs on every app boot; uses IF NOT EXISTS / IF NOT EXISTS to be idempotent.
 * Supports both SQLite (better-sqlite3) and PostgreSQL (pg).
 */
const db = require('./db');

async function runMigrations() {
    console.log('[migrate] Running startup migrations…');

    // 1. Sections table
    await db.run(`
        CREATE TABLE IF NOT EXISTS sections (
            id ${db.DB_TYPE === 'postgres' ? 'SERIAL' : 'INTEGER'} PRIMARY KEY${db.DB_TYPE === 'postgres' ? '' : ' AUTOINCREMENT'},
            name TEXT NOT NULL UNIQUE
        )
    `);

    // 2. Add section_id to classes (non-destructive)
    try {
        await db.run('ALTER TABLE classes ADD COLUMN section_id INTEGER REFERENCES sections(id)');
        console.log('[migrate] Added section_id to classes');
    } catch (e) {
        if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
            console.log('[migrate] classes.section_id — skipped:', e.message);
        }
    }

    // 3. Section result config table
    await db.run(`
        CREATE TABLE IF NOT EXISTS section_result_config (
            id ${db.DB_TYPE === 'postgres' ? 'SERIAL' : 'INTEGER'} PRIMARY KEY${db.DB_TYPE === 'postgres' ? '' : ' AUTOINCREMENT'},
            section_id INTEGER NOT NULL REFERENCES sections(id),
            ca_count INTEGER DEFAULT 2,
            ca1_max INTEGER DEFAULT 20,
            ca2_max INTEGER DEFAULT 20,
            exam_max INTEGER DEFAULT 60,
            UNIQUE(section_id)
        )
    `);

    // 4. Student enrollments junction table
    await db.run(`
        CREATE TABLE IF NOT EXISTS student_enrollments (
            id ${db.DB_TYPE === 'postgres' ? 'SERIAL' : 'INTEGER'} PRIMARY KEY${db.DB_TYPE === 'postgres' ? '' : ' AUTOINCREMENT'},
            student_id INTEGER NOT NULL REFERENCES students(id),
            class_id INTEGER NOT NULL REFERENCES classes(id),
            session TEXT NOT NULL,
            UNIQUE(student_id, class_id, session)
        )
    `);

    // Seed default sections if empty
    const existing = await db.all('SELECT id FROM sections');
    if (existing.length === 0) {
        await db.run("INSERT INTO sections (name) VALUES ('Primary')");
        await db.run("INSERT INTO sections (name) VALUES ('Secondary')");
        console.log('[migrate] Seeded default sections: Primary, Secondary');

        // Assign classes to sections based on name prefix
        const sections = await db.all('SELECT * FROM sections');
        const primaryId = sections.find(s => s.name === 'Primary')?.id;
        const secondaryId = sections.find(s => s.name === 'Secondary')?.id;

        if (primaryId) {
            await db.run("UPDATE classes SET section_id = ? WHERE name LIKE 'R %' OR name LIKE 'R%'", [primaryId]);
        }
        if (secondaryId) {
            await db.run("UPDATE classes SET section_id = ? WHERE name LIKE 'F %' OR name LIKE 'F%'", [secondaryId]);
        }
        console.log('[migrate] Assigned classes to sections by name prefix');

        // Seed default result configs per section
        for (const sec of sections) {
            try {
                await db.run(
                    'INSERT INTO section_result_config (section_id, ca_count, ca1_max, ca2_max, exam_max) VALUES (?, 2, 20, 20, 60)',
                    [sec.id]
                );
            } catch (e) { /* unique constraint = already seeded */ }
        }
        console.log('[migrate] Seeded default section result configs');
    }

    // Backfill student_enrollments from students.current_class_id
    const enrollmentCount = await db.get('SELECT COUNT(*) as c FROM student_enrollments');
    if (enrollmentCount.c === 0) {
        const settingsRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = settingsRow ? settingsRow.value : '2025/2026';

        await db.run(`
            INSERT INTO student_enrollments (student_id, class_id, session)
            SELECT id, current_class_id, ?
            FROM students
            WHERE current_class_id IS NOT NULL AND status = 'active'
        `, [currentSession]);
        console.log('[migrate] Backfilled student_enrollments from current_class_id');
    }

    console.log('[migrate] Startup migrations complete.');
}

module.exports = { runMigrations };
