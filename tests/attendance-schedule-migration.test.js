'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
try {
    db.pragma('foreign_keys = ON');
    db.exec(\`
        CREATE TABLE schools(id INTEGER PRIMARY KEY);
        CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
        CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
        CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
        CREATE TABLE section_academic_periods(id INTEGER PRIMARY KEY);
        CREATE TABLE class_attendance_schedules(id INTEGER PRIMARY KEY);
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
            first_submitted_at TEXT, last_submitted_at TEXT,
            submitted_by INTEGER REFERENCES staff(id),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(class_id, section_id, register_date),
            CHECK ((status = 'submitted' AND first_submitted_at IS NOT NULL
                AND last_submitted_at IS NOT NULL AND submitted_by IS NOT NULL
                AND submitted_student_count = expected_student_count) OR status <> 'submitted')
        );
        CREATE TABLE attendance_register_students(
            id INTEGER PRIMARY KEY, register_id INTEGER NOT NULL REFERENCES attendance_registers(id),
            student_id INTEGER NOT NULL
        );
        CREATE TABLE attendance_register_events(
            id INTEGER PRIMARY KEY, register_id INTEGER NOT NULL REFERENCES attendance_registers(id)
        );
        CREATE TABLE attendance_register_reminders(
            id INTEGER PRIMARY KEY, register_id INTEGER NOT NULL REFERENCES attendance_registers(id)
        );
        INSERT INTO schools VALUES (1);
        INSERT INTO sections VALUES (2, 1);
        INSERT INTO classes VALUES (3, 1, 2);
        INSERT INTO section_academic_periods VALUES (4);
        INSERT INTO class_attendance_schedules VALUES (5);
        INSERT INTO attendance_registers(id, school_id, class_id, section_id, academic_period_id,
            schedule_id, register_date, submission_deadline_at)
            VALUES (6, 1, 3, 2, 4, 5, '2026-11-20', '2026-11-20T13:00:00Z');
        INSERT INTO attendance_register_students VALUES (7, 6, 8);
        INSERT INTO attendance_register_events VALUES (9, 6);
        INSERT INTO attendance_register_reminders VALUES (10, 6);
    \`);

    const migration = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations',
        '20261121_attendance_schedule_sets.sqlite.sql'), 'utf8');
    db.exec(migration);

    const legacy = db.prepare('SELECT id, schedule_id, schedule_set_id FROM attendance_registers WHERE id = 6').get();
    assert.deepStrictEqual(legacy, { id: 6, schedule_id: 5, schedule_set_id: null });
    assert.strictEqual(db.prepare('SELECT register_id FROM attendance_register_students WHERE id = 7').get().register_id, 6);
    assert.strictEqual(db.prepare('SELECT register_id FROM attendance_register_events WHERE id = 9').get().register_id, 6);
    assert.strictEqual(db.prepare('SELECT register_id FROM attendance_register_reminders WHERE id = 10').get().register_id, 6);

    db.prepare('INSERT INTO attendance_schedule_sets(id, school_id, section_id, scope_type, effective_from) VALUES (11, 1, 2, ?, ?)').run('section', '2026-11-21');
    db.prepare('INSERT INTO attendance_schedule_days(schedule_set_id, weekday) VALUES (11, 6), (11, 7)').run();
    db.prepare('INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, schedule_set_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 4, 11, ?, ?)').run('2026-11-21', '2026-11-21T13:00:00Z');

    assert.throws(() => db.prepare('INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 4, ?, ?)').run('2026-11-22', '2026-11-22T13:00:00Z'));
    assert.throws(() => db.prepare('INSERT INTO attendance_registers(school_id, class_id, section_id, academic_period_id, schedule_id, schedule_set_id, register_date, submission_deadline_at) VALUES (1, 3, 2, 4, 5, 11, ?, ?)').run('2026-11-23', '2026-11-23T13:00:00Z'));

    const fkErrors = db.pragma('foreign_key_check');
    assert.deepStrictEqual(fkErrors, [], 'dependent register references must remain valid after rebuild');
    console.log('[attendance-schedule-migration] legacy register references, child foreign keys, new schedule references and XOR constraint passed.');
} finally {
    db.close();
}
