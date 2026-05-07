const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../database.sqlite'));

const generateUniqueID = () => {
    let admission_number;
    let unique = false;
    while (!unique) {
        admission_number = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = db.prepare("SELECT id FROM students WHERE admission_number = ?").get(admission_number);
        if (!existing) unique = true;
    }
    return admission_number;
};

module.exports = { generateUniqueID };
