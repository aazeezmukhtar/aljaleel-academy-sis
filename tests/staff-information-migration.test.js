'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const migrationPath = path.join(__dirname, '..', 'database', 'migrations',
  '20261122_staff_information.sqlite.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const db = new Database(':memory:');

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE staff (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      staff_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL,
      designation TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE class_assignments (
      id INTEGER PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id),
      class_id INTEGER NOT NULL,
      session TEXT NOT NULL
    );
  `);

  db.prepare(`
    INSERT INTO staff (id, school_id, staff_id, first_name, last_name, role, designation)
    VALUES (1, 1, 'teacher01', 'Test', 'Teacher', 'Teacher', 'Mathematics Teacher')
  `).run();
  db.prepare(`
    INSERT INTO class_assignments (id, staff_id, class_id, session)
    VALUES (10, 1, 20, '2026/2027')
  `).run();

  const staffBefore = db.prepare('SELECT * FROM staff').all();
  const assignmentsBefore = db.prepare('SELECT * FROM class_assignments').all();

  db.exec(migration);
  db.exec(migration);

  assert.deepStrictEqual(db.prepare('SELECT * FROM staff').all(), staffBefore,
    'Migration must preserve all existing staff records');
  assert.deepStrictEqual(db.prepare('SELECT * FROM class_assignments').all(), assignmentsBefore,
    'Migration must preserve all existing staff assignments');

  const tables = ['staff_personal_details', 'staff_employment_details',
    'staff_emergency_contacts', 'staff_qualifications'];
  tables.forEach(name => {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),
      name + ' should exist');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM ' + name).get().count, 0,
      name + ' must not invent or backfill staff information');
  });

  db.prepare(`
    INSERT INTO staff_personal_details (school_id, staff_id, phone, personal_email)
    VALUES (1, 1, '08000000000', 'teacher@example.test')
  `).run();
  db.prepare(`
    INSERT INTO staff_employment_details (school_id, staff_id, department, employment_type)
    VALUES (1, 1, 'Academics', 'Full-time')
  `).run();
  db.prepare(`
    INSERT INTO staff_emergency_contacts
      (school_id, staff_id, contact_name, relationship, phone, is_primary)
    VALUES (1, 1, 'Emergency One', 'Sibling', '08000000001', 1)
  `).run();
  assert.throws(() => db.prepare(`
    INSERT INTO staff_emergency_contacts
      (school_id, staff_id, contact_name, relationship, phone, is_primary)
    VALUES (1, 1, 'Emergency Two', 'Parent', '08000000002', 1)
  `).run(), /UNIQUE constraint failed/,
    'A staff member cannot have two primary emergency contacts');

  db.prepare(`
    INSERT INTO staff_qualifications
      (school_id, staff_id, qualification, institution, verification_status)
    VALUES (1, 1, 'BSc', 'Test University', 'pending')
  `).run();
  assert.throws(() => db.prepare(`
    INSERT INTO staff_qualifications
      (school_id, staff_id, qualification, verification_status)
    VALUES (1, 1, 'MSc', 'verified')
  `).run(), /CHECK constraint failed/,
    'Verified qualifications require a verification timestamp');

  db.prepare(`
    UPDATE staff_qualifications
    SET verification_status = 'verified', verified_at = CURRENT_TIMESTAMP
    WHERE staff_id = 1
  `).run();
  assert.strictEqual(db.prepare('SELECT verification_status FROM staff_qualifications').get().verification_status,
    'verified');

  assert.deepStrictEqual(db.pragma('foreign_key_check'), [],
    'All new foreign-key relationships must remain valid');

  console.log('[test-staff-information-migration] additive schema, idempotency, preservation, constraints and foreign keys passed.');
} finally {
  db.close();
}
