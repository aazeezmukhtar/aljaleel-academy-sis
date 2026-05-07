const db = require('better-sqlite3')('database.sqlite');

// Find which classes have results
const withResults = db.prepare(`
    SELECT s.current_class_id, c.name, COUNT(r.id) as result_count
    FROM results r
    JOIN students s ON r.student_id = s.id
    JOIN classes c ON s.current_class_id = c.id
    GROUP BY s.current_class_id
`).all();
console.log('Classes with results:', withResults);

// Find all table names to check if there's something missing
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\nAll tables:', tables.map(t => t.name).join(', '));

// Check bulk_report view specifically - what settings table has
const settings = db.prepare('SELECT * FROM settings').all();
console.log('\nSettings:', settings);
