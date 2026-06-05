const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
const classes = db.prepare("SELECT * FROM classes").all();
console.log("Classes:", classes);
const students = db.prepare("SELECT id, first_name, last_name, current_class_id FROM students LIMIT 10").all();
console.log("Sample Students:", students);
db.close();
