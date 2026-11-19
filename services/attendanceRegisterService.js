'use strict';

const db = require('../utils/db');

const VALID_STATUSES = new Set(['Present', 'Absent', 'Late', 'Leave']);
const idOk = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function validDate(value) {
  const day = String(value || '');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T00:00:00Z') : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new Error('A valid attendance date in YYYY-MM-DD format is required.');
  }
  return day;
}
function required(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(label + ' is required.');
  return result;
}
function conflict(message) {
  const error = new Error(message);
  error.code = 'ATTENDANCE_REGISTER_CONFLICT';
  return error;
}
function context(input) {
  const value = input || {};
  if (!idOk(value.schoolId) || !idOk(value.classId) || !idOk(value.sectionId) || !idOk(value.actorId)) {
    throw new Error('Valid school, class, section and acting staff IDs are required.');
  }
  return {
    schoolId: Number(value.schoolId), classId: Number(value.classId),
    sectionId: Number(value.sectionId), actorId: Number(value.actorId),
    date: validDate(value.date), session: required(value.session, 'Academic session'),
    term: required(value.term, 'Academic term'), actorRole: String(value.actorRole || '')
  };
}
async function lockClass(ctx, client) {
  const suffix = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
  const row = await db.get(`SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?${suffix}`,
    [ctx.classId, ctx.schoolId], client);
  if (!row || Number(row.section_id) !== ctx.sectionId) {
    throw new Error('Class and section do not belong to the selected school context.');
  }
  const actor = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?',
    [ctx.actorId, ctx.schoolId], client);
  if (!actor) throw new Error('The acting staff member does not belong to this school.');
  if (ctx.actorRole !== 'Admin') {
    const responsibility = await db.get(`SELECT id FROM class_attendance_responsibilities
      WHERE school_id = ? AND class_id = ? AND staff_id = ? AND session = ?
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [ctx.schoolId, ctx.classId, ctx.actorId, ctx.session, ctx.date, ctx.date], client);
    if (!responsibility) {
      const error = new Error('You are not the assigned attendance register holder for this class and date.');
      error.code = 'ATTENDANCE_REGISTER_FORBIDDEN';
      throw error;
    }
  }
}
async function roster(ctx, client) {
  // Dated placement history is authoritative for the register date. Current
  // session assignments are used only to detect unresolved legacy candidates;
  // they never establish historical attendance eligibility.
  const students = await db.all(`
    SELECT DISTINCT s.id
    FROM students s
    JOIN student_enrollment_periods ep
      ON ep.student_id = s.id AND ep.school_id = s.school_id
    WHERE s.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
      AND ep.session = ? AND ep.date_status = 'confirmed'
      AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
      AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
    ORDER BY s.id
  `, [ctx.schoolId, ctx.sectionId, ctx.classId, ctx.session, ctx.date, ctx.date], client);

  const unresolved = await db.get(`
    SELECT COUNT(DISTINCT s.id) AS count
    FROM students s
    WHERE s.school_id = ?
      AND (s.status = 'active' OR s.status = 'Active' OR s.status IS NULL)
      AND (
        EXISTS (
          SELECT 1 FROM student_enrollments se
          WHERE se.student_id = s.id AND se.class_id = ? AND se.session = ?
        )
        OR (
          s.current_class_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM student_enrollments se_current
            WHERE se_current.student_id = s.id AND se_current.session = ?
          )
        )
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM student_enrollment_periods ep
          WHERE ep.school_id = s.school_id AND ep.student_id = s.id
            AND ep.section_id = ? AND ep.class_id = ? AND ep.session = ?
        )
        OR EXISTS (
          SELECT 1 FROM student_enrollment_periods ep
          WHERE ep.school_id = s.school_id AND ep.student_id = s.id
            AND ep.section_id = ? AND ep.class_id = ? AND ep.session = ?
            AND ep.date_status = 'review_needed'
            AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
        )
      )
    `, [
      ctx.schoolId, ctx.classId, ctx.session, ctx.classId, ctx.session,
      ctx.sectionId, ctx.classId, ctx.session,
      ctx.sectionId, ctx.classId, ctx.session, ctx.date, ctx.date
    ], client);

  return { students, unknownEnrollmentCount: Number(unresolved?.count || 0) };
}
async function ensureRegister(ctx, client) {
  await db.run(`INSERT INTO attendance_registers
    (school_id, section_id, class_id, attendance_date, session, term)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(school_id, class_id, section_id, attendance_date, session, term) DO NOTHING`,
  [ctx.schoolId, ctx.sectionId, ctx.classId, ctx.date, ctx.session, ctx.term], client);
  const suffix = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
  const row = await db.get(`SELECT * FROM attendance_registers
    WHERE school_id = ? AND class_id = ? AND section_id = ?
      AND attendance_date = ? AND session = ? AND term = ?${suffix}`,
  [ctx.schoolId, ctx.classId, ctx.sectionId, ctx.date, ctx.session, ctx.term], client);
  if (!row) throw new Error('Attendance register could not be initialized.');
  return row;
}
async function attendanceSnapshot(ctx, client) {
  return db.all(`SELECT student_id, status, reason, reason_type, custom_reason
    FROM attendance WHERE class_id = ? AND section_id = ? AND date = ?
      AND session = ? AND term = ? ORDER BY student_id`,
  [ctx.classId, ctx.sectionId, ctx.date, ctx.session, ctx.term], client);
}
async function saveRows(ctx, input, client) {
  const attendance = input.attendance && typeof input.attendance === 'object' ? input.attendance : {};
  const reasons = input.reasons && typeof input.reasons === 'object' ? input.reasons : {};
  const customReasons = input.custom_reasons && typeof input.custom_reasons === 'object' ? input.custom_reasons : {};
  const rosterResult = await roster(ctx, client);
  const students = rosterResult.students;
  const allowed = new Set(students.map(row => String(row.id)));
  const submittedIds = Object.keys(attendance).filter(studentId =>
    attendance[studentId] !== '' && attendance[studentId] != null
  );
  for (const studentId of submittedIds) {
    if (!/^\d+$/.test(studentId) || !allowed.has(studentId)) {
      throw new Error('The attendance payload contains a student outside the selected class roster.');
    }
    if (!VALID_STATUSES.has(attendance[studentId])) {
      throw new Error('Every supplied student must have a valid attendance status.');
    }
  }
  const sql = `INSERT INTO attendance
    (student_id, class_id, section_id, date, status, session, term, reason, reason_type, custom_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, section_id, date, session, term)
    DO UPDATE SET status = excluded.status, class_id = excluded.class_id,
      reason = excluded.reason, reason_type = excluded.reason_type,
      custom_reason = excluded.custom_reason`;
  for (const studentId of submittedIds) {
    const rawReason = reasons[studentId] || null;
    const customReason = customReasons[studentId] || null;
    const reason = rawReason === 'Other' && customReason ? customReason : rawReason;
    await db.run(sql, [Number(studentId), ctx.classId, ctx.sectionId, ctx.date,
      attendance[studentId], ctx.session, ctx.term, reason, rawReason, customReason], client);
  }
  return {
    rosterCount: students.length,
    savedCount: submittedIds.length,
    rosterIds: students.map(x => String(x.id)),
    unknownEnrollmentCount: rosterResult.unknownEnrollmentCount
  };
}

async function saveDraft(input) {
  const ctx = context(input);
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, async client => {
    await lockClass(ctx, client);
    const register = await ensureRegister(ctx, client);
    if (register.status === 'submitted') throw conflict('This register is submitted and locked. An administrator must reopen it before corrections.');
    const result = await saveRows(ctx, input, client);
    return { registerId: Number(register.id), status: 'open', ...result };
  });
}

async function submit(input) {
  const ctx = context(input);
  const reason = String(input.reason || '').trim() || 'Register submitted';
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, async client => {
    await lockClass(ctx, client);
    const register = await ensureRegister(ctx, client);
    if (register.status === 'submitted') throw conflict('This register has already been submitted.');
    const before = await attendanceSnapshot(ctx, client);
    const reopenedEvent = register.submission_version > 0 ? await db.get(`SELECT old_values FROM attendance_register_events
      WHERE register_id = ? AND action = 'reopened' AND version = ? ORDER BY id DESC LIMIT 1`,
    [register.id, register.submission_version], client) : null;
    const result = await saveRows(ctx, input, client);
    if (result.unknownEnrollmentCount > 0) {
      throw conflict('The register cannot be submitted because ' + result.unknownEnrollmentCount +
        ' active class member(s) have missing or review-needed dated enrollment history for this date. Resolve the enrollment dates before submission.');
    }
    if (result.rosterCount === 0) throw new Error('An empty class roster cannot be submitted.');
    if (result.savedCount !== result.rosterCount ||
        result.rosterIds.some(id => !Object.prototype.hasOwnProperty.call(input.attendance || {}, id))) {
      throw conflict('The register is incomplete. Every student on the current class roster must have a status before submission.');
    }
    const after = await attendanceSnapshot(ctx, client);
    const oldValues = reopenedEvent && reopenedEvent.old_values ? reopenedEvent.old_values : JSON.stringify(before);
    const newValues = JSON.stringify(after);
    const version = Number(register.submission_version || 0) + 1;
    await db.run(`UPDATE attendance_registers SET status = 'submitted',
      submission_version = ?, submitted_at = CURRENT_TIMESTAMP, submitted_by = ?,
      reopened_at = NULL, reopened_by = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'`, [version, ctx.actorId, register.id], client);
    await db.run(`INSERT INTO attendance_register_events
      (register_id, school_id, action, version, reason, old_values, new_values, actor_id)
      VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?)`,
    [register.id, ctx.schoolId, version, reason, oldValues, newValues, ctx.actorId], client);
    return { registerId: Number(register.id), status: 'submitted', version, ...result };
  });
}

async function reopen(input) {
  const ctx = context(input);
  const reason = required(input.reason, 'A correction reason');
  if (String(input.actorRole || '') !== 'Admin') {
    const error = new Error('Only an administrator can reopen a submitted attendance register.');
    error.code = 'ATTENDANCE_REGISTER_FORBIDDEN';
    throw error;
  }
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, async client => {
    await lockClass(ctx, client);
    const register = await ensureRegister(ctx, client);
    if (register.status !== 'submitted') throw conflict('Only a submitted register can be reopened.');
    const version = Number(register.submission_version || 0);
    const oldValues = JSON.stringify(await attendanceSnapshot(ctx, client));
    await db.run(`UPDATE attendance_registers SET status = 'open',
      reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'submitted'`, [ctx.actorId, register.id], client);
    await db.run(`INSERT INTO attendance_register_events
      (register_id, school_id, action, version, reason, old_values, actor_id)
      VALUES (?, ?, 'reopened', ?, ?, ?, ?)`,
    [register.id, ctx.schoolId, version, reason, oldValues, ctx.actorId], client);
    return { registerId: Number(register.id), status: 'open', version };
  });
}

async function getRegister(input) {
  const ctx = context(input);
  const register = await db.get(`SELECT * FROM attendance_registers
    WHERE school_id = ? AND class_id = ? AND section_id = ?
      AND attendance_date = ? AND session = ? AND term = ?`,
  [ctx.schoolId, ctx.classId, ctx.sectionId, ctx.date, ctx.session, ctx.term]);
  if (!register) return null;
  const events = await db.all(`SELECT id, action, version, reason, old_values, new_values, actor_id, created_at
    FROM attendance_register_events WHERE school_id = ? AND register_id = ?
    ORDER BY id ASC`, [ctx.schoolId, register.id]);
  return { ...register, events };
}

module.exports = { saveDraft, submit, reopen, getRegister, validDate };
