'use strict';

const assert = require('assert');
const { Pool } = require('pg');
const { createAttendanceRegisterService, isoWeekday } =
  require('../services/attendanceRegisterGenerationService');
const { createAttendanceRegisterWorkflowService } =
  require('../services/attendanceRegisterWorkflowService');
const { createAttendanceRegisterAdministrationService } =
  require('../services/attendanceRegisterAdministrationService');
const { createAttendanceClosureService } =
  require('../services/attendanceClosureService');

const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('[attendance-register-workflow-postgres] PG_TEST_URL required; refusing application DB fallback.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const schema = 'attendance_register_workflow_' + process.pid;
  const convert = sql => {
    let index = 0;
    return sql.replace(/\?/g, () => '$' + (++index));
  };
  const db = {
    DB_TYPE: 'postgres',
    all: async (sql, params = [], tx = null) => (await (tx || client).query(convert(sql), params)).rows,
    get: async (sql, params = [], tx = null) => {
      const result = await (tx || client).query(convert(sql), params);
      return result.rows[0];
    },
    run: async (sql, params = [], tx = null) => {
      const result = await (tx || client).query(convert(sql), params);
      return { changes: result.rowCount, lastInsertRowid: null };
    },
    transaction: async callback => {
      await client.query('BEGIN');
      try {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  };

  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '"');
    await client.query(`
      CREATE TABLE schools(id INTEGER PRIMARY KEY);
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id));
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), role TEXT, first_name TEXT, last_name TEXT);
      CREATE TABLE students(
        id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id),
        status TEXT, first_name TEXT, last_name TEXT, admission_number TEXT, passport_photo_path TEXT
      );
      CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id));
      CREATE TABLE student_enrollment_history(id BIGINT PRIMARY KEY);
      CREATE TABLE student_enrollment_periods(
        id BIGINT PRIMARY KEY,
        school_id BIGINT REFERENCES schools(id),
        student_id BIGINT REFERENCES students(id),
        section_id BIGINT REFERENCES sections(id),
        class_id BIGINT REFERENCES classes(id),
        session TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        start_event_id BIGINT REFERENCES student_enrollment_history(id),
        end_event_id BIGINT REFERENCES student_enrollment_history(id),
        date_status TEXT NOT NULL
      );
      CREATE TABLE attendance(
        id SERIAL PRIMARY KEY,
        student_id INTEGER, class_id INTEGER, section_id INTEGER NOT NULL,
        date DATE NOT NULL, status TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL,
        reason TEXT, reason_type TEXT, custom_reason TEXT,
        UNIQUE(student_id, section_id, date, session, term)
      );
      INSERT INTO schools VALUES (1);
      INSERT INTO sections VALUES (10, 1);
      INSERT INTO staff(id, school_id, role, first_name, last_name) VALUES (20, 1, 'Teacher', 'Amina', 'Teacher'), (21, 1, 'Admin', 'School', 'Admin');
      INSERT INTO students VALUES
        (30, 1, 'active', 'Amina', 'Adamu', 'A001', NULL),
        (31, 1, 'active', 'Bello', 'Musa', 'A002', NULL);
      INSERT INTO classes VALUES (40, 1, 10);
      INSERT INTO student_enrollment_periods
        VALUES (100, 1, 30, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed'),
               (101, 1, 31, 10, 40, '2026/2027', '2026-09-01', NULL, NULL, NULL, 'confirmed');
    `);

    const fs = require('fs');
    const path = require('path');
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261119_attendance_register_foundation.postgres.sql'),
      'utf8'
    );
    await client.query(migration);
    await client.query(`
      INSERT INTO section_academic_periods
        (school_id, section_id, session, term, start_date, end_date, status)
      VALUES (1, 10, '2026/2027', '1st Term', '2026-09-01', '2026-12-20', 'active');
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ${isoWeekday('2026-11-19')}, '2026-09-01', 20);
      INSERT INTO class_attendance_settings
        (school_id, class_id, section_id, effective_from, submission_deadline_time,
         subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by)
      VALUES (1, 40, 10, '2026-09-01', '14:00', '[60]'::jsonb, 80, 20);
      INSERT INTO class_attendance_responsibilities
        (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, created_by)
      VALUES (1, 40, 10, 20, 'primary', '2026-09-01', 20);
    `);

    const generator = createAttendanceRegisterService(db);
    const generated = await generator.generateExpectedRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', generatedBy: 20
    });
    assert.strictEqual(generated.created, true);

    const workflow = createAttendanceRegisterWorkflowService(db);
    const firstSave = await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 30: 'Present', 31: 'Not recorded' }
    });
    assert.strictEqual(firstSave.savedStudentCount, 1);

    await assert.rejects(
      () => workflow.saveRegisterProgress({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 21,
        attendance: { 30: 'Absent' }
      }),
      /responsible class teacher/
    );

    await assert.rejects(
      () => workflow.submitRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
      }),
      /1 student\(s\) are still unmarked/
    );

    await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 31: 'Leave' }
    });
    const createdAudit = await client.query(`
      SELECT COUNT(*) AS count
      FROM attendance_foundation_audit_logs
      WHERE action = 'attendance_status_created' AND actor_staff_id = 20
    `);
    assert.strictEqual(Number(createdAudit.rows[0].count), 2);
    const submitted = await workflow.submitRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
    });
    assert.strictEqual(submitted.status, 'submitted');
    assert.strictEqual(submitted.submittedStudentCount, 2);

    const stored = await client.query(
      'SELECT status, submitted_student_count FROM attendance_registers WHERE id = $1',
      [generated.registerId]
    );
    assert.strictEqual(stored.rows[0].status, 'submitted');
    assert.strictEqual(Number(stored.rows[0].submitted_student_count), 2);

    const administration = createAttendanceRegisterAdministrationService(db);
    await assert.rejects(
      () => administration.reopenRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19',
        actorStaffId: 20, reason: 'Correction requested by the school administrator.'
      }),
      /Only an administrator may reopen/
    );
    const reopened = await administration.reopenRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19',
      actorStaffId: 21, reason: 'Correction requested by the school administrator.'
    });
    assert.strictEqual(reopened.status, 'reopened');
    assert.strictEqual(reopened.submittedStudentCount, 0);
    const reopenAudit = await client.query(`
      SELECT COUNT(*) AS count
      FROM attendance_foundation_audit_logs
      WHERE entity_type = 'attendance_register'
        AND action = 'register_reopened'
        AND actor_staff_id = 21
        AND reason = 'Correction requested by the school administrator.'
    `);
    assert.strictEqual(Number(reopenAudit.rows[0].count), 1);
    await assert.rejects(
      () => administration.reopenRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19',
        actorStaffId: 21, reason: 'Duplicate reopen attempt.'
      }),
      /Only a submitted attendance register can be reopened/
    );
    await workflow.saveRegisterProgress({
      schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
      attendance: { 31: 'Not recorded' }
    });
    const clearedAudit = await client.query(`
      SELECT COUNT(*) AS count
      FROM attendance_foundation_audit_logs
      WHERE action = 'attendance_status_cleared' AND actor_staff_id = 20
    `);
    assert.strictEqual(Number(clearedAudit.rows[0].count), 1);

    await client.query(`
      INSERT INTO class_attendance_closures
        (school_id, scope_type, section_id, class_id, start_date, end_date, reason,
         status, requested_by, approved_by, approved_at)
      VALUES (1, 'class', 10, 40, '2026-11-19', '2026-11-19', 'Approved closure',
              'approved', 20, 20, '2026-11-18T10:00:00Z')
    `);
    const closedContext = await workflow.getRegisterContext({
      schoolId: 1, classId: 40, registerDate: '2026-11-19'
    });
    assert.strictEqual(closedContext.blockedReason, 'approved_closure');
    await assert.rejects(
      () => workflow.submitRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20
      }),
      /approved closure prevents register submission/
    );

    const closures = createAttendanceClosureService(db);
    const closureRequest = await closures.requestClosure({
      schoolId: 1, actorStaffId: 20, scopeType: 'class', classId: 40,
      startDate: '2026-11-20', endDate: '2026-11-20',
      reason: 'Class closure requested due to an urgent maintenance issue.'
    });
    assert.strictEqual(closureRequest.status, 'pending');
    const pendingClosures = await closures.listClosures({ schoolId: 1, status: 'pending' });
    assert(pendingClosures.some(item => String(item.id) === String(closureRequest.closureId)));
    await assert.rejects(
      () => closures.decideClosure({
        schoolId: 1, closureId: closureRequest.closureId, actorStaffId: 20,
        decision: 'approved'
      }),
      /Only an administrator may approve or reject/
    );
    const approvedClosure = await closures.decideClosure({
      schoolId: 1, closureId: closureRequest.closureId, actorStaffId: 21,
      decision: 'approved'
    });
    assert.strictEqual(approvedClosure.status, 'approved');
    await assert.rejects(
      () => closures.requestClosure({
        schoolId: 1, actorStaffId: 21, scopeType: 'section', sectionId: 10,
        startDate: '2026-11-20', endDate: '2026-11-20',
        reason: 'Conflicting section closure.'
      }),
      /overlapping pending or approved closure/
    );
    const rejectionRequest = await closures.requestClosure({
      schoolId: 1, actorStaffId: 20, scopeType: 'class', classId: 40,
      startDate: '2026-11-22', endDate: '2026-11-22',
      reason: 'Request for a one-day class closure.'
    });
    await assert.rejects(
      () => closures.decideClosure({
        schoolId: 1, closureId: rejectionRequest.closureId, actorStaffId: 21,
        decision: 'rejected'
      }),
      /rejection reason is required/
    );
    const rejectedClosure = await closures.decideClosure({
      schoolId: 1, closureId: rejectionRequest.closureId, actorStaffId: 21,
      decision: 'rejected', reason: 'The request conflicts with the academic calendar.'
    });
    assert.strictEqual(rejectedClosure.status, 'rejected');
    const cancelRequest = await closures.requestClosure({
      schoolId: 1, actorStaffId: 20, scopeType: 'class', classId: 40,
      startDate: '2026-11-23', endDate: '2026-11-23',
      reason: 'Temporary classroom repair.'
    });
    const cancelledClosure = await closures.cancelClosure({
      schoolId: 1, closureId: cancelRequest.closureId, actorStaffId: 20
    });
    assert.strictEqual(cancelledClosure.status, 'cancelled');
    const closureAudit = await db.get(
      "SELECT COUNT(*) AS count FROM attendance_foundation_audit_logs WHERE entity_type = 'attendance_closure'",
      []
    );
    assert(Number(closureAudit.count) >= 5);

    console.log('[attendance-register-workflow-postgres] PostgreSQL progress save, unmarked guard, transactional submission, submitted count and responsible-teacher authorization passed.');
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
