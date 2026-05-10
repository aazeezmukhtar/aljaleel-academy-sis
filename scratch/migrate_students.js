const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

try {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
        // 1. Create a temporary table with dob NULLABLE
        db.prepare(`
            CREATE TABLE students_new (
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
            )
        `).run();

        // 2. Copy data from old table to new table
        db.prepare(`
            INSERT INTO students_new (
                id, first_name, last_name, gender, dob, admission_number,
                passport_photo_path, admission_date, current_class_id,
                current_arm_id, status, parent_phone, parent_address, password
            )
            SELECT 
                id, first_name, last_name, gender, dob, admission_number,
                passport_photo_path, admission_date, current_class_id,
                current_arm_id, status, parent_phone, parent_address, password
            FROM students
        `).run();

        // 3. Drop old table
        db.prepare('DROP TABLE students').run();

        // 4. Rename new table to old table name
        db.prepare('ALTER TABLE students_new RENAME TO students').run();

        console.log('Migration successful: dob is now nullable.');
    })();
    db.pragma('foreign_keys = ON');
} catch (err) {
    console.error('Migration failed:', err.message);
} finally {
    db.close();
}
