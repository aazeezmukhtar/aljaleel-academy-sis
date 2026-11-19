'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createAttendanceRegisterService, isoWeekday } =
  require('../services/attendanceRegisterGenerationService');
const { createAttendanceRegisterWorkflowService } =
  require('../services/attendanceRegisterWorkflowService');

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');

const db = {
  DB_TYPE: 'sqlite',
  all: async (sql, params = []) => sqlite.prepare(sql).all(params),
  get: async (sql, params = []) => sqlite.prepare(sql).get(params),
  run: async (sql, params = []) => {
    const result = sqlite.prepare(sql).run(params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  },
  transaction: async callback => {
    sqlite.exec('BEGIN');
    try {
      const result = await callback(null);
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
};

(async () => {
  try {
    sqlite.exec(`
      CREATE TABLE schools(id INTEGER PRIMARY KEY);
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE students(
        id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id),
        status TEXT, first_name TEXT, last_name TEXT, admission_number TEXT, passport_photo_path TEXT
      );
      CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
      CREATE TABLE student_enrollment_history(id INTEGER PRIMARY KEY);
      CREATE TABLE student_enrollment_periods(
        id INTEGER PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id),
        student_id INTEGER REFERENCES students(id),
        section_id INTEGER REFERENCES sections(id),
        class_id INTEGER REFERENCES classes(id),
        session TEXT,
        start_date DATE,
        end_date DATE,
        start_event_id INTEGER REFERENCES student_enrollment_history(id),
        end_event_id INTEGER REFERENCES student_enrollment_history(id),
        date_status TEXT
      );
      CREATE TABLE attendance(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER, class_id INTEGER, section_id INTEGER NOT NULL,
        date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL,
        reason TEXT, reason_type TEXT, custom_reason TEXT,
        UNIQUE(student_id, section_id, date, session, term)
      );
      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (10, 1);
      INSERT INTO staff VALUES (20, 1), (21, 1);
      INSERT INTO students VALUES
        (30, 1, 'active', 'Amina', 'Adamu', 'A001', NULL),
        (31, 1, 'active', 'Bello', 'Musa', 'A002', NULL);
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (100, 1, 30, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed'),
               (101, 1, 31, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed');
    `);

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.sqlite.sql'),
      'utf8'
    );
    sqlite.exec(migration);
    sqlite.prepare(`
      INSERT INTO section_academic_periods
        (school_id, section_id, session, term, start_date, end_date, status)
      VALUES (1, 10, '2026/2027', '1st Term', '2026-09-01', '2026-12-20', 'active')
    `).run();
    sqlite.prepare(`
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ?, '2026-09-01', 20)
    `).run(isoWeekday('2026-11-19'));
    sqlite.prepare(`
      INSERT INTO class_attendance_settings
        (school_id, class_id, section_id, effective_from, submission_deadline_time,
         subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by)
      VALUES (1, 40, 10, '2026-09-01', '14:00', '[60]', 80, 20)
    `).run();
    sqlite.prepare(`
      INSERT INTO class_attendance_responsibilities
        (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, created_by)
      VALUES (1, 40, 10, 20, 'primary', '2026-09-01', 20)
    `).run();

    const generator = createAttendanceRegisterService(db);
    const generated = await generator.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(generated.created, true);

    const workflow = createAttendanceRegisterWorkflowService(db);
    assert.strictEqual(await workflow.isFoundationAvailable(), true);

    const context = await workflow.getRegisterContext({
      schoolId: 1, classId: 40, registerDate: '2026-11-19'
    });
    assert.strictEqual(context.students.length, 2);
    assert(context.students.every(student => student.status === null));

    const firstSave = await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 30: 'Present', 31: 'Not recorded' }
    });
    assert.strictEqual(firstSave.status, 'in_progress');
    assert.strictEqual(firstSave.savedStudentCount, 1);

    await assert.rejects(
      () => workflow.submitRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
      }),
      /1 student\(s\) are still unmarked/
    );

    const secondSave = await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 30: 'Present', 31: 'Leave' }
    });
    assert.strictEqual(secondSave.savedStudentCount, 2);
    assert.strictEqual(
      sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_foundation_audit_logs WHERE action = 'attendance_status_created' AND actor_staff_id = 20")
        .get().count,
      2,
      'initial attendance marks must record actor and after-state in the audit log'
    );

    const submitted = await workflow.submitRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
    });
    assert.strictEqual(submitted.status, 'submitted');
    assert.strictEqual(submitted.submittedStudentCount, 2);
    assert.strictEqual(submitted.eventType, 'submitted');

    const storedRegister = sqlite.prepare('SELECT status, submitted_student_count FROM attendance_registers WHERE id = ?')
      .get(generated.registerId);
    assert.deepStrictEqual(storedRegister, { status: 'submitted', submitted_student_count: 2 });

    await assert.rejects(
      () => workflow.saveRegisterProgress({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
        attendance: { 30: 'Absent' }
      }),
      /locked/
    );

    // Simulate an explicitly reopened register to verify a correction can
    // clear a previously stored status back to genuinely unmarked.
    sqlite.prepare(`
      UPDATE attendance_registers
      SET status = 'reopened', submitted_student_count = 0, submitted_by = NULL
      WHERE id = ?
    `).run(generated.registerId);
    const cleared = await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 31: 'Not recorded' }
    });
    assert.strictEqual(cleared.savedStudentCount, 1);
    assert.strictEqual(
      sqlite.prepare('SELECT COUNT(*) AS count FROM attendance WHERE student_id = 31').get().count,
      0
    );
    assert(
      sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_register_events WHERE register_id = ? AND event_type = 'corrected'")
        .get(generated.registerId).count >= 1
    );
    assert.strictEqual(
      sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_foundation_audit_logs WHERE action = 'attendance_status_cleared' AND actor_staff_id = 20")
        .get().count,
      1,
      'clearing a status must preserve its before-state and actor'
    );

    await assert.rejects(
      () => workflow.saveRegisterProgress({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
        attendance: { 999: 'Present' }
      }),
      /not on this register roster/
    );

    console.log('[attendance-register-workflow] roster retrieval, partial save, deliberate submission, locked state, unmarking and correction audit checks passed.');
  } finally {
    sqlite.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
