'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('[staff-information-postgres] PG_TEST_URL required; refusing application DB fallback.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'staff_information_test_' + process.pid;
  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '"');
    await client.query(`
      CREATE TABLE schools (id SERIAL PRIMARY KEY);
      CREATE TABLE staff (
        id SERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL REFERENCES schools(id),
        staff_id TEXT NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Staff'
      );
      CREATE TABLE class_assignments (
        id SERIAL PRIMARY KEY,
        staff_id INTEGER NOT NULL REFERENCES staff(id),
        class_id INTEGER NOT NULL,
        session TEXT NOT NULL
      );
      INSERT INTO schools(id) VALUES (1);
      INSERT INTO staff(id, school_id, staff_id, first_name, last_name, role)
        VALUES (1, 1, 'staff-001', 'Existing', 'Staff', 'Teacher');
      INSERT INTO class_assignments(id, staff_id, class_id, session)
        VALUES (10, 1, 20, '2026/2027');
    `);
    const staffBefore = await client.query('SELECT * FROM staff ORDER BY id');
    const assignmentsBefore = await client.query('SELECT * FROM class_assignments ORDER BY id');
    const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
      '20261122_staff_information.postgres.sql'), 'utf8');
    await client.query(migration);
    await client.query(migration);

    const staffAfter = await client.query('SELECT * FROM staff ORDER BY id');
    const assignmentsAfter = await client.query('SELECT * FROM class_assignments ORDER BY id');
    assert.deepStrictEqual(staffAfter.rows, staffBefore.rows, 'existing staff rows must be preserved');
    assert.deepStrictEqual(assignmentsAfter.rows, assignmentsBefore.rows,
      'existing assignment rows must be preserved');

    const tables = ['staff_personal_details', 'staff_employment_details',
      'staff_emergency_contacts', 'staff_qualifications'];
    for (const table of tables) {
      const result = await client.query('SELECT COUNT(*)::int AS count FROM ' + table);
      assert.strictEqual(result.rows[0].count, 0, table + ' must not backfill invented data');
    }

    await client.query(`
      INSERT INTO staff_personal_details (school_id, staff_id, phone)
      VALUES (1, 1, '08000000000');
      INSERT INTO staff_employment_details (school_id, staff_id, department)
      VALUES (1, 1, 'Academics');
      INSERT INTO staff_emergency_contacts
        (school_id, staff_id, contact_name, phone, is_primary)
      VALUES (1, 1, 'Primary Contact', '08000000001', TRUE);
      INSERT INTO staff_qualifications
        (school_id, staff_id, qualification, verification_status)
      VALUES (1, 1, 'BSc', 'pending');
    `);

    await assert.rejects(
      () => client.query(`INSERT INTO staff_emergency_contacts
        (school_id, staff_id, contact_name, phone, is_primary)
        VALUES (1, 1, 'Second Primary', '08000000002', TRUE)`),
      error => error.code === '23505'
    );
    await assert.rejects(
      () => client.query(`INSERT INTO staff_qualifications
        (school_id, staff_id, qualification, verification_status)
        VALUES (1, 1, 'MSc', 'verified')`),
      error => error.code === '23514'
    );
    await assert.rejects(
      () => client.query(`INSERT INTO staff_personal_details (school_id, staff_id)
        VALUES (1, 999999)`),
      error => error.code === '23503'
    );

    await client.query(`UPDATE staff_qualifications
      SET verification_status = 'verified', verified_at = CURRENT_TIMESTAMP
      WHERE staff_id = 1`);
    const verified = await client.query(
      'SELECT verification_status, verified_at FROM staff_qualifications WHERE staff_id = 1');
    assert.strictEqual(verified.rows[0].verification_status, 'verified');
    assert.ok(verified.rows[0].verified_at);

    const fkTypes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'staff_personal_details'
        AND column_name = 'staff_id'`, [schema]);
    assert.strictEqual(fkTypes.rows[0].data_type, 'integer',
      'staff foreign key type must match SERIAL/INTEGER staff.id');

    console.log('[staff-information-postgres] migration, rerun, preservation, FK types and constraints passed.');
  } finally {
    await client.query('SET search_path TO public');
    await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    client.release();
    await pool.end();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
