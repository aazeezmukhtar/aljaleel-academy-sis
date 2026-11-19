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
    term: required(value.term, 'Academic term')
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
}
async function roster(ctx, client) {
  return db.all(`
    SELECT s.id
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
    ORDER BY s.id
  `, [ctx.schoolId, ctx.classId, ctx.session, ctx.classId, ctx.session], client);
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
    const result = await saveRows(ctx, input, client);
    if (result.rosterCount === 0) throw new Error('An empty class roster cannot be submitted.');
    if (result.savedCount !== result.rosterCount ||
        result.rosterIds.some(id => !Object.prototype.hasOwnProperty.call(input.attendance || {}, id))) {
      throw conflict('The register is incomplete. Every student on the current class roster must have a status before submission.');
    }
    const version = Number(register.submission_version || 0) + 1;
    await db.run(`UPDATE attendance_registers SET status = 'submitted',
      submission_version = ?, submitted_at = CURRENT_TIMESTAMP, submitted_by = ?,
      reopened_at = NULL, reopened_by = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'open'`, [version, ctx.actorId, register.id], client);
    await db.run(`INSERT INTO attendance_register_events
      (register_id, school_id, action, version, reason, actor_id)
      VALUES (?, ?, 'submitted', ?, ?, ?)`,
    [register.id, ctx.schoolId, version, reason, ctx.actorId], client);
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
    await db.run(`UPDATE attendance_registers SET status = 'open',
      reopened_at = CURRENT_TIMESTAMP, reopened_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'submitted'`, [ctx.actorId, register.id], client);
    await db.run(`INSERT INTO attendance_register_events
      (register_id, school_id, action, version, reason, actor_id)
      VALUES (?, ?, 'reopened', ?, ?, ?)`,
    [register.id, ctx.schoolId, version, reason, ctx.actorId], client);
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
  const events = await db.all(`SELECT id, action, version, reason, actor_id, created_at
    FROM attendance_register_events WHERE school_id = ? AND register_id = ?
    ORDER BY id ASC`, [ctx.schoolId, register.id]);
  return { ...register, events };
}

module.exports = { saveDraft, submit, reopen, getRegister, validDate };
