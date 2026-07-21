<<<<<<< HEAD
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
=======
const db = require('./db');

async function runMigrations() {
    console.log('[migrate] Running startup migrations...');

    const isPostgres = db.DB_TYPE === 'postgres';
    const serialType = isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';

    // 1. Create Sections table
    await db.run(`
        CREATE TABLE IF NOT EXISTS sections (
            id ${serialType},
            name TEXT UNIQUE NOT NULL,
            description TEXT
        )
    `);

    // Ensure description column exists
    try {
        await db.run("ALTER TABLE sections ADD COLUMN description TEXT");
        console.log('[migrate] Added description column to sections');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] sections.description failed:', e.message);
        }
    }

    // 2. Add current_session and current_term to sections table
    try {
        await db.run("ALTER TABLE sections ADD COLUMN current_session TEXT");
        console.log('[migrate] Added current_session to sections');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] sections.current_session failed:', e.message);
        }
    }
    try {
        await db.run("ALTER TABLE sections ADD COLUMN current_term TEXT");
        console.log('[migrate] Added current_term to sections');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] sections.current_term failed:', e.message);
        }
    }

    // 3. Add section_id to classes
    try {
        await db.run("ALTER TABLE classes ADD COLUMN section_id INTEGER REFERENCES sections(id)");
        console.log('[migrate] Added section_id to classes');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] classes.section_id failed:', e.message);
        }
    }

    // 4. Add section_id to term_events
    try {
        await db.run("ALTER TABLE term_events ADD COLUMN section_id INTEGER REFERENCES sections(id)");
        console.log('[migrate] Added section_id to term_events');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] term_events.section_id failed:', e.message);
        }
    }

    // 5. Add section_id to announcements
    try {
        await db.run("ALTER TABLE announcements ADD COLUMN section_id INTEGER REFERENCES sections(id)");
        console.log('[migrate] Added section_id to announcements');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] announcements.section_id failed:', e.message);
        }
    }

    // 6. Create student_enrollments table
    await db.run(`
        CREATE TABLE IF NOT EXISTS student_enrollments (
            id ${serialType},
>>>>>>> local-master
            student_id INTEGER NOT NULL REFERENCES students(id),
            class_id INTEGER NOT NULL REFERENCES classes(id),
            session TEXT NOT NULL,
            UNIQUE(student_id, class_id, session)
        )
    `);

<<<<<<< HEAD
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
    if (Number(enrollmentCount.c || 0) === 0) {
        const settingsRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const currentSession = settingsRow ? settingsRow.value : '2025/2026';

        await db.run(`
            INSERT INTO student_enrollments (student_id, class_id, session)
            SELECT id, current_class_id, ?
            FROM students
            WHERE current_class_id IS NOT NULL AND status = 'active'
=======
    // 7. Create section_result_config table
    let needsRecreate = false;
    try {
        if (db.DB_TYPE === 'postgres') {
            const cols = await db.all(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'section_result_config'
            `);
            if (cols.length > 0 && !cols.some(c => c.column_name === 'key')) {
                needsRecreate = true;
            }
        } else {
            const cols = await db.all("PRAGMA table_info(section_result_config)");
            if (cols.length > 0 && !cols.some(c => c.name === 'key')) {
                needsRecreate = true;
            }
        }
    } catch (e) {
        // Table doesn't exist yet, which is fine
    }

    if (needsRecreate) {
        await db.run("DROP TABLE section_result_config");
        console.log('[migrate] Dropped old incompatible section_result_config table');
    }

    await db.run(`
        CREATE TABLE IF NOT EXISTS section_result_config (
            section_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (section_id, key)
        )
    `);

    // 8. Seed Default Sections
    await db.run("INSERT OR IGNORE INTO sections (name, description) VALUES (?, ?)", ['Academy', 'Western Education Section']);
    await db.run("INSERT OR IGNORE INTO sections (name, description) VALUES (?, ?)", ['Tahfeez', "Qur'an Memorization Section"]);

    // Assign existing classes to Academy section if NULL
    const sections = await db.all("SELECT id, name FROM sections");
    const academySection = sections.find(s => s.name === 'Academy');
    if (academySection) {
        await db.run("UPDATE classes SET section_id = ? WHERE section_id IS NULL", [academySection.id]);
    }

    // Seed default section result configs
    const globalConfig = await db.all('SELECT key, value FROM result_config');
    const defaults = { ca_count: '2', ca1_max: '20', ca2_max: '20', exam_max: '60' };
    globalConfig.forEach(r => { defaults[r.key] = r.value; });

    for (const sec of sections) {
        for (const [key, value] of Object.entries(defaults)) {
            await db.run(
                'INSERT OR IGNORE INTO section_result_config (section_id, key, value) VALUES (?, ?, ?)',
                [sec.id, key, value]
            );
        }
    }

    // Seed default current session/term for sections if NULL
    const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
    const termRow = await db.get("SELECT value FROM settings WHERE key = 'current_term'");
    const currentSession = sessionRow ? sessionRow.value : '2024/2025';
    const currentTerm = termRow ? termRow.value : '1st Term';

    await db.run(
        "UPDATE sections SET current_session = ?, current_term = ? WHERE current_session IS NULL",
        [currentSession, currentTerm]
    );

    // 9. Backfill student_enrollments from students.current_class_id
    const enrollmentCount = await db.get('SELECT COUNT(*) as c FROM student_enrollments');
    if (Number(enrollmentCount.c || 0) === 0) {
        await db.run(`
            INSERT OR IGNORE INTO student_enrollments (student_id, class_id, session)
            SELECT id, current_class_id, ? 
            FROM students 
            WHERE current_class_id IS NOT NULL
>>>>>>> local-master
        `, [currentSession]);
        console.log('[migrate] Backfilled student_enrollments from current_class_id');
    }

<<<<<<< HEAD
=======
    // 10. Add reason_type and custom_reason columns to attendance table
    try {
        await db.run("ALTER TABLE attendance ADD COLUMN reason_type TEXT");
        console.log('[migrate] Added reason_type to attendance');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] attendance.reason_type failed:', e.message);
        }
    }
    try {
        await db.run("ALTER TABLE attendance ADD COLUMN custom_reason TEXT");
        console.log('[migrate] Added custom_reason to attendance');
    } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
            console.error('[migrate] attendance.custom_reason failed:', e.message);
        }
    }

>>>>>>> local-master
    console.log('[migrate] Startup migrations complete.');
}

module.exports = { runMigrations };
