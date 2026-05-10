const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function resetAdmin() {
    console.log('Resetting Admin Credentials in PostgreSQL...');

    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM staff WHERE staff_id = 'admin'");
        const admin = res.rows[0];

        if (admin) {
            console.log('Admin account found. Updating password...');
            await client.query("UPDATE staff SET password_hash = $1, status = 'active' WHERE staff_id = 'admin'", [hash]);
            console.log('Password updated successfully.');
        } else {
            console.log('Admin account not found. Creating new admin...');
            await client.query(`
                INSERT INTO staff (staff_id, first_name, last_name, password_hash, role, designation, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, ['admin', 'System', 'Administrator', hash, 'Admin', 'Super Admin', 'active']);
            console.log('Admin account created successfully.');
        }
    } finally {
        client.release();
        await pool.end();
    }
}

resetAdmin().catch(console.error);
