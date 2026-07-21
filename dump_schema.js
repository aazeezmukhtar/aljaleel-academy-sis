const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'database.sqlite'));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Found tables:", tables.map(t => t.name).join(', '));

for (const table of tables) {
    if (table.name === 'sqlite_sequence') continue;
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.name}'`).get();
    console.log(`\n-- SCHEMA FOR ${table.name} --`);
    console.log(schema.sql + ";");
}

db.close();
