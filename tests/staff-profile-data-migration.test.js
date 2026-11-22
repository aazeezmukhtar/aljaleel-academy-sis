'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
    '20261122_staff_profile_data.sqlite.sql'), 'utf8');
const db = new Database(':memory:');

try {
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE staff (
            id INTEGER PRIMARY KEY,
            staff_id TEXT NOT NULL UNIQUE,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT
        );
        INSERT INTO staff (id, staff_id, first_name, last_name)
        VALUES (1, 'staff001', 'Existing', 'Member');
    `);

    db.exec(migration);

    const expected = {
        staff_personal_details: ['staff_id', 'date_of_birth', 'gender', 'phone', 'residential_address', 'state_of_origin'],
        staff_employment_details: ['staff_id', 'department', 'employment_type', 'date_employed', 'employment_status', 'supervisor_staff_id'],
        staff_qualifications: ['id', 'staff_id', 'qualification', 'institution', 'course_of_study', 'certificate_reference', 'teaching_specialisation', 'verification_status', 'verified_by', 'verified_at'],
        staff_emergency_contacts: ['id', 'staff_id', 'contact_name', 'relationship', 'phone', 'alternate_phone']
    };

    for (const [table, fields] of Object.entries(expected)) {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
        assert.ok(columns.length, 'Missing table: ' + table);
        const byName = new Map(columns.map(column => [column.name, column]));
        for (const field of fields) assert.ok(byName.has(field), `Missing ${table}.${field}`);
        for (const field of fields.filter(name => !['id', 'staff_id'].includes(name))) {
            assert.strictEqual(byName.get(field).notnull, 0, `${table}.${field} must remain nullable`);
        }
    }

    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff').get().count, 1,
        'Existing staff records must remain untouched');

    db.prepare('INSERT INTO staff_personal_details (staff_id) VALUES (1)').run();
    db.prepare('INSERT INTO staff_employment_details (staff_id) VALUES (1)').run();
    db.prepare('INSERT INTO staff_qualifications (staff_id) VALUES (1), (1)').run();
    db.prepare('INSERT INTO staff_emergency_contacts (staff_id) VALUES (1), (1)').run();

    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff_qualifications').get().count, 2);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff_emergency_contacts').get().count, 2);
    assert.throws(() => db.prepare('INSERT INTO staff_personal_details (staff_id) VALUES (999)').run(),
        /FOREIGN KEY constraint failed/);
    assert.deepStrictEqual(db.pragma('foreign_key_check'), []);

    db.exec(migration);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff_qualifications').get().count, 2,
        'Rerunning migration must preserve qualification rows');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff_emergency_contacts').get().count, 2,
        'Rerunning migration must preserve emergency contact rows');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM staff').get().count, 1);

    console.log('[staff-profile-data-migration] schema, nullability, ownership, repeatable records and idempotency passed.');
} finally {
    db.close();
}
