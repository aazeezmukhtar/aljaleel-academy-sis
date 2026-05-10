const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'database.sqlite'));

async function resetAdmin() {
    console.log('Resetting Admin Credentials...');

    // Hash the password 'admin123'
    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);

    // Check if admin exists
    const admin = db.prepare("SELECT * FROM staff WHERE staff_id = 'admin'").get();

    if (admin) {
        console.log('Admin account found. Updating password...');
        db.prepare("UPDATE staff SET password_hash = ?, status = 'active' WHERE staff_id = 'admin'").run(hash);
        console.log('Password updated successfully.');
    } else {
        console.log('Admin account not found. Creating new admin...');
        db.prepare(`
            INSERT INTO staff (staff_id, first_name, last_name, password_hash, role, designation, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('admin', 'System', 'Administrator', hash, 'Admin', 'Super Admin', 'active');
        console.log('Admin account created successfully.');
    }

    db.close();
}

resetAdmin().catch(console.error);
