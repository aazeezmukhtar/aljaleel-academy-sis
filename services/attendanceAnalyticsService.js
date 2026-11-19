'use strict';

const expectedDaysService = require('./expectedAttendanceDaysService');

const CREDIT_STATUSES = new Set(['Present', 'Late', 'Leave']);
const ZERO_CREDIT_STATUSES = new Set(['Absent']);

function asDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function validateThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('lowAttendanceThreshold must be a configured number from 0 to 100.');
  }
  return threshold;
}

/**
 * Read-only, student-level attendance analytics.
 *
 * Only expected dates with a submitted register and a corresponding student
 * attendance row enter the attendance-rate denominator. Draft/missing
 * registers and incomplete submitted records are reported separately.
 *
 * Leave is treated as approved leave under the school's approved policy and
 * receives full attendance credit. The existing attendance schema has no
 * separate approval flag for Leave.
 */
async function calculate(input) {
  const value = input || {};
  if (!Number.isSafeInteger(Number(value.studentId)) || Number(value.studentId) <= 0) {
    throw new Error('A valid studentId is required for attendance analytics.');
  }
  const threshold = validateThreshold(value.lowAttendanceThreshold);
  const expected = await expectedDaysService.calculate({
    schoolId: value.schoolId,
    sectionId: value.sectionId,
    classId: value.classId,
    studentId: Number(value.studentId),
    session: value.session,
    term: value.term,
    startDate: value.startDate,
    endDate: value.endDate
  });

  const registers = await require('../utils/db').all(`
    SELECT attendance_date, status, submission_version
    FROM attendance_registers
    WHERE school_id = ? AND section_id = ? AND class_id = ?
      AND session = ? AND term = ?
      AND attendance_date >= ? AND attendance_date <= ?
  `, [
    Number(value.schoolId), Number(value.sectionId), Number(value.classId),
    value.session, value.term, value.startDate, value.endDate
  ]);
  const records = await require('../utils/db').all(`
    SELECT date, status
    FROM attendance
    WHERE student_id = ? AND class_id = ? AND section_id = ?
      AND session = ? AND term = ?
      AND date >= ? AND date <= ?
  `, [
    Number(value.studentId), Number(value.classId), Number(value.sectionId),
    value.session, value.term, value.startDate, value.endDate
  ]);

  const registerByDate = new Map(registers.map(row => [asDate(row.attendance_date), row]));
  const recordByDate = new Map(records.map(row => [asDate(row.date), row]));
  const days = expected.days.map(day => {
    if (day.status !== 'expected') return { ...day, attendanceStatus: null, credit: null };
    const register = registerByDate.get(day.date);
    if (!register) {
      return { ...day, status: 'missing_register', attendanceStatus: null, credit: null,
        reason: 'No formal register exists for this expected class day.' };
    }
    if (register.status !== 'submitted') {
      return { ...day, status: 'draft_register', attendanceStatus: null, credit: null,
        reason: 'The register exists but has not been submitted.' };
    }
    const record = recordByDate.get(day.date);
    if (!record) {
      return { ...day, status: 'missing_student_record', attendanceStatus: null, credit: null,
        reason: 'The register is submitted but has no attendance row for this student.' };
    }
    if (CREDIT_STATUSES.has(record.status)) {
      return { ...day, status: 'recorded', attendanceStatus: record.status, credit: 1,
        reason: record.status === 'Leave' ? 'Approved Leave receives full attendance credit.' : null };
    }
    if (ZERO_CREDIT_STATUSES.has(record.status)) {
      return { ...day, status: 'recorded', attendanceStatus: record.status, credit: 0, reason: null };
    }
    return { ...day, status: 'unknown_attendance_status', attendanceStatus: record.status, credit: null,
      reason: 'The attendance status is not recognized by the analytics policy.' };
  });

  const counts = {
    expected: 0, recorded: 0, present: 0, late: 0, approvedLeave: 0, absent: 0,
    missingRegister: 0, draftRegister: 0, missingStudentRecord: 0,
    unknownAttendanceStatus: 0, closed: 0, nonOpening: 0, unknownSchedule: 0,
    outsideTerm: 0, outsideEnrollment: 0, unknownEnrollment: 0, unknownPeriod: 0
  };
  let attendanceCredits = 0;
  for (const day of days) {
    if (['recorded', 'missing_register', 'draft_register', 'missing_student_record', 'unknown_attendance_status'].includes(day.status)) counts.expected += 1;
    if (day.status === 'recorded') {
      counts.recorded += 1;
      attendanceCredits += day.credit;
      if (day.attendanceStatus === 'Present') counts.present += 1;
      if (day.attendanceStatus === 'Late') counts.late += 1;
      if (day.attendanceStatus === 'Leave') counts.approvedLeave += 1;
      if (day.attendanceStatus === 'Absent') counts.absent += 1;
    } else if (day.status === 'missing_register') counts.missingRegister += 1;
    else if (day.status === 'draft_register') counts.draftRegister += 1;
    else if (day.status === 'missing_student_record') counts.missingStudentRecord += 1;
    else if (day.status === 'unknown_attendance_status') counts.unknownAttendanceStatus += 1;
    else if (day.status === 'closed') counts.closed += 1;
    else if (day.status === 'non_opening') counts.nonOpening += 1;
    else if (day.status === 'unknown_schedule') counts.unknownSchedule += 1;
    else if (day.status === 'outside_term') counts.outsideTerm += 1;
    else if (day.status === 'outside_enrollment') counts.outsideEnrollment += 1;
    else if (day.status === 'unknown_enrollment') counts.unknownEnrollment += 1;
    else if (day.status === 'unknown_period') counts.unknownPeriod += 1;
  }
  const attendanceRate = counts.recorded > 0
    ? Math.round((attendanceCredits / counts.recorded) * 10000) / 100
    : null;
  const warnings = [...expected.warnings];
  if (counts.missingRegister) warnings.push('Some expected class days have no formal register; they are excluded from the attendance rate.');
  if (counts.draftRegister) warnings.push('Some expected class days have draft registers only; they are excluded from the attendance rate.');
  if (counts.missingStudentRecord) warnings.push('Some submitted registers have no attendance row for this student; those dates are excluded pending review.');
  if (counts.unknownAttendanceStatus) warnings.push('Some submitted attendance rows have unrecognized statuses and are excluded pending review.');

  return {
    schoolId: Number(value.schoolId), sectionId: Number(value.sectionId),
    classId: Number(value.classId), studentId: Number(value.studentId),
    session: value.session, term: value.term,
    range: expected.range,
    lowAttendanceThreshold: threshold,
    counts,
    attendanceCredits,
    attendanceRate,
    lowAttendance: attendanceRate !== null && attendanceRate < threshold,
    days,
    warnings
  };
}

module.exports = { calculate, validateThreshold };
