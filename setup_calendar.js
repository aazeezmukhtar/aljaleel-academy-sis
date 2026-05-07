const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'database.sqlite'));

try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS term_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            event_date DATE NOT NULL,
            session TEXT,
            term TEXT,
            type TEXT CHECK(type IN ('Announcement', 'Exam', 'Holiday', 'Deadline')) DEFAULT 'Announcement',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log('Table term_events created successfully');
} catch (e) {
    console.error('Error creating term_events table:', e.message);
} finally {
    db.close();
}
