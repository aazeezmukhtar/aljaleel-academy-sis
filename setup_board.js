const db = require('better-sqlite3')('database.sqlite');

try {
    db.prepare('ALTER TABLE classes ADD COLUMN form_teacher_id INTEGER REFERENCES staff(id)').run();
    console.log('Added form_teacher_id to classes.');
} catch(e) {
    console.log(e.message);
}

try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS class_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_id INTEGER NOT NULL,
            teacher_id INTEGER NOT NULL,
            post_type TEXT CHECK(post_type IN ('Announcement', 'Assignment')) NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            due_date DATE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (class_id) REFERENCES classes(id),
            FOREIGN KEY (teacher_id) REFERENCES staff(id)
        )
    `).run();
    console.log('Created class_posts table.');
} catch(e) {
    console.log(e.message);
}

try {
    const classes = db.prepare('SELECT id FROM classes').all();
    const staff = db.prepare('SELECT id FROM staff WHERE role="Teacher"').all();
    if(staff.length > 0) {
        let s_idx = 0;
        const stmt = db.prepare('UPDATE classes SET form_teacher_id = ? WHERE id = ?');
        for(let c of classes) {
            stmt.run(staff[s_idx % staff.length].id, c.id);
            s_idx++;
        }
        console.log('Assigned teachers to ' + classes.length + ' classes.');
    }
} catch(e) {
    console.log(e.message);
}
