const assert = require('assert');

/**
 * Replicates the streak calculation in controllers/attendanceController.js
 */
function calculateAttendanceStats(attendanceRecords) {
    const studentStats = {};

    for (const record of attendanceRecords) {
        if (!studentStats[record.student_id]) {
            studentStats[record.student_id] = {
                id: record.student_id,
                total_absent_days: 0,
                longest_consecutive_absent_days: 0,
                current_consecutive_absent_days: 0,
                current_streak: 0
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
        } else if (record.status === 'Present' || record.status === 'Late' || record.status === 'Leave') {
            stats.current_streak = 0;
            stats.current_consecutive_absent_days = 0;
        }
    }

    return studentStats;
}

console.log('=== Running Consecutive Absenteeism Audit Tests ===');

// Test 1: 5 absences -> Present -> current streak becomes 0
console.log('\n--- Test 1: 5 Absences -> Present -> Current streak becomes 0 ---');
const t1Records = [
    { student_id: 1, date: '2026-10-01', status: 'Absent' },
    { student_id: 1, date: '2026-10-02', status: 'Absent' },
    { student_id: 1, date: '2026-10-05', status: 'Absent' },
    { student_id: 1, date: '2026-10-06', status: 'Absent' },
    { student_id: 1, date: '2026-10-07', status: 'Absent' },
    { student_id: 1, date: '2026-10-08', status: 'Present' }
];
const s1 = calculateAttendanceStats(t1Records)[1];
assert.strictEqual(s1.total_absent_days, 5, 'Total absences should be 5');
assert.strictEqual(s1.current_consecutive_absent_days, 0, 'Current consecutive absences must be 0 after Present');
assert.strictEqual(s1.longest_consecutive_absent_days, 5, 'Longest consecutive absences must be 5');
console.log('✓ Test 1 passed: Current streak is 0, Longest is 5');

// Test 2: 5 absences -> Present -> 2 new absences -> current streak = 2, longest = 5
console.log('\n--- Test 2: 5 Absences -> Present -> 2 New Absences ---');
const t2Records = [
    ...t1Records,
    { student_id: 1, date: '2026-10-09', status: 'Absent' },
    { student_id: 1, date: '2026-10-12', status: 'Absent' }
];
const s2 = calculateAttendanceStats(t2Records)[1];
assert.strictEqual(s2.total_absent_days, 7, 'Total absences should be 7');
assert.strictEqual(s2.current_consecutive_absent_days, 2, 'Current consecutive absences must be 2');
assert.strictEqual(s2.longest_consecutive_absent_days, 5, 'Longest consecutive absences must remain 5');
console.log('✓ Test 2 passed: Current streak is 2, Longest is 5, Total is 7');

// Test 3: 5 absences -> Present -> Present -> current streak = 0
console.log('\n--- Test 3: 5 Absences -> Present -> Present ---');
const t3Records = [
    ...t1Records,
    { student_id: 1, date: '2026-10-09', status: 'Present' }
];
const s3 = calculateAttendanceStats(t3Records)[1];
assert.strictEqual(s3.total_absent_days, 5, 'Total absences should remain 5');
assert.strictEqual(s3.current_consecutive_absent_days, 0, 'Current streak should remain 0');
assert.strictEqual(s3.longest_consecutive_absent_days, 5, 'Longest streak should remain 5');
console.log('✓ Test 3 passed: Multiple Present days keep streak at 0');

// Test 4: Authorized Leave breaks consecutive absence streak
console.log('\n--- Test 4: 3 Absences -> Leave -> current streak = 0 ---');
const t4Records = [
    { student_id: 1, date: '2026-10-01', status: 'Absent' },
    { student_id: 1, date: '2026-10-02', status: 'Absent' },
    { student_id: 1, date: '2026-10-05', status: 'Absent' },
    { student_id: 1, date: '2026-10-06', status: 'Leave' }
];
const s4 = calculateAttendanceStats(t4Records)[1];
assert.strictEqual(s4.total_absent_days, 3, 'Total absences should be 3');
assert.strictEqual(s4.current_consecutive_absent_days, 0, 'Leave status must reset current consecutive streak');
assert.strictEqual(s4.longest_consecutive_absent_days, 3, 'Longest streak remains 3');
console.log('✓ Test 4 passed: Leave resets current streak to 0');

// Test 5: Intervening weekends / non-school days do NOT break streak
console.log('\n--- Test 5: Friday Absent -> Monday Absent (Weekend gap) ---');
const t5Records = [
    { student_id: 1, date: '2026-10-02', status: 'Absent' }, // Friday
    { student_id: 1, date: '2026-10-05', status: 'Absent' }  // Monday
];
const s5 = calculateAttendanceStats(t5Records)[1];
assert.strictEqual(s5.current_consecutive_absent_days, 2, 'Consecutive school days should be 2 despite calendar weekend gap');
console.log('✓ Test 5 passed: Weekend gap does not break school attendance streak');

// Test 6: Flagging logic: consecutive flag clears when streak is broken
console.log('\n--- Test 6: Active Risk Flag Behavior ---');
const termLimit = 10;
const consecutiveLimit = 3;

function evaluateFlag(stats) {
    const reasons = [];
    if (stats.total_absent_days >= termLimit) {
        reasons.push(`Term Limit: ${stats.total_absent_days} absences`);
    }
    if (stats.current_consecutive_absent_days >= consecutiveLimit) {
        reasons.push(`Consecutive: ${stats.current_consecutive_absent_days} days`);
    }
    return reasons;
}

// Case A: 4 absences (streak = 4, total = 4)
const flagsA = evaluateFlag({ total_absent_days: 4, current_consecutive_absent_days: 4 });
assert.deepStrictEqual(flagsA, ['Consecutive: 4 days']);

// Case B: Now marked Present (streak = 0, total = 4) -> flag disappears completely!
const flagsB = evaluateFlag({ total_absent_days: 4, current_consecutive_absent_days: 0 });
assert.deepStrictEqual(flagsB, [], 'Flag should disappear completely when current streak resets and term total < 10');

// Case C: Student with 12 total absences and streak = 0 -> only Term Limit remains
const flagsC = evaluateFlag({ total_absent_days: 12, current_consecutive_absent_days: 0 });
assert.deepStrictEqual(flagsC, ['Term Limit: 12 absences'], 'Only Term Limit flag remains when streak is broken');
console.log('✓ Test 6 passed: Risk flag triggers strictly on current consecutive streak and term limit');

// Test 7: WhatsApp message payload verification
console.log('\n--- Test 7: WhatsApp Notification Uses Current Streak ---');
const { buildWhatsAppAttendanceAction } = require('../utils/whatsappHelper');

// Case A: Student with active streak = 4 (current streak >= limit 3, total = 6 < limit 10)
const waConsecutive = buildWhatsAppAttendanceAction({
    parent_phone: '08062418033',
    total_absences: 6,
    consecutive_absences: 4,
    term_limit: termLimit,
    consecutive_limit: consecutiveLimit,
    context: {
        student_name: 'Ahmed Bello',
        class_name: 'Primary 2',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.strictEqual(waConsecutive.is_valid, true);
assert.ok(waConsecutive.message.includes('4 consecutive days'), 'Message must reflect current streak (4)');
assert.ok(!waConsecutive.message.includes('recorded 6 days of absence'), 'Does not include term alert when total absences < 10');

// Case B: Student whose previous longest streak was 5, but current streak is now 2 (after a present day)
// When only term limit is exceeded (total = 12, current = 2), only low attendance message is sent, NOT consecutive
const waTermOnly = buildWhatsAppAttendanceAction({
    parent_phone: '08062418033',
    total_absences: 12,
    consecutive_absences: 2,
    term_limit: termLimit,
    consecutive_limit: consecutiveLimit,
    context: {
        student_name: 'Ahmed Bello',
        class_name: 'Primary 2',
        school_name: 'Al-Jaleel Academy'
    }
});
assert.strictEqual(waTermOnly.is_valid, true);
assert.ok(waTermOnly.message.includes('12 days of absence'), 'Message should alert about term limit');
assert.ok(!waTermOnly.message.includes('consecutive'), 'Message must NOT include consecutive alert because current streak (2) is below limit (3)');
console.log('✓ Test 7 passed: WhatsApp message strictly uses current streak, never historical maximum');

console.log('\n=== ALL AUDIT TESTS PASSED SUCCESSFULLY! ===\n');
