const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

try {
    const stmt = db.prepare(`
        INSERT INTO students (first_name, last_name, gender, dob, admission_number, status)
        VALUES ('Test', 'Optional', 'Male', NULL, 'TEST-ID-999', 'active')
    `);
    const info = stmt.run();
    console.log('Success:', info);
    // Cleanup
    db.prepare('DELETE FROM students WHERE admission_number = ?').run('TEST-ID-999');
} catch (err) {
    console.error('Error:', err.message);
} finally {
    db.close();
}
