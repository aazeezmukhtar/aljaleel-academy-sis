'use strict';

const db = require('../utils/db');

const DEFAULT_THRESHOLD = 75;

function validThreshold(value, label) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(label + ' must be a number from 0 to 100.');
  }
  return threshold;
}

async function getThreshold(schoolId, override = null) {
  if (!Number.isSafeInteger(Number(schoolId)) || Number(schoolId) <= 0) {
    throw new Error('A valid school ID is required to resolve the attendance threshold.');
  }
  if (override !== null && override !== undefined && override !== '') {
    return validThreshold(override, 'Attendance threshold');
  }
  const setting = await db.get(
    "SELECT value FROM settings WHERE school_id = ? AND key = 'attendance.minimum_percentage' LIMIT 1",
    [Number(schoolId)]
  );
  if (!setting || setting.value === null || setting.value === '') return DEFAULT_THRESHOLD;
  const configured = Number(setting.value);
  return Number.isFinite(configured) && configured >= 0 && configured <= 100
    ? configured : DEFAULT_THRESHOLD;
}

module.exports = { getThreshold, validThreshold, DEFAULT_THRESHOLD };
