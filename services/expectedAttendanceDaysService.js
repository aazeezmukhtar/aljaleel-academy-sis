'use strict';

const db = require('../utils/db');

const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const STATUSES = ['expected','closed','non_opening','unknown_schedule','outside_term','outside_enrollment','unknown_enrollment','unknown_period'];

function parseDate(value, field) {
  const s = String(value || '');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00.000Z') : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s) {
    throw new Error(field + ' must be a valid YYYY-MM-DD date.');
  }
  return s;
}
function dbDate(value) {
  return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
}
function addDays(value, amount) {
  const d = new Date(value + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0,10);
}
function eachDate(from, to) {
  const result = [];
  for (let day = from; day <= to; day = addDays(day, 1)) result.push(day);
  return result;
}
function bool(value) { return value === true || value === 1 || value === '1' || value === 't'; }

async function calculate(input) {
  const { schoolId, sectionId, classId, session, term, studentId = null } = input || {};
  if (!Number.isSafeInteger(Number(schoolId)) || Number(schoolId) <= 0 ||
      !Number.isSafeInteger(Number(sectionId)) || Number(sectionId) <= 0 ||
      !Number.isSafeInteger(Number(classId)) || Number(classId) <= 0) {
    throw new Error('A valid school, section and class are required.');
  }
  if (!String(session || '').trim() || !String(term || '').trim()) {
    throw new Error('Session and term are required.');
  }
  const requestedStart = parseDate(input.startDate, 'startDate');
  const requestedEnd = parseDate(input.endDate, 'endDate');
  if (requestedEnd < requestedStart) throw new Error('endDate cannot be before startDate.');

  const parent = await db.get(`SELECT c.id, c.section_id
    FROM classes c WHERE c.id = ? AND c.school_id = ?`, [classId, schoolId]);
  if (!parent || Number(parent.section_id) !== Number(sectionId)) {
    throw new Error('The selected class does not belong to this school and section.');
  }
  if (studentId != null) {
    const student = await db.get('SELECT id FROM students WHERE id = ? AND school_id = ?', [studentId, schoolId]);
    if (!student) throw new Error('The selected student does not belong to this school.');
  }

  const period = await db.get(`SELECT id, start_date, end_date
    FROM section_academic_periods
    WHERE school_id = ? AND section_id = ? AND session = ? AND term = ?
    LIMIT 1`, [schoolId, sectionId, session, term]);
  const schedules = await db.all(`SELECT * FROM class_attendance_schedules
    WHERE school_id = ? AND class_id = ? AND session = ?
      AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from, id`, [schoolId, classId, session, requestedEnd, requestedStart]);
  const closures = await db.all(`SELECT id, scope_type, section_id, class_id, closure_date, reason
    FROM class_attendance_closures
    WHERE school_id = ? AND status = 'active' AND closure_date >= ? AND closure_date <= ?
      AND (scope_type = 'school' OR (scope_type = 'section' AND section_id = ?)
        OR (scope_type = 'class' AND class_id = ?))
    ORDER BY closure_date, id`, [schoolId, requestedStart, requestedEnd, sectionId, classId]);

  let enrollmentPeriods = [];
  if (studentId != null) {
    enrollmentPeriods = await db.all(`SELECT id, start_date, end_date, date_status
      FROM student_enrollment_periods
      WHERE school_id = ? AND student_id = ? AND section_id = ? AND class_id = ? AND session = ?
        AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)
      ORDER BY start_date, id`,
    [schoolId, studentId, sectionId, classId, session, requestedEnd, requestedStart]);
  }

  const scheduleFor = day => schedules.find(row =>
    dbDate(row.effective_from) <= day && (row.effective_to == null || dbDate(row.effective_to) >= day));
  const closuresFor = day => closures.filter(row => dbDate(row.closure_date) === day);
  const enrollmentFor = day => enrollmentPeriods.filter(row =>
    dbDate(row.start_date) <= day && (row.end_date == null || dbDate(row.end_date) >= day));
  const days = eachDate(requestedStart, requestedEnd).map(day => {
    const result = { date: day, status: null, reason: null, closureIds: [] };
    if (!period) {
      result.status = 'unknown_period';
      result.reason = 'No academic dates are configured for this section, session and term.';
      return result;
    }
    const periodStart = dbDate(period.start_date), periodEnd = dbDate(period.end_date);
    if (day < periodStart || day > periodEnd) {
      result.status = 'outside_term';
      result.reason = 'Date is outside the configured academic term.';
      return result;
    }

    if (studentId != null) {
      const matches = enrollmentFor(day);
      const confirmed = matches.filter(row => row.date_status === 'confirmed');
      if (!confirmed.length) {
        const review = matches.some(row => row.date_status === 'review_needed');
        result.status = review || enrollmentPeriods.length === 0 ? 'unknown_enrollment' : 'outside_enrollment';
        result.reason = review
          ? 'Enrollment dates require review; attendance eligibility cannot be confirmed.'
          : enrollmentPeriods.length === 0
            ? 'No dated enrollment period exists; historical eligibility is not inferred.'
            : 'Student was not enrolled in this class on this date.';
        return result;
      }
    }

    const schedule = scheduleFor(day);
    if (!schedule) {
      result.status = 'unknown_schedule';
      result.reason = 'No class opening schedule is configured for this date.';
      return result;
    }
    const weekday = WEEKDAYS[new Date(day + 'T00:00:00.000Z').getUTCDay()];
    if (!bool(schedule[weekday])) {
      result.status = 'non_opening';
      result.reason = 'This weekday is not an opening day for the class.';
      return result;
    }
    const applicableClosures = closuresFor(day);
    if (applicableClosures.length) {
      result.status = 'closed';
      result.closureIds = applicableClosures.map(row => Number(row.id));
      result.reason = applicableClosures.map(row => row.reason).filter(Boolean).join('; ');
      return result;
    }
    result.status = 'expected';
    result.reason = 'Configured class opening day within the academic term.';
    return result;
  });

  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  for (const day of days) counts[day.status] += 1;
  const warnings = [];
  if (!period) warnings.push('Academic period is not configured; all requested dates are unknown.');
  if (period && schedules.length === 0) warnings.push('No class schedule overlaps the requested date range.');
  if (studentId != null && enrollmentPeriods.length === 0) warnings.push('No confirmed or review-needed dated enrollment period overlaps the requested range; no historical dates were inferred.');
  if (studentId == null && days.some(day => day.status === 'unknown_schedule')) warnings.push('Some dates have no configured class schedule and are unknown, not closures.');
  if (studentId != null && days.some(day => day.status === 'unknown_enrollment')) warnings.push('Some student dates have unconfirmed or missing enrollment history and are unknown, not assumed eligible.');
  return {
    schoolId: Number(schoolId), sectionId: Number(sectionId), classId: Number(classId),
    studentId: studentId == null ? null : Number(studentId), session, term,
    range: { startDate: requestedStart, endDate: requestedEnd },
    academicPeriod: period ? { startDate: dbDate(period.start_date), endDate: dbDate(period.end_date) } : null,
    days, counts, warnings
  };
}

module.exports = { calculate, validateDate: parseDate };
