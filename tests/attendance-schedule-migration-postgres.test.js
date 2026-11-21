'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.PG_TEST_URL;
if (!url) {
    console.error('[attendance-schedule-postgres] PG_TEST_URL required; refusing application DB fallback.');
    process.exit(1);
}

(async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const schema = 'attendance_schedule_test_' + process.pid;
    try {
        await client.query('CREATE SCHEMA "' + schema + '"');
        await client.query('SET search_path TO "' + schema + '"');
        const setup = [
            'CREATE TABLE schools(id INTEGER PRIMARY KEY)',
            'CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id))',
            'CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), section_id INTEGER NOT NULL REFERENCES sections(id))',
            'CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id))',
            'CREATE TABLE class_attendance_schedules(id BIGSERIAL PRIMARY KEY)',
            'CREATE TABLE section_academic_periods(id BIGSERIAL PRIMARY KEY)',
            'CREATE TABLE class_attendance_responsibilities(id BIGSERIAL PRIMARY KEY)',
            'CREATE TABLE attendance_registers(id BIGSERIAL PRIMARY KEY, school_id INTEGER NOT NULL REFERENCES schools(id), class_id INTEGER NOT NULL REFERENCES classes(id), section_id INTEGER NOT NULL REFERENCES sections(id), academic_period_id BIGINT NOT NULL REFERENCES section_academic_periods(id), schedule_id BIGINT NOT NULL REFERENCES class_attendance_schedules(id), responsibility_id BIGINT REFERENCES class_attendance_responsibilities(id), register_date DATE NOT NULL, timezone TEXT NOT NULL DEFAULT \'Africa/Lagos\', submission_deadline_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT \'expected\', expected_student_count INTEGER NOT NULL DEFAULT 0, submitted_student_count INTEGER NOT NULL DEFAULT 0, first_submitted_at TIMESTAMPTZ, last_submitted_at TIMESTAMPTZ, submitted_by INTEGER REFERENCES staff(id), created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)',
            'INSERT INTO schools VALUES (1)',
            'INSERT INTO sections VALUES (2, 1)',
            'INSERT INTO classes VALUES (3, 1, 2)',
            'INSERT INTO staff VALUES (4, 1)',
            'INSERT INTO class_attendance_schedules DEFAULT VALUES',
            'INSERT INTO section_academic_periods DEFAULT VALUES',
            'INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, schedule_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 1, 1, \'2026-11-20\', \'2026-11-20T13:00:00Z\')'
        ];
        for (const statement of setup) await client.query(statement);

        const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
            '20261121_attendance_schedule_sets.postgres.sql'), 'utf8');
        await client.query(migration);
        await client.query('INSERT INTO attendance_schedule_sets(school_id, section_id, scope_type, effective_from, created_by) VALUES (1, 2, \'section\', \'2026-11-21\', 4)');
        await client.query('INSERT INTO attendance_schedule_days(schedule_set_id, weekday) VALUES (1, 6), (1, 7)');
        await client.query('INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, schedule_set_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 1, 1, \'2026-11-21\', \'2026-11-21T13:00:00Z\')');

        const rows = await client.query('SELECT id, schedule_id, schedule_set_id FROM attendance_registers ORDER BY id');
        assert.deepStrictEqual(rows.rows, [
            { id: '1', schedule_id: '1', schedule_set_id: null },
            { id: '2', schedule_id: null, schedule_set_id: '1' }
        ]);
        await assert.rejects(
            () => client.query('INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, schedule_id, schedule_set_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 1, 1, 1, \'2026-11-22\', \'2026-11-22T13:00:00Z\')'),
            error => error.code === '23514'
        );
        console.log('[attendance-schedule-postgres] legacy register FK, new schedule-set FK and exclusive source constraint passed.');
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
