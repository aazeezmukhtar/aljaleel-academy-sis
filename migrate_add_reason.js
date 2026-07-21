// Migration script to add 'reason' column to attendance table if it does not exist
const path = require('path');
const Database = require('better-sqlite3');

// Resolve path to the SQLite database file (relative to this script)
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

try {
  // Check whether the column already exists
  const columns = db.pragma('table_info(attendance)');
  const hasReason = columns.some(col => col.name === 'reason');
  if (hasReason) {
    console.log('Column "reason" already exists. No migration needed.');
    process.exit(0);
  }
  // Add the column
  db.exec('ALTER TABLE attendance ADD COLUMN reason TEXT');
  console.log('Migration successful: "reason" column added.');
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}
