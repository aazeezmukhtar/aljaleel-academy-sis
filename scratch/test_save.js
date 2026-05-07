const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

try {
    const class_id = 7;
    const date = '2026-04-22';
    const session = '2025/2026';
    const term = 'First';
    const attendance = { '1': 'Present', '2': 'Absent' };

    const upsert = db.prepare(`
        INSERT INTO attendance (student_id, class_id, date, status, session, term)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, date, session, term) DO UPDATE SET status = excluded.status, class_id = excluded.class_id
    `);

    const transaction = db.transaction((records) => {
        for (const [studentIdStr, status] of Object.entries(records)) {
            upsert.run(Number(studentIdStr), class_id, date, status, session, term);
        }
    });

    transaction(attendance);
    console.log('Success');
} catch (err) {
    console.error('Error:', err);
} finally {
    db.close();
}
