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
  // Attendance is date-specific. Use only confirmed dated placements so a
  // student transferred mid-session belongs to the correct class on this day.
  // Do not fall back to current_class_id/student_enrollments: those records
  // cannot establish historical class membership without inventing dates.
  const uncertain = await db.get(`
    SELECT COUNT(*) AS count
    FROM student_enrollment_periods ep
    JOIN students s ON s.id = ep.student_id AND s.school_id = ep.school_id
    WHERE ep.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
      AND ep.session = ? AND ep.date_status = 'review_needed'
      AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
  `, [ctx.schoolId, ctx.sectionId, ctx.classId, ctx.session, ctx.date, ctx.date], client);
  if (Number(uncertain && uncertain.count || 0) > 0) {
    throw new Error('The class roster contains enrollment dates requiring review; resolve them before saving attendance.');
  }
  return db.all(`
    SELECT DISTINCT s.id
    FROM student_enrollment_periods ep
    JOIN students s ON s.id = ep.student_id AND s.school_id = ep.school_id
    WHERE ep.school_id = ? AND ep.section_id = ? AND ep.class_id = ?
      AND ep.session = ? AND ep.date_status = 'confirmed'
      AND ep.start_date <= ? AND (ep.end_date IS NULL OR ep.end_date >= ?)
    ORDER BY s.id
  `, [ctx.schoolId, ctx.sectionId, ctx.classId, ctx.session, ctx.date, ctx.date], client);
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
  const students = await roster(ctx, client);
  const allowed = new Set(students.map(row => String(row.id)));
  const submittedIds = Object.keys(attendance);
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
  return { rosterCount: students.length, savedCount: submittedIds.length, rosterIds: students.map(x => String(x.id)) };
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
