'use strict';

const db = require('../utils/db');
const expectedDays = require('./expectedAttendanceDaysService');

function day(value) {
  return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
}
function previousDay(today) {
  const value = new Date(today + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0,10);
}
function maxDate(...values) { return values.map(day).sort().at(-1); }
function minDate(...values) { return values.map(day).sort()[0]; }

async function collectForStaff({ schoolId, staffId, today }) {
  const currentDay = expectedDays.validateDate(today, 'today');
  const dueThrough = previousDay(currentDay);
  const assignments = await db.all(`
    SELECT r.id AS responsibility_id, r.class_id, r.session, r.effective_from, r.effective_to,
      c.section_id, c.name AS class_name, sec.name AS section_name,
      sec.current_session, sec.current_term, p.start_date, p.end_date
    FROM class_attendance_responsibilities r
    JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
    JOIN sections sec ON sec.id = c.section_id AND sec.school_id = c.school_id
    JOIN section_academic_periods p
      ON p.school_id = r.school_id AND p.section_id = c.section_id
     AND p.session = r.session AND p.term = sec.current_term
    WHERE r.school_id = ? AND r.staff_id = ?
      AND r.session = sec.current_session
      AND r.effective_from <= ? AND (r.effective_to IS NULL OR r.effective_to >= p.start_date)
      AND p.start_date <= ?
    ORDER BY r.class_id, p.start_date
  `, [Number(schoolId), Number(staffId), dueThrough, dueThrough]);

  for (const assignment of assignments) {
    const startDate = maxDate(assignment.effective_from, assignment.start_date);
    const endDate = minDate(assignment.effective_to || dueThrough, assignment.end_date, dueThrough);
    if (endDate < startDate) continue;

    const expected = await expectedDays.calculate({
      schoolId: Number(schoolId),
      sectionId: Number(assignment.section_id),
      classId: Number(assignment.class_id),
      session: assignment.session,
      term: assignment.current_term,
      startDate,
      endDate
    });
    const submittedRows = await db.all(`
      SELECT attendance_date FROM attendance_registers
      WHERE school_id = ? AND section_id = ? AND class_id = ?
        AND session = ? AND term = ? AND status = 'submitted'
        AND attendance_date >= ? AND attendance_date <= ?
    `, [Number(schoolId), Number(assignment.section_id), Number(assignment.class_id),
        assignment.session, assignment.current_term, startDate, endDate]);
    const submittedDates = new Set(submittedRows.map(row => day(row.attendance_date)));

    for (const entry of expected.days) {
      if (entry.status !== 'expected' || submittedDates.has(entry.date)) continue;
      await db.run(`INSERT OR IGNORE INTO attendance_register_reminders
        (school_id, section_id, class_id, staff_id, attendance_date, session, term)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Number(schoolId), Number(assignment.section_id), Number(assignment.class_id),
       Number(staffId), entry.date, assignment.session, assignment.current_term]);
    }
  }

  return db.all(`
    SELECT r.id, r.attendance_date, r.session, r.term, r.class_id,
      c.name AS class_name, sec.name AS section_name, r.created_at
    FROM attendance_register_reminders r
    JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
      AND c.section_id = r.section_id
    JOIN sections sec ON sec.id = r.section_id AND sec.school_id = r.school_id
    WHERE r.school_id = ? AND r.staff_id = ? AND r.status = 'active'
      AND r.session = sec.current_session AND r.term = sec.current_term
    ORDER BY r.attendance_date DESC, r.id DESC
    LIMIT 20
  `, [Number(schoolId), Number(staffId)]);
}

module.exports = { collectForStaff, previousDay };
