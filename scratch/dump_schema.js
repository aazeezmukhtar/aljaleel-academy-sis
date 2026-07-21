const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const tables = ['students', 'classes', 'staff', 'class_assignments', 'attendance', 'results'];

tables.forEach(table => {
    const info = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if(info) {
        console.log(`\n--- Schema for ${table} ---`);
        console.log(info.sql);
    }
});
