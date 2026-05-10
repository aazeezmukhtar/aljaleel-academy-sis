const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
console.log('--- Index List ---');
console.log(db.prepare("PRAGMA index_list('results')").all());
console.log('--- Index Info (idx_result_unique) ---');
try {
    console.log(db.prepare("PRAGMA index_info('idx_result_unique')").all());
} catch (e) {
    console.log('Error fetching index info:', e.message);
}
db.close();
