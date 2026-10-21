'use strict';

// Builds a disposable SQLite database from the repository's schema definition.
// No application data or credentials are read. This script is intended for CI only.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = process.env.DB_PATH || '.test-database.sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const root = path.join(__dirname, '..', '..');
const dbPath = path.join(root, process.env.DB_PATH);
const schemaPath = path.join(root, 'supabase_schema.sql');

if (!fs.existsSync(schemaPath)) {
  throw new Error('Canonical schema file is missing: supabase_schema.sql');
}

if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

let schema = fs.readFileSync(schemaPath, 'utf8');
// The session DDL in this reference file is PostgreSQL-specific. The application
// creates its own SQLite session table when needed, so omit that block.
schema = schema.replace(
  /-- PostgreSQL Session table for connect-pg-simple[\s\S]*?(?=CREATE TABLE IF NOT EXISTS settings)/,
  ''
);
schema = schema
  .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
  .replace(/DOUBLE PRECISION/g, 'REAL')
  .replace(/TIMESTAMP/g, 'TEXT');

const sqlite = new Database(dbPath);
try {
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(schema);
} finally {
  sqlite.close();
}

(async () => {
  const { runMigrations } = require('../../utils/migrateOnStartup');
  await runMigrations();
  console.log('[test-db] Disposable SQLite schema prepared successfully.');
})().catch(err => {
  console.error('[test-db] Failed to prepare disposable SQLite schema:', err.message);
  process.exitCode = 1;
});
