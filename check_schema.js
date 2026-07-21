const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
<<<<<<< HEAD
try {
    const settings = db.prepare("SELECT * FROM settings").all();
    console.log("Settings:", settings);
} catch(e) {}
try {
    const sessions = db.prepare("SELECT * FROM sessions").all();
    console.log("Sessions:", sessions);
} catch(e) {}



=======
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));
>>>>>>> local-master
