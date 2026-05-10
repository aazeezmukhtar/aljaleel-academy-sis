const db = require('better-sqlite3')('database.sqlite');

// Simulate getBulkReport with class_id=7, term='1st Term', session='2025/2026'
const class_id = 7;
const term = '1st Term';
const session = '2025/2026';

try {
    // This is the ACTUAL query in resultController.js line 457 - using double-quote "active"
    const students1 = db.prepare('SELECT * FROM students WHERE current_class_id = ? AND status = "active" ORDER BY last_name, first_name').all(class_id);
    console.log('Double-quote query students:', students1.length);
} catch(e) {
    console.log('Double-quote query ERROR:', e.message);
}

try {
    // Fixed query with single-quotes
    const students2 = db.prepare("SELECT * FROM students WHERE current_class_id = ? AND status = 'active' ORDER BY last_name, first_name").all(class_id);
    console.log('Single-quote query students:', students2.length);
} catch(e) {
    console.log('Single-quote query ERROR:', e.message);
}

// Test the report_card_content partial's required variables
// Check if caCount is passed - this is used in report_card_content but not in bulk_report rendering
try {
    const school = db.prepare('SELECT key, value FROM settings').all();
    const config = db.prepare('SELECT key, value FROM result_config').all();
    const settings = {};
    school.forEach(s => settings[s.key] = s.value);
    config.forEach(c => settings[c.key] = c.value);
    console.log('caCount from settings:', settings.ca_count);
    console.log('school keys:', Object.keys(settings).join(', '));
} catch(e) {
    console.log('Settings ERROR:', e.message);
}

// Check if result_config table exists
try {
    const rc = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='result_config'").get();
    console.log('result_config schema:', rc ? rc.sql : 'TABLE NOT FOUND');
} catch(e) {
    console.log('result_config check ERROR:', e.message);
}
