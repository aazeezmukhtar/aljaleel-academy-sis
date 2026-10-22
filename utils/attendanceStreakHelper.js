'use strict';

/**
 * Summarize ordered attendance rows for one student group.
 * The caller must supply records ordered by student_id and date ascending.
 * Historical absences remain counted even after a Present/Late/Leave resets the current streak.
 */
function summarizeAttendanceRecords(records) {
  const studentStats = {};

  for (const record of records) {
    if (!studentStats[record.student_id]) {
      studentStats[record.student_id] = {
        id: record.student_id,
        first_name: record.first_name,
        last_name: record.last_name,
        parent_phone: record.parent_phone,
        total_absent_days: 0,
        longest_consecutive_absent_days: 0,
        current_consecutive_absent_days: 0,
        current_streak: 0,
        absences_without_reason: 0
      };
    }

    const stats = studentStats[record.student_id];
    if (record.status === 'Absent') {
      stats.total_absent_days++;
      stats.current_streak++;
      stats.current_consecutive_absent_days = stats.current_streak;
      if (stats.current_streak > stats.longest_consecutive_absent_days) {
        stats.longest_consecutive_absent_days = stats.current_streak;
      }
      if (!record.reason || record.reason.trim() === '' || record.reason === 'Unknown') {
        stats.absences_without_reason++;
      }
    } else if (record.status === 'Present' || record.status === 'Late' || record.status === 'Leave') {
      stats.current_streak = 0;
      stats.current_consecutive_absent_days = 0;
    }
  }

  return studentStats;
}

module.exports = { summarizeAttendanceRecords };
