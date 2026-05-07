const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
const fs = require('fs');

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();

let pgSql = "";

// PostgreSQL Session table for connect-pg-simple
pgSql += `
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
\n`;

tables.forEach(table => {
    let sql = table.sql;
    // Basic conversion from SQLite to PostgreSQL
    sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    sql = sql.replace(/DATETIME/gi, 'TIMESTAMP');
    sql = sql.replace(/REAL/gi, 'DOUBLE PRECISION');
    sql = sql.replace(/INSERT OR IGNORE/gi, 'INSERT'); // Handle this differently in PG if needed, but for schema it's fine
    
    // Remove quotes around table names if they exist and are incompatible
    // sql = sql.replace(/"(\w+)"/g, '$1'); 
    
    pgSql += sql + ";\n\n";
});

indexes.forEach(index => {
    if (index.sql) {
        pgSql += index.sql + ";\n";
    }
});

fs.writeFileSync('supabase_schema.sql', pgSql);
console.log('Supabase schema exported to supabase_schema.sql');
db.close();
