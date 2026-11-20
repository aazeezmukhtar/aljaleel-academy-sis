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
const { createAttendanceAnalyticsService, calculateAttendanceSummary } =
  require('../services/attendanceAnalyticsService');
const { createAttendanceAnalyticsDashboardService } =
  require('../services/attendanceAnalyticsDashboardService');

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
    const notificationMigration = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '20261120_shared_notification_deliveries.sqlite.sql'),
      'utf8'
    );
    sqlite.exec(notificationMigration);
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
    assert.strictEqual(firstReminderRun.scheduledCount, 2,
      'the scheduler should persist the due first stage and the future escalation stage');
    const firstReminderRows = await db.all(
      'SELECT recipient_staff_id, reminder_stage, reminder_type, status FROM attendance_register_reminders WHERE register_id = ? ORDER BY reminder_stage',
      [reminderRegister.id]
    );
    assert.strictEqual(firstReminderRows.length, 2,
      'the next escalation stage should be queued before its due time');
    assert.strictEqual(String(firstReminderRows[0].recipient_staff_id), '20');
    assert.strictEqual(Number(firstReminderRows[0].reminder_stage), 1);
    assert.strictEqual(firstReminderRows[0].reminder_type, 'responsible_teacher');
    assert.strictEqual(firstReminderRows[0].status, 'sent',
      'the scheduler must publish due reminders through the shared delivery queue');
    assert.strictEqual(Number(firstReminderRows[1].reminder_stage), 2);
    assert.strictEqual(firstReminderRows[1].reminder_type, 'administrator_escalation');
    assert.strictEqual(firstReminderRows[1].status, 'pending',
      'the future escalation remains pending until its scheduled time');
    const firstDelivery = await db.get(`
      SELECT status, recipient_type, recipient_id, delivered_at
      FROM notification_deliveries
      WHERE source_type = 'attendance_register_reminder' AND source_id = (
        SELECT id FROM attendance_register_reminders
        WHERE register_id = ? AND recipient_staff_id = 20 AND reminder_stage = 1
      )
    `, [reminderRegister.id]);
    assert.strictEqual(firstDelivery.status, 'delivered');
    assert.strictEqual(firstDelivery.recipient_type, 'staff');
    assert.strictEqual(String(firstDelivery.recipient_id), '20');
    assert(firstDelivery.delivered_at);
    const duplicateReminderRun = await reminderService.scheduleDueReminders({
      now: '2026-11-25T13:00:00.000Z'
    });
    assert.strictEqual(duplicateReminderRun.scheduledCount, 0,
      'repeated scheduler runs must not duplicate a reminder stage');
    assert.strictEqual(
      Number((await db.get(`
        SELECT COUNT(*) AS count FROM notification_deliveries
        WHERE source_type = 'attendance_register_reminder' AND source_id = (
          SELECT id FROM attendance_register_reminders
          WHERE register_id = ? AND recipient_staff_id = 20 AND reminder_stage = 1
        )
      `, [reminderRegister.id])).count),
      1,
      'repeated scheduler runs must not duplicate the in-app delivery'
    );
    const teacherDelivery = await reminderService.deliverDueRemindersForStaff({
      staffId: 20, now: '2026-11-25T13:00:00.000Z'
    });
    assert.strictEqual(teacherDelivery.length, 0,
      'a reminder already published by the scheduler must not be delivered again from the staff feed');
    const escalationRun = await reminderService.scheduleDueReminders({
      now: '2026-11-25T14:00:00.000Z'
    });
    assert.strictEqual(escalationRun.scheduledCount, 0,
      'the future escalation was already queued by the earlier scheduler run');
    const adminDelivery = await reminderService.deliverDueRemindersForStaff({
      staffId: 21, now: '2026-11-25T14:00:00.000Z'
    });
    assert.strictEqual(adminDelivery.length, 0,
      'administrator escalation must also be published by the scheduler');
    const adminReminder = await db.get(
      'SELECT status FROM attendance_register_reminders WHERE register_id = ? AND recipient_staff_id = ? AND reminder_stage = 2',
      [reminderRegister.id, 21]
    );
    assert.strictEqual(adminReminder.status, 'sent',
      'the scheduler must publish the escalation when its scheduled time arrives');
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

    await db.run(
      'UPDATE class_attendance_settings SET first_reminder_delay_minutes = 30 WHERE school_id = ? AND class_id = ?',
      [1, 40]
    );
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
    const cancelledDelivery = await db.get(`
      SELECT status FROM notification_deliveries
      WHERE source_type = 'attendance_register_reminder'
        AND source_id = (
          SELECT id FROM attendance_register_reminders WHERE register_id = ?
        )
    `, [pendingRegister.id]);
    assert.strictEqual(cancelledDelivery.status, 'cancelled',
      'a queued future delivery must be cancelled when the register is submitted');

    const analytics = createAttendanceAnalyticsService(db);
    await db.run("INSERT INTO sections(id, school_id, name) VALUES (11, 1, 'Tahfeez')");
    await db.run("INSERT INTO classes(id, school_id, section_id, name) VALUES (41, 1, 11, 'Tahfeez 1')");
    const analyticsRegister = await db.get(`
      INSERT INTO attendance_registers
        (school_id, class_id, section_id, academic_period_id, schedule_id, responsibility_id,
         register_date, timezone, submission_deadline_at, status, expected_student_count,
         submitted_student_count, first_submitted_at, last_submitted_at, submitted_by)
      VALUES (1, 40, 10, ?, ?, ?, '2026-11-30', 'Africa/Lagos',
              '2026-11-30T13:00:00.000Z', 'submitted', 2, 2,
              '2026-11-30T13:10:00.000Z', '2026-11-30T13:10:00.000Z', 20)
      RETURNING id
    `, [registerTemplate.academic_period_id, registerTemplate.schedule_id, registerTemplate.responsibility_id]);
    await db.run(`
      INSERT INTO attendance_register_students (register_id, student_id, enrollment_period_id)
      VALUES (?, 30, 100)
    `, [analyticsRegister.id]);
    await db.run(`
      INSERT INTO attendance_register_students (register_id, student_id, enrollment_period_id)
      VALUES (?, 31, 101)
    `, [analyticsRegister.id]);
    await db.run(`
      INSERT INTO attendance
        (student_id, class_id, section_id, date, status, session, term)
      VALUES (30, 40, 10, '2026-11-29', 'Late', '2026/2027', '1st Term'),
             (31, 40, 10, '2026-11-29', 'Absent', '2026/2027', '1st Term'),
             (30, 40, 10, '2026-11-30', 'Present', '2026/2027', '1st Term'),
             (31, 40, 10, '2026-11-30', 'Leave', '2026/2027', '1st Term'),
             (30, 41, 11, '2026-11-30', 'Absent', '2026/2027', '1st Term')
    `);
    const incompleteAnalyticsRegister = await db.get(`
      INSERT INTO attendance_registers
        (school_id, class_id, section_id, academic_period_id, schedule_id, responsibility_id,
         register_date, timezone, submission_deadline_at, status, expected_student_count, submitted_student_count)
      VALUES (1, 40, 10, ?, ?, ?, '2026-12-01', 'Africa/Lagos',
              '2026-12-01T13:00:00.000Z', 'in_progress', 2, 0)
      RETURNING id
    `, [registerTemplate.academic_period_id, registerTemplate.schedule_id, registerTemplate.responsibility_id]);
    await db.run(`
      INSERT INTO attendance
        (student_id, class_id, section_id, date, status, session, term)
      VALUES (30, 40, 10, '2026-12-01', 'Absent', '2026/2027', '1st Term')
    `);

    const studentAnalyticsRows = await analytics.getStudentAttendanceRecords({
      schoolId: 1, studentId: 30, sectionId: 10,
      startDate: '2026-11-29', endDate: '2026-12-01'
    });
    assert.strictEqual(studentAnalyticsRows.length, 2,
      'student analytics must exclude partial register saves and other sections');
    assert.deepStrictEqual(studentAnalyticsRows.map(row => row.status).sort(), ['Late', 'Present']);
    const leaveAnalyticsRows = await analytics.getStudentAttendanceRecords({
      schoolId: 1, studentId: 31, sectionId: 10,
      startDate: '2026-11-29', endDate: '2026-12-01'
    });
    const leaveSummary = calculateAttendanceSummary(leaveAnalyticsRows, 80);
    assert.strictEqual(leaveSummary.attendanceRate, 50,
      'approved Leave receives full attendance credit while Absent receives none');
    assert.strictEqual(leaveSummary.belowThreshold, true);
    const classAnalytics = await analytics.getClassAttendanceReport({
      schoolId: 1, classId: 40, sectionId: 10,
      startDate: '2026-11-29', endDate: '2026-12-01'
    });
    assert.strictEqual(classAnalytics.threshold, 80);
    assert.strictEqual(classAnalytics.rows.length, 2);
    const student30Report = classAnalytics.rows.find(row => String(row.student_id) === '30');
    const student31Report = classAnalytics.rows.find(row => String(row.student_id) === '31');
    assert.strictEqual(student30Report.attendanceRate, 100);
    assert.strictEqual(student30Report.totalDays, 2);
    assert.strictEqual(student31Report.attendanceRate, 50);
    assert.strictEqual(student31Report.leave, 1);
    assert.strictEqual(student31Report.belowThreshold, true);
    assert.strictEqual(classAnalytics.registerCompletion.generatedRegisters, 2);
    assert.strictEqual(classAnalytics.registerCompletion.submittedRegisters, 1);
    assert.strictEqual(classAnalytics.registerCompletion.pendingRegisters, 1);

    const thresholdFailureDb = {
      DB_TYPE: db.DB_TYPE,
      all: (...args) => db.all(...args),
      get: (sql, ...args) => {
        if (sql.includes('SELECT low_attendance_threshold')) {
          throw new Error('simulated threshold settings lookup failure');
        }
        return db.get(sql, ...args);
      },
      run: (...args) => db.run(...args),
      transaction: (...args) => db.transaction(...args)
    };
    const thresholdFailureAnalytics = createAttendanceAnalyticsService(thresholdFailureDb);
    const thresholdFailureReport = await thresholdFailureAnalytics.getClassAttendanceReport({
      schoolId: 1, classId: 40, sectionId: 10,
      startDate: '2026-11-29', endDate: '2026-12-01'
    });
    assert.strictEqual(thresholdFailureReport.threshold, null);
    assert.match(thresholdFailureReport.thresholdError, /alerts may be incomplete/i);
    assert.strictEqual(thresholdFailureReport.rows.length, 2,
      'attendance figures must remain available when only the threshold lookup fails');
    assert.strictEqual(classAnalytics.registerCompletion.completionRate, 50);
    await db.run(`
      UPDATE class_attendance_schedules SET effective_to = '2026-11-28'
      WHERE school_id = 1 AND class_id = 40 AND weekday = ?
        AND effective_from = '2026-09-01'
    `, [isoWeekday('2026-11-19')]);
    await db.run(`
      UPDATE class_attendance_schedules SET effective_to = '2026-11-30'
      WHERE school_id = 1 AND class_id = 40 AND weekday = ?
        AND effective_from = '2026-09-01'
    `, [isoWeekday('2026-11-25')]);
    await db.run(`
      INSERT INTO class_attendance_schedules
        (school_id, class_id, section_id, weekday, effective_from, created_by)
      VALUES (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-09-01', 20),
             (1, 40, 10, ?, '2026-12-01', 20)
    `, [
      isoWeekday('2026-11-29'), isoWeekday('2026-11-30'),
      isoWeekday('2026-12-01'), isoWeekday('2026-12-04'),
      isoWeekday('2026-12-02')
    ]);
    await db.run(`
      INSERT INTO class_attendance_closures
        (school_id, scope_type, section_id, start_date, end_date, reason,
         status, requested_by, approved_by, approved_at)
      VALUES (1, 'section', 10, '2026-12-04', '2026-12-04',
              'Approved section-wide closure.', 'approved', 20, 21, '2026-11-28T10:00:00Z')
    `);
    await db.run(`
      INSERT INTO attendance
        (student_id, class_id, section_id, date, status, session, term)
      VALUES (31, 40, 10, '2026-12-02', 'Absent', '2026/2027', '1st Term')
    `);

    const dashboardService = createAttendanceAnalyticsDashboardService(db, analytics);
    const dashboard = await dashboardService.getDashboard({
      schoolId: 1, sectionId: 10, session: '2026/2027', term: '1st Term',
      startDate: '2026-11-29', endDate: '2026-12-04', classIds: [40]
    });
    assert.strictEqual(dashboard.registerCompletion.expectedClassDays, 4,
      'effective-dated schedules and approved section closures define expected class-days');
    assert.strictEqual(dashboard.registerCompletion.submittedRegisters, 1);
    assert.strictEqual(dashboard.registerCompletion.incompleteRegisters, 1);
    assert.strictEqual(dashboard.registerCompletion.missingRegisters, 2);
    assert.strictEqual(dashboard.registerCompletion.completionRate, 25);
    assert.strictEqual(dashboard.overview.attendanceRate, 60);
    assert.strictEqual(dashboard.overview.lateArrivals, 1);
    assert.strictEqual(dashboard.overview.absences, 2);
    assert.strictEqual(dashboard.overview.leaveDays, 1);
    assert.strictEqual(dashboard.lowAttendanceStudents.length, 1);
    assert.strictEqual(String(dashboard.lowAttendanceStudents[0].studentId), '31');
    assert.strictEqual(dashboard.topLateStudents[0].late, 1);
    assert.strictEqual(dashboard.dailySummary.length, 4);
    assert(!dashboard.dailySummary.some(day => day.date === '2026-12-04'),
      'approved section closures must not appear as expected class-days');

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
