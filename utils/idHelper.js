const db = require('./db');

const generateUniqueID = async () => {
    let admission_number;
    let unique = false;
    while (!unique) {
        admission_number = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await db.get("SELECT id FROM students WHERE admission_number = ?", [admission_number]);
        if (!existing) unique = true;
    }
    return admission_number;
};

module.exports = { generateUniqueID };
