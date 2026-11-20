'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
try {
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE schools(id INTEGER PRIMARY KEY);
        CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
        CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
        CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
        CREATE TABLE section_academic_periods(id INTEGER PRIMARY KEY, school_id INTEGER, section_id INTEGER);
        CREATE TABLE class_attendance_schedules(id INTEGER PRIMARY KEY, school_id INTEGER, class_id INTEGER, section_id INTEGER);
        CREATE TABLE class_attendance_responsibilities(id INTEGER PRIMARY KEY);
        CREATE TABLE attendance_registers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_id INTEGER NOT NULL REFERENCES schools(id),
            class_id INTEGER NOT NULL REFERENCES classes(id),
            section_id INTEGER NOT NULL REFERENCES sections(id),
            academic_period_id INTEGER NOT NULL REFERENCES section_academic_periods(id),
            schedule_id INTEGER NOT NULL REFERENCES class_attendance_schedules(id),
            responsibility_id INTEGER REFERENCES class_attendance_responsibilities(id),
            register_date DATE NOT NULL,
            timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
            submission_deadline_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'expected',
            expected_student_count INTEGER NOT NULL DEFAULT 0,
            submitted_student_count INTEGER NOT NULL DEFAULT 0,
            first_submitted_at TEXT,
            last_submitted_at TEXT,
            submitted_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(class_id, section_id, register_date)
        );
        CREATE TABLE attendance_register_events (
            id INTEGER PRIMARY KEY,
            register_id INTEGER NOT NULL REFERENCES attendance_registers(id) ON DELETE RESTRICT
        );
        INSERT INTO schools VALUES (1);
        INSERT INTO sections VALUES (2, 1);
        INSERT INTO classes VALUES (3, 1, 2);
        INSERT INTO staff VALUES (4, 1);
        INSERT INTO section_academic_periods VALUES (5, 1, 2);
        INSERT INTO class_attendance_schedules VALUES (6, 1, 3, 2);
        INSERT INTO attendance_registers
            (id, school_id, class_id, section_id, academic_period_id, schedule_id, register_date, submission_deadline_at)
        VALUES (7, 1, 3, 2, 5, 6, '2026-11-19', '2026-11-19T13:00:00Z');
        INSERT INTO attendance_register_events VALUES (8, 7);
    `);

    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'database', 'migrations', '20261120_attendance_schedule_sets.sqlite.sql'),
        'utf8'
    );
    db.exec(migration);

    const oldRegister = db.prepare('SELECT id, schedule_id, schedule_set_id FROM attendance_registers WHERE id = 7').get();
    assert.deepStrictEqual(oldRegister, { id: 7, schedule_id: 6, schedule_set_id: null });
    assert.strictEqual(db.prepare('SELECT register_id FROM attendance_register_events WHERE id = 8').get().register_id, 7);
    assert.deepStrictEqual(db.pragma('foreign_key_check'), []);

    db.prepare(`
        INSERT INTO attendance_schedule_sets
            (id, school_id, section_id, class_id, scope_type, effective_from)
        VALUES (9, 1, 2, NULL, 'section', '2026-09-07')
    `).run();
    db.prepare('INSERT INTO attendance_schedule_days (schedule_set_id, weekday) VALUES (9, 1), (9, 2), (9, 3), (9, 4), (9, 5)').run();
    db.prepare(`
        INSERT INTO attendance_registers
            (school_id, class_id, section_id, academic_period_id, schedule_set_id,
             register_date, submission_deadline_at)
        VALUES (1, 3, 2, 5, 9, '2026-11-20', '2026-11-20T13:00:00Z')
    `).run();

    assert.throws(() => db.prepare(`
        INSERT INTO attendance_registers
            (school_id, class_id, section_id, academic_period_id, schedule_id, schedule_set_id,
             register_date, submission_deadline_at)
        VALUES (1, 3, 2, 5, 6, 9, '2026-11-21', '2026-11-21T13:00:00Z')
    `).run(), /CHECK constraint failed/);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM attendance_registers').get().count, 2);
    console.log('[attendance-schedule-migration] legacy register and event history preserved; new schedule-set registers accepted.');
} finally {
    db.close();
}
