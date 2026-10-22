'use strict';

const assert = require('assert');
const { summarizeAttendanceRecords } = require('../utils/attendanceStreakHelper');

const row = (date, status, reason = null) => ({
  student_id: 17,
  first_name: 'Test',
  last_name: 'Student',
  parent_phone: '08000000000',
  date,
  status,
  reason
});

const afterReturn = summarizeAttendanceRecords([
  row('2026-10-12', 'Absent', 'Sick'),
  row('2026-10-13', 'Absent'),
  row('2026-10-14', 'Absent', 'Unknown'),
  row('2026-10-15', 'Present'),
  row('2026-10-16', 'Absent', 'Family reason')
]);
const student = afterReturn[17];

assert.strictEqual(student.total_absent_days, 4, 'all historical absences must remain counted');
assert.strictEqual(student.current_consecutive_absent_days, 1, 'absence after returning must start a new streak');
assert.strictEqual(student.current_streak, 1, 'internal current streak should restart after Present');
assert.strictEqual(student.longest_consecutive_absent_days, 3, 'longest historical streak must be retained');
assert.strictEqual(student.absences_without_reason, 2, 'missing and Unknown reasons should be counted');

const returnedToday = summarizeAttendanceRecords([
  row('2026-10-12', 'Absent'),
  row('2026-10-13', 'Absent'),
  row('2026-10-14', 'Present')
])[17];
assert.strictEqual(returnedToday.total_absent_days, 2);
assert.strictEqual(returnedToday.current_consecutive_absent_days, 0, 'Present must reset the current streak');
assert.strictEqual(returnedToday.longest_consecutive_absent_days, 2, 'reset must not erase the historical longest streak');

const lateReturn = summarizeAttendanceRecords([
  row('2026-10-12', 'Absent'),
  row('2026-10-13', 'Late'),
  row('2026-10-14', 'Absent')
])[17];
assert.strictEqual(lateReturn.total_absent_days, 2);
assert.strictEqual(lateReturn.current_consecutive_absent_days, 1, 'Late continues to break an absence streak as before');

assert.deepStrictEqual(summarizeAttendanceRecords([]), {});
console.log('Attendance streak tests passed (Present resets current streak; historical absence totals and longest streak remain).');
