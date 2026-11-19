'use strict';

const db = require('../utils/db');

const ENTITY = Object.freeze({
  academic_period: { table: 'section_academic_periods', dateFrom: 'start_date', dateTo: 'end_date', parent: 'section' },
  attendance_schedule: { table: 'class_attendance_schedules', dateFrom: 'effective_from', dateTo: 'effective_to', parent: 'class' },
  attendance_responsibility: { table: 'class_attendance_responsibilities', dateFrom: 'effective_from', dateTo: 'effective_to', parent: 'class' }
});
const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const idOk = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;

function date(value, field) {
  const s = String(value || '');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(s) ||
      new Date(s + 'T00:00:00Z').toISOString?.().slice(0,10) !== s) {
    throw new Error(field + ' must be a valid YYYY-MM-DD date.');
  }
  return s;
}
function interval(from, to, fromName, toName) {
  const start = date(from, fromName);
  const end = to == null || to === '' ? null : date(to, toName);
  if (end && end < start) throw new Error(toName + ' cannot be before ' + fromName + '.');
  return { start, end };
}
function requiredReason(reason) {
  const value = String(reason || '').trim();
  if (!value) throw new Error('A reason is required for every correction or cancellation.');
  return value;
}
function json(value) { return value == null ? null : JSON.stringify(value); }
function conflict(message) { const e = new Error(message); e.code = 'ATTENDANCE_FOUNDATION_CONFLICT'; return e; }

async function actorCheck(schoolId, actorId, client) {
  if (!idOk(schoolId) || !idOk(actorId)) throw new Error('A valid school and acting staff member are required.');
  const actor = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?', [actorId, schoolId], client);
  if (!actor) throw new Error('The acting staff member does not belong to this school.');
}
async function lockParent(kind, schoolId, parentId, client) {
  if (!idOk(parentId)) throw new Error('A valid parent record is required.');
  const table = kind === 'section' ? 'sections' : kind === 'class' ? 'classes' : 'schools';
  const query = db.DB_TYPE === 'postgres'
    ? `SELECT id FROM ${table} WHERE id = ? AND ${table === 'schools' ? 'id' : 'school_id'} = ? FOR UPDATE`
    : `SELECT id FROM ${table} WHERE id = ? AND ${table === 'schools' ? 'id' : 'school_id'} = ?`;
  const row = await db.get(query, [parentId, schoolId], client);
  if (!row) throw new Error('The selected ' + kind + ' does not belong to this school.');
  return row;
}
async function audit(schoolId, type, id, action, oldValues, newValues, reason, actorId, client) {
  await db.run(`INSERT INTO attendance_foundation_audit_logs
    (school_id, entity_type, entity_id, action, old_values, new_values, reason, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [schoolId, type, id, action, json(oldValues), json(newValues), reason, actorId], client);
}
async function insertReturning(sql, params, client) {
  const row = await db.get(sql + ' RETURNING id', params, client);
  if (!row || !row.id) throw new Error('Attendance foundation record could not be verified after insertion.');
  return Number(row.id);
}
async function ensureNoOverlap(type, schoolId, parentId, session, from, to, exceptId, client) {
  const spec = ENTITY[type];
  const parentColumn = spec.parent === 'section' ? 'section_id' : 'class_id';
  const end = to || '9999-12-31';
  const sql = `SELECT id FROM ${spec.table}
    WHERE school_id = ? AND ${parentColumn} = ? AND session = ?
      AND ${spec.dateFrom} <= ? AND COALESCE(${spec.dateTo}, '9999-12-31') >= ?
      AND (? IS NULL OR id <> ?) LIMIT 1`;
  const found = await db.get(sql, [schoolId, parentId, session, end, from, exceptId || null, exceptId || null], client);
  if (found) throw conflict('This effective date range overlaps an existing ' + type.replaceAll('_',' ') + ' record.');
}
async function createPeriod(input, client) {
  const { schoolId, sectionId, session, term, startDate, endDate, createdBy } = input || {};
  if (!String(session || '').trim() || !String(term || '').trim()) throw new Error('Session and term are required.');
  const span = interval(startDate, endDate, 'startDate', 'endDate');
  await actorCheck(schoolId, createdBy, client);
  await lockParent('section', schoolId, sectionId, client);
  // Serialize the whole section/session timeline, including gaps with no existing term rows.
  const overlap = await db.get(`SELECT id FROM section_academic_periods
    WHERE school_id = ? AND section_id = ? AND session = ?
      AND start_date <= ? AND end_date >= ? LIMIT 1`,
  [schoolId, sectionId, session, span.end, span.start], client);
  if (overlap) throw conflict('This academic period overlaps an existing term in the section and session.');
  const id = await insertReturning(`INSERT INTO section_academic_periods
    (school_id, section_id, session, term, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?)`,
  [schoolId, sectionId, session, term, span.start, span.end], client);
  await audit(schoolId, 'academic_period', id, 'created', null,
    { sectionId, session, term, startDate: span.start, endDate: span.end },
    'Academic period configured', createdBy, client);
  return { id };
}
async function createSchedule(input, client) {
  const { schoolId, classId, session, effectiveFrom, effectiveTo = null, weekdays = {}, createdBy } = input || {};
  if (!String(session || '').trim()) throw new Error('Session is required.');
  const span = interval(effectiveFrom, effectiveTo, 'effectiveFrom', 'effectiveTo');
  const flags = Object.fromEntries(WEEKDAYS.map(day => [day, weekdays[day] === true || weekdays[day] === 1]));
  if (!Object.values(flags).some(Boolean)) throw new Error('At least one opening weekday must be selected.');
  await actorCheck(schoolId, createdBy, client);
  await lockParent('class', schoolId, classId, client);
  await ensureNoOverlap('attendance_schedule', schoolId, classId, session, span.start, span.end, null, client);
  const cols = WEEKDAYS.join(', ');
  const marks = WEEKDAYS.map(() => '?').join(', ');
  const id = await insertReturning(`INSERT INTO class_attendance_schedules
    (school_id, class_id, session, effective_from, effective_to, ${cols}, created_by)
    VALUES (?, ?, ?, ?, ?, ${marks}, ?)`,
  [schoolId, classId, session, span.start, span.end, ...WEEKDAYS.map(d => flags[d]), createdBy], client);
  await audit(schoolId, 'attendance_schedule', id, 'created', null,
    { classId, session, effectiveFrom: span.start, effectiveTo: span.end, weekdays: flags },
    'Attendance schedule configured', createdBy, client);
  return { id };
}
async function createResponsibility(input, client) {
  const { schoolId, classId, staffId, session, effectiveFrom, effectiveTo = null, createdBy } = input || {};
  if (!idOk(staffId) || !String(session || '').trim()) throw new Error('Responsible staff member and session are required.');
  const span = interval(effectiveFrom, effectiveTo, 'effectiveFrom', 'effectiveTo');
  await actorCheck(schoolId, createdBy, client);
  await lockParent('class', schoolId, classId, client);
  const assigned = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?', [staffId, schoolId], client);
  if (!assigned) throw new Error('The responsible staff member does not belong to this school.');
  await ensureNoOverlap('attendance_responsibility', schoolId, classId, session, span.start, span.end, null, client);
  const id = await insertReturning(`INSERT INTO class_attendance_responsibilities
    (school_id, class_id, staff_id, session, effective_from, effective_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [schoolId, classId, staffId, session, span.start, span.end, createdBy], client);
  await audit(schoolId, 'attendance_responsibility', id, 'created', null,
    { classId, staffId, session, effectiveFrom: span.start, effectiveTo: span.end },
    'Register responsibility assigned', createdBy, client);
  return { id };
}
async function createClosure(input, client) {
  const { schoolId, scopeType, sectionId = null, classId = null, closureDate, reason, sourceEventId = null, createdBy } = input || {};
  const day = date(closureDate, 'closureDate');
  const why = String(reason || '').trim();
  if (!why) throw new Error('A closure reason is required.');
  await actorCheck(schoolId, createdBy, client);
  await lockParent('school', schoolId, schoolId, client);
  let classSection = null;
  if (scopeType === 'section') {
    if (!idOk(sectionId) || classId != null) throw new Error('Section closure requires only a section target.');
    await lockParent('section', schoolId, sectionId, client);
  } else if (scopeType === 'class') {
    if (!idOk(classId) || sectionId != null) throw new Error('Class closure requires only a class target.');
    classSection = await db.get('SELECT section_id FROM classes WHERE id = ? AND school_id = ?', [classId, schoolId], client);
    if (!classSection) throw new Error('The selected class does not belong to this school.');
  } else if (scopeType === 'school') {
    if (sectionId != null || classId != null) throw new Error('School closure cannot have a narrower target.');
  } else throw new Error('Closure scope must be school, section, or class.');
  if (sourceEventId != null) {
    const event = await db.get('SELECT id, school_id, event_date, section_id FROM term_events WHERE id = ? AND school_id = ?', [sourceEventId, schoolId], client);
    if (!event) throw new Error('The linked calendar event does not belong to this school.');
    if (String(event.event_date).slice(0,10) !== day) throw new Error('The linked calendar event date must match the closure date.');
    const expectedSection = scopeType === 'section' ? Number(sectionId) : scopeType === 'class' ? Number(classSection.section_id) : null;
    if (expectedSection != null && event.section_id != null && Number(event.section_id) !== expectedSection)
      throw new Error('The linked calendar event section does not match the closure scope.');
  }
  const duplicate = await db.get(`SELECT id FROM class_attendance_closures
    WHERE school_id = ? AND closure_date = ? AND scope_type = ? AND status = 'active'
      AND ((? = 'school') OR (? = 'section' AND section_id = ?) OR (? = 'class' AND class_id = ?))
    LIMIT 1`, [schoolId, day, scopeType, scopeType, scopeType, sectionId, scopeType, classId], client);
  if (duplicate) throw conflict('An active closure already exists for this target and date.');
  const id = await insertReturning(`INSERT INTO class_attendance_closures
    (school_id, scope_type, section_id, class_id, closure_date, reason, source_event_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [schoolId, scopeType, sectionId, classId, day, why, sourceEventId, createdBy], client);
  await audit(schoolId, 'attendance_closure', id, 'created', null,
    { scopeType, sectionId, classId, closureDate: day, reason: why, sourceEventId },
    'Attendance closure created', createdBy, client);
  return { id };
}
async function create(type, input) {
  const fn = { academic_period: createPeriod, attendance_schedule: createSchedule,
    attendance_closure: createClosure, attendance_responsibility: createResponsibility }[type];
  if (!fn) throw new Error('Unsupported attendance foundation entity type.');
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, client => fn(input, client));
}
async function correct(type, id, changes, reason, actorId, schoolId) {
  const why = requiredReason(reason);
  if (!ENTITY[type] || !idOk(id)) throw new Error('A valid correctable entity and record ID are required.');
  const spec = ENTITY[type];
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, async client => {
    await actorCheck(schoolId, actorId, client);
    const old = await db.get(`SELECT * FROM ${spec.table} WHERE id = ? AND school_id = ?`, [id, schoolId], client);
    if (!old) throw new Error('Attendance foundation record was not found in this school.');
    const from = changes[spec.dateFrom] == null ? String(old[spec.dateFrom]).slice(0,10) : date(changes[spec.dateFrom], spec.dateFrom);
    const toValue = Object.prototype.hasOwnProperty.call(changes, spec.dateTo) ? changes[spec.dateTo] : old[spec.dateTo];
    const span = interval(from, toValue, spec.dateFrom, spec.dateTo);
    const parentId = Number(old[spec.parent === 'section' ? 'section_id' : 'class_id']);
    await lockParent(spec.parent, schoolId, parentId, client);
    await ensureNoOverlap(type, schoolId, parentId, old.session, span.start, span.end, id, client);
    const allowed = type === 'academic_period' ? ['term','start_date','end_date']
      : type === 'attendance_schedule' ? [...WEEKDAYS,'effective_from','effective_to']
      : ['staff_id','effective_from','effective_to'];
    const set = []; const params = [];
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(changes,key)) {
      set.push(key + ' = ?'); params.push(key === 'effective_from' || key === 'effective_to' || key === 'start_date' || key === 'end_date'
        ? (changes[key] == null ? null : date(changes[key],key))
        : changes[key]);
    }
    if (!set.length) throw new Error('No supported correction fields were supplied.');
    if (type === 'attendance_responsibility' && Object.prototype.hasOwnProperty.call(changes,'staff_id')) {
      const staff = await db.get('SELECT id FROM staff WHERE id = ? AND school_id = ?', [changes.staff_id,schoolId],client);
      if (!staff) throw new Error('The responsible staff member does not belong to this school.');
    }
    if (type === 'attendance_schedule') {
      const merged = Object.fromEntries(WEEKDAYS.map(d=>[d, Object.prototype.hasOwnProperty.call(changes,d) ? !!changes[d] : !!old[d]]));
      if (!Object.values(merged).some(Boolean)) throw new Error('At least one opening weekday must remain selected.');
    }
    set.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id,schoolId);
    await db.run(`UPDATE ${spec.table} SET ${set.join(', ')} WHERE id = ? AND school_id = ?`,params,client);
    const updated = await db.get(`SELECT * FROM ${spec.table} WHERE id = ? AND school_id = ?`,[id,schoolId],client);
    await audit(schoolId,type,id,'corrected',old,updated,why,actorId,client);
    return { id: Number(id) };
  });
}
async function cancelClosure(id, schoolId, actorId, reason) {
  const why = requiredReason(reason);
  const tx = db.transactionImmediate || db.transaction;
  return tx.call(db, async client => {
    await actorCheck(schoolId,actorId,client);
    await lockParent('school',schoolId,schoolId,client);
    const old = await db.get("SELECT * FROM class_attendance_closures WHERE id = ? AND school_id = ? AND status = 'active'",[id,schoolId],client);
    if (!old) throw new Error('Active attendance closure was not found in this school.');
    await db.run("UPDATE class_attendance_closures SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?",[id,schoolId],client);
    const updated = await db.get('SELECT * FROM class_attendance_closures WHERE id = ? AND school_id = ?',[id,schoolId],client);
    await audit(schoolId,'attendance_closure',id,'cancelled',old,updated,why,actorId,client);
    return { id: Number(id) };
  });
}
async function getResponsibleStaff(input) {
  const { schoolId,classId,session,onDate } = input || {};
  const day = date(onDate,'onDate');
  return db.get(`SELECT staff_id FROM class_attendance_responsibilities
    WHERE school_id = ? AND class_id = ? AND session = ? AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC, id DESC LIMIT 1`,[schoolId,classId,session,day,day]);
}

module.exports = { create, correct, cancelClosure, getResponsibleStaff, validateDate: date };
