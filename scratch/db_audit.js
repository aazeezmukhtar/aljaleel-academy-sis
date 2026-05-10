const Database = require('better-sqlite3');
const db = new Database('./database.sqlite');

console.log('=== DATABASE TABLES ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
tables.forEach(t => {
  const count = db.prepare('SELECT COUNT(*) as n FROM ' + t.name).get();
  console.log('  ' + t.name + ' -> ' + count.n + ' rows');
});

console.log('\n=== FOREIGN KEY INTEGRITY ===');
let fkIssues = 0;
try {
  const fkResult = db.pragma('foreign_key_check');
  if (fkResult.length === 0) {
    console.log('  No FK violations found');
  } else {
    fkResult.forEach(r => {
      console.error('  FK VIOLATION: table=' + r.table + ' rowid=' + r.rowid + ' parent=' + r.parent);
      fkIssues++;
    });
  }
} catch(e) { console.log('  FK check skipped: ' + e.message); }

console.log('\n=== INTEGRITY CHECK ===');
const integrity = db.pragma('integrity_check');
integrity.forEach(r => {
  if (r.integrity_check === 'ok') console.log('  OK - integrity check passed');
  else console.error('  FAIL: ' + r.integrity_check);
});

console.log('\n=== REQUIRED TABLES CHECK ===');
const required = [
  'staff','students','classes','subjects',
  'results','grading_systems','result_config',
  'student_fees','fee_categories','payments',
  'attendance','affective_psychomotor',
  'announcements','events','class_posts',
  'notifications','settings','audit_logs',
  'subject_assignments','class_assignments'
];
required.forEach(t => {
  const found = tables.find(x => x.name === t);
  console.log((found ? '  OK  ' : '  MISS') + ' ' + t);
});

db.close();
