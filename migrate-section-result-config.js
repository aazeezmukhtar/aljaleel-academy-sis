/**
 * migrate-section-result-config.js
 * Adds per-section result configuration support.
 * Uses a direct DB connection to avoid pool saturation.
 * Safe to run multiple times (idempotent).
 */

require('dotenv').config();
const isPostgres = process.env.DB_TYPE === 'postgres' || !!process.env.DATABASE_URL;

async function migrate() {
    if (isPostgres) {
        await migratePostgres();
    } else {
        await migrateSQLite();
    }
}

// ─── Postgres ────────────────────────────────────────────────────────────────

async function migratePostgres() {
    const { Client } = require('pg');
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    console.log('[Migration] Connected to Postgres.');

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS section_result_config (
                section_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (section_id, key)
            )
        `);
        console.log('[Migration] Table created (or already exists).');

        const { rows: sections } = await client.query('SELECT id, name FROM sections');
        if (!sections.length) {
            console.log('[Migration] No sections found, skipping seed.');
            return;
        }

        const { rows: globalConfig } = await client.query('SELECT key, value FROM result_config');
        const defaults = { ca_count: '2', ca1_max: '20', ca2_max: '20', exam_max: '60' };
        globalConfig.forEach(r => { defaults[r.key] = r.value; });

        for (const section of sections) {
            for (const [key, value] of Object.entries(defaults)) {
                await client.query(
                    'INSERT INTO section_result_config (section_id, key, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [section.id, key, value]
                );
            }
            console.log(`[Migration] Seeded section: ${section.name} (id=${section.id})`);
        }
        console.log('[Migration] Complete.');
    } finally {
        await client.end();
    }
}

// ─── SQLite ───────────────────────────────────────────────────────────────────

async function migrateSQLite() {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, process.env.DB_PATH || 'database.sqlite'));

    db.prepare(`
        CREATE TABLE IF NOT EXISTS section_result_config (
            section_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (section_id, key)
        )
    `).run();
    console.log('[Migration] Table created (or already exists).');

    const sections = db.prepare('SELECT id, name FROM sections').all();
    if (!sections.length) {
        console.log('[Migration] No sections found, skipping seed.');
        db.close();
        return;
    }

    const globalConfig = db.prepare('SELECT key, value FROM result_config').all();
    const defaults = { ca_count: '2', ca1_max: '20', ca2_max: '20', exam_max: '60' };
    globalConfig.forEach(r => { defaults[r.key] = r.value; });

    const insert = db.prepare('INSERT OR IGNORE INTO section_result_config (section_id, key, value) VALUES (?, ?, ?)');
    for (const section of sections) {
        for (const [key, value] of Object.entries(defaults)) {
            insert.run(section.id, key, value);
        }
        console.log(`[Migration] Seeded section: ${section.name} (id=${section.id})`);
    }
    console.log('[Migration] Complete.');
    db.close();
}

migrate().catch(err => {
    console.error('[Migration] Failed:', err.message);
    process.exit(1);
});
