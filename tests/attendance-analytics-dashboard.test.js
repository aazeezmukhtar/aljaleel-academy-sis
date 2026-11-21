'use strict';

const assert = require('assert');
const { createAttendanceAnalyticsDashboardService } =
    require('../services/attendanceAnalyticsDashboardService');

async function main() {
    const queries = [];
    const fs = require('fs');
    const path = require('path');
    const analyticsView = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'analytics.ejs'), 'utf8');
    assert(analyticsView.includes('Attendance record breakdown'));
    assert(analyticsView.includes('Present, Late, and Leave count as attended. Absent does not.'));
    assert(analyticsView.includes('recorded student-days only'));
    assert(analyticsView.includes('Students tracked'));
    assert(analyticsView.includes('Leave days'));
    assert(analyticsView.includes('Only dates with saved attendance records appear here.'));
    assert(!analyticsView.includes('Apply filters'), 'filter changes should not have a redundant manual apply button');
    assert(analyticsView.includes('analytics-summary'));
    assert(analyticsView.includes('analytics-breakdown-bar'));

    const db = {
        async all(sql, params) {
            queries.push(sql);
            if (/FROM classes/i.test(sql)) {
                assert.deepStrictEqual(params, [1, 10, 40]);
                return [{ id: 40, name: 'Primary 1' }];
            }
            if (/FROM section_academic_periods/i.test(sql)) {
                assert.deepStrictEqual(params, [1, 10, '2026/2027', '1st Term']);
                return [{ start_date: '2026-09-01', end_date: '2026-12-20' }];
            }
            throw new Error('Unexpected analytics database query: ' + sql);
        }
    };
    const analyticsService = {
        async getClassAttendanceReport(input) {
            assert.deepStrictEqual(input, {
                schoolId: 1, classId: 40, sectionId: 10,
                startDate: '2026-09-01', endDate: '2026-12-20',
                session: '2026/2027', term: '1st Term'
            });
            return {
                threshold: 80,
                rows: [
                    { student_id: 1, first_name: 'A', last_name: 'One', totalDays: 2, attendedDays: 2, attendanceRate: 100, belowThreshold: false, late: 1, absent: 0 },
                    { student_id: 2, first_name: 'B', last_name: 'Two', totalDays: 2, attendedDays: 1, attendanceRate: 50, belowThreshold: true, threshold: 80, late: 0, absent: 1 }
                ],
                records: [
                    { student_id: 1, date: '2026-10-01', status: 'Present' },
                    { student_id: 1, date: '2026-10-02', status: 'Late' },
                    { student_id: 2, date: '2026-10-01', status: 'Absent' },
                    { student_id: 2, date: '2026-10-02', status: 'Present' }
                ]
            };
        }
    };

    const service = createAttendanceAnalyticsDashboardService(db, analyticsService);
    const result = await service.getDashboard({
        schoolId: 1, sectionId: 10, session: '2026/2027',
        term: '1st Term', classIds: [40]
    });
    assert.strictEqual(result.filters.startDate, '2026-09-01');
    assert.strictEqual(result.filters.endDate, '2026-12-20');
    assert.strictEqual(result.overview.attendanceRate, 75);
    assert.strictEqual(result.overview.totalStudentDays, 4);
    assert.strictEqual(result.overview.attendedStudentDays, 3);
    assert.strictEqual(result.overview.studentsTracked, 2);
    assert.strictEqual(result.overview.lowAttendanceCount, 1);
    assert.strictEqual(result.overview.lateArrivals, 1);
    assert.strictEqual(result.overview.absences, 1);
    assert.strictEqual(result.classComparison[0].studentsTracked, 2);
    assert.strictEqual(result.classComparison[0].threshold, 80);
    assert.strictEqual(result.dailySummary.length, 2);
    assert.strictEqual(result.dailySummary[0].attendanceRate, 50);
    assert.strictEqual(result.lowAttendanceStudents[0].studentName, 'B Two');
    assert.strictEqual(result.topLateStudents[0].studentName, 'A One');
    assert(!Object.prototype.hasOwnProperty.call(result, 'registerCompletion'));
    assert(!Object.prototype.hasOwnProperty.call(result, 'scheduleIssues'));
    assert(queries.every(sql => !/attendance_registers|attendance_schedule|class_attendance_closures/i.test(sql)),
        'dashboard must not query attendance setup, schedule, closure or register tables');

    console.log('[attendance-analytics-dashboard] context-only analytics without attendance setup dependencies passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
