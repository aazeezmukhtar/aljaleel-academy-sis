const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
console.log(db.prepare("PRAGMA table_info(results)").all());
db.close();
