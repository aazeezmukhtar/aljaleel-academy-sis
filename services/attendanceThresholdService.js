'use strict';

const db = require('../utils/db');
const DEFAULT_THRESHOLD = 75;

function validateThreshold(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error('Attendance threshold is required.');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error('Attendance threshold must be a number between 0 and 100.');
  }
  return number;
}

async function getSchoolThreshold(schoolId, override) {
  if (override !== undefined && override !== null && String(override).trim() !== '') {
    return validateThreshold(override);
  }
  const setting = await db.get(
    "SELECT value FROM settings WHERE school_id = ? AND key = 'attendance.low_attendance_threshold'",
    [Number(schoolId)]
  );
  if (!setting) return DEFAULT_THRESHOLD;
  try {
    return validateThreshold(setting.value);
  } catch (_) {
    return DEFAULT_THRESHOLD;
  }
}

module.exports = { DEFAULT_THRESHOLD, validateThreshold, getSchoolThreshold };
