const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

console.log('--- Results Table Info ---');
console.log(db.prepare('PRAGMA table_info(results)').all());

console.log('\n--- Results Indexes ---');
const indexes = db.prepare('PRAGMA index_list(results)').all();
console.log(indexes);

indexes.forEach(idx => {
    console.log(`\n--- Index Info: ${idx.name} ---`);
    console.log(db.prepare(`PRAGMA index_info(${idx.name})`).all());
});

console.log('\n--- Results Table Create SQL ---');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='results'").get());
