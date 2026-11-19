'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createAttendanceRegisterService, isoWeekday } =
  require('../services/attendanceRegisterGenerationService');
const { createAttendanceRegisterWorkflowService } =
  require('../services/attendanceRegisterWorkflowService');
const { createAttendanceRegisterAdministrationService } =
  require('../services/attendanceRegisterAdministrationService');
const { createAttendanceClosureService } =
  require('../services/attendanceClosureService');
const { createAttendanceRegisterReminderService } =
  require('../services/attendanceRegisterReminderService');

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
      CREATE TABLE sections(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), name TEXT);
      CREATE TABLE staff(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), role TEXT, first_name TEXT, last_name TEXT);
      CREATE TABLE students(
        id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id),
        status TEXT, first_name TEXT, last_name TEXT, admission_number TEXT, passport_photo_path TEXT
      );
      CREATE TABLE classes(id INTEGER PRIMARY KEY, school_id INTEGER REFERENCES schools(id), section_id INTEGER REFERENCES sections(id), name TEXT);
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
      INSERT INTO sections VALUES (10, 1, 'Academy');
      INSERT INTO staff(id, school_id, role, first_name, last_name) VALUES (20, 1, 'Teacher', 'Amina', 'Teacher'), (21, 1, 'Admin', 'School', 'Admin');
      INSERT INTO students VALUES
        (30, 1, 'active', 'Amina', 'Adamu', 'A001', NULL),
        (31, 1, 'active', 'Bello', 'Musa', 'A002', NULL);
      INSERT INTO classes VALUES (40, 1, 10, 'Primary 1');
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

    const administration = createAttendanceRegisterAdministrationService(db);
    await assert.rejects(
      () => administration.reopenRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19',
        actorStaffId: 20, reason: 'Correction requested by the school administrator.'
      }),
      /Only an administrator may reopen/
    );
    await assert.rejects(
      () => administration.reopenRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19',
        actorStaffId: 20, reason: ''
      }),
      /correction reason is required/
    );
    const reopened = await administration.reopenRegister({
      schoolId: 1, classId: 40, registerDate: '2026-11-19',
      actorStaffId: 21, reason: 'Correction requested by the school administrator.'
    });
    assert.strictEqual(reopened.status, 'reopened');
    assert.strictEqual(reopened.submittedStudentCount, 0);
    assert.strictEqual(
      sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_register_events WHERE register_id = ? AND event_type = 'reopened' AND actor_staff_id = 21")
        .get(generated.registerId).count,
      1
    );
    assert.strictEqual(
      sqlite.prepare("SELECT COUNT(*) AS count FROM attendance_foundation_audit_logs WHERE entity_type = 'attendance_register' AND action = 'register_reopened' AND actor_staff_id = 21 AND reason = 'Correction requested by the school administrator.'")
        .get().count,
      1
    );
    await assert.rejects(
      () => administration.reopenRegister({
        schoolId: 1, classId: 40, registerDate: '2026-11-19',
        actorStaffId: 21, reason: 'Duplicate reopen attempt.'
      }),
      /Only a submitted attendance register can be reopened/
    );
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

    sqlite.prepare(`
      INSERT INTO class_attendance_closures
        (school_id, scope_type, section_id, class_id, start_date, end_date, reason,
         status, requested_by, approved_by, approved_at)
      VALUES (1, 'class', 10, 40, '2026-11-19', '2026-11-19', 'Approved closure',
              'approved', 20, 20, '2026-11-18T10:00:00Z')
    `).run();
    const closedContext = await workflow.getRegisterContext({
      schoolId: 1, classId: 40, registerDate: '2026-11-19'
    });
    assert.strictEqual(closedContext.blockedReason, 'approved_closure');
    await assert.rejects(
      () => workflow.saveRegisterProgress({
        schoolId: 1, classId: 40, registerDate: '2026-11-19', actorStaffId: 20,
        attendance: { 30: 'Present' }
      }),
      /approved closure prevents attendance changes/
    );

    const closures = createAttendanceClosureService(db);
    const closureRequest = await closures.requestClosure({
      schoolId: 1, actorStaffId: 20, scopeType: 'class', classId: 40,
      startDate: '2026-11-20', endDate: '2026-11-20',
      reason: 'Class closure requested due to an urgent maintenance issue.'
    });
    assert.strictEqual(closureRequest.status, 'pending');
    const pendingClosures = await closures.listClosures({ schoolId: 1, actorStaffId: 20, status: 'pending' });
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
    const adminOnlyClosure = await closures.requestClosure({
      schoolId: 1, actorStaffId: 21, scopeType: 'school',
      startDate: '2026-11-24', endDate: '2026-11-24',
      reason: 'School-wide closure for a scheduled maintenance day.'
    });
    const teacherVisibleClosures = await closures.listClosures({ schoolId: 1, actorStaffId: 20 });
    assert(!teacherVisibleClosures.some(item => String(item.id) === String(adminOnlyClosure.closureId)),
      'class teachers must not see unrelated school-wide closure requests');
    const adminVisibleClosures = await closures.listClosures({ schoolId: 1, actorStaffId: 21 });
    assert(adminVisibleClosures.some(item => String(item.id) === String(adminOnlyClosure.closureId)),
      'administrators must be able to review school-wide closure requests');

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
    const reminderService = createAttendanceRegisterReminderService(db);
    const registerTemplate = await db.get(
      'SELECT academic_period_id, schedule_id, responsibility_id FROM attendance_registers WHERE school_id = ? AND class_id = ? ORDER BY id LIMIT 1',
      [1, 40]
    );
    await db.run(`
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ?, '2026-09-01', 20)
    `, [isoWeekday('2026-11-25')]);
    const firstReminderRun = await reminderService.scheduleDueReminders({
      now: '2026-11-25T13:00:00.000Z'
    });
    assert.strictEqual(firstReminderRun.generatedRegisterCount, 1,
      'the scheduler must generate a missing register for a scheduled class day');
    const reminderRegister = await db.get(
      "SELECT id FROM attendance_registers WHERE school_id = ? AND class_id = ? AND register_date = ?",
      [1, 40, '2026-11-25']
    );
    assert(reminderRegister, 'missing scheduled register must be created before its reminder');
    assert.strictEqual(firstReminderRun.scheduledCount, 1,
      'stage one should be scheduled immediately after the deadline');
    const firstReminderRows = await db.all(
      'SELECT recipient_staff_id, reminder_stage, reminder_type, status FROM attendance_register_reminders WHERE register_id = ?',
      [reminderRegister.id]
    );
    assert.strictEqual(firstReminderRows.length, 1);
    assert.strictEqual(String(firstReminderRows[0].recipient_staff_id), '20');
    assert.strictEqual(Number(firstReminderRows[0].reminder_stage), 1);
    assert.strictEqual(firstReminderRows[0].reminder_type, 'responsible_teacher');
    assert.strictEqual(firstReminderRows[0].status, 'pending');
    const duplicateReminderRun = await reminderService.scheduleDueReminders({
      now: '2026-11-25T13:00:00.000Z'
    });
    assert.strictEqual(duplicateReminderRun.scheduledCount, 0,
      'repeated scheduler runs must not duplicate a reminder stage');
    const teacherDelivery = await reminderService.deliverDueRemindersForStaff({
      staffId: 20, now: '2026-11-25T13:00:00.000Z'
    });
    assert.strictEqual(teacherDelivery.length, 1);
    const escalationRun = await reminderService.scheduleDueReminders({
      now: '2026-11-25T14:00:00.000Z'
    });
    assert.strictEqual(escalationRun.scheduledCount, 1,
      'the configured 60-minute interval should escalate to administrators');
    const adminDelivery = await reminderService.deliverDueRemindersForStaff({
      staffId: 21, now: '2026-11-25T14:00:00.000Z'
    });
    assert.strictEqual(adminDelivery.length, 1);
    const teacherReminder = await db.get(
      'SELECT id FROM attendance_register_reminders WHERE register_id = ? AND recipient_staff_id = ? AND reminder_stage = 1',
      [reminderRegister.id, 20]
    );
    assert.strictEqual(await reminderService.acknowledgeReminder({
      staffId: 20, reminderId: teacherReminder.id
    }), true);
    const acknowledged = await db.get(
      'SELECT status, acknowledged_at FROM attendance_register_reminders WHERE id = ?',
      [teacherReminder.id]
    );
    assert.strictEqual(acknowledged.status, 'acknowledged');
    assert(acknowledged.acknowledged_at);

    const pendingRegister = await db.get(`
      INSERT INTO attendance_registers
        (school_id, class_id, section_id, academic_period_id, schedule_id, responsibility_id,
         register_date, timezone, submission_deadline_at, expected_student_count,
         submitted_student_count, status)
      VALUES (1, 40, 10, ?, ?, ?, '2026-11-26', 'Africa/Lagos',
              '2026-11-26T13:00:00.000Z', 2, 0, 'expected')
      RETURNING id
    `, [registerTemplate.academic_period_id, registerTemplate.schedule_id, registerTemplate.responsibility_id]);
    await reminderService.scheduleDueReminders({ now: '2026-11-26T13:00:00.000Z' });
    await db.run(`
      UPDATE attendance_registers
      SET status = 'submitted', submitted_student_count = expected_student_count,
          first_submitted_at = '2026-11-26T13:10:00.000Z',
          last_submitted_at = '2026-11-26T13:10:00.000Z', submitted_by = 20
      WHERE id = ?
    `, [pendingRegister.id]);
    await reminderService.scheduleDueReminders({ now: '2026-11-26T14:00:00.000Z' });
    const cancelledPendingReminder = await db.get(
      'SELECT status FROM attendance_register_reminders WHERE register_id = ?',
      [pendingRegister.id]
    );
    assert.strictEqual(cancelledPendingReminder.status, 'cancelled',
      'pending reminders must be cancelled after server-confirmed submission');

    const closureAudit = await db.get(
      "SELECT COUNT(*) AS count FROM attendance_foundation_audit_logs WHERE entity_type = 'attendance_closure'",
      []
    );
    assert(Number(closureAudit.count) >= 5);

    console.log('[attendance-register-workflow] roster retrieval, partial save, deliberate submission, locked state, unmarking and correction audit checks passed.');
  } finally {
    sqlite.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
