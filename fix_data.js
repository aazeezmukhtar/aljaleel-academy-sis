const db = require('better-sqlite3')('database.sqlite');
try {
    const classes = db.prepare('SELECT id FROM classes').all();
    const staff = db.prepare("SELECT id FROM staff WHERE role='Teacher'").all();
    if(staff.length > 0) {
        let s_idx = 0;
        const stmt = db.prepare('UPDATE classes SET form_teacher_id = ? WHERE id = ?');
        for(let c of classes) {
            stmt.run(staff[s_idx % staff.length].id, c.id);
            s_idx++;
        }
        console.log('Assigned teachers to ' + classes.length + ' classes.');
    }
} catch(e) { console.log(e.message); }
