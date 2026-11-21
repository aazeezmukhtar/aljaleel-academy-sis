'use strict';

const { normalizeDate } = require('./attendanceAnalyticsService');

function dateValue(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
}

function summarize(records) {
    const result = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const record of records || []) {
        if (record.status === 'Present') result.present += 1;
        else if (record.status === 'Late') result.late += 1;
        else if (record.status === 'Absent') result.absent += 1;
        else if (record.status === 'Leave') result.leave += 1;
    }
    const totalDays = result.present + result.late + result.absent + result.leave;
    const attendedDays = result.present + result.late + result.leave;
    return {
        ...result, totalDays, attendedDays,
        attendanceRate: totalDays > 0 ? Math.round((attendedDays / totalDays) * 1000) / 10 : null
    };
}

function emptyDashboard(filters) {
    return {
        filters,
        overview: {
            attendanceRate: null, totalStudentDays: 0, attendedStudentDays: 0,
            studentsTracked: 0, lowAttendanceCount: 0, lateArrivals: 0,
            absences: 0, leaveDays: 0
        },
        classComparison: [], dailySummary: [], lowAttendanceStudents: [], topLateStudents: []
    };
}

function createAttendanceAnalyticsDashboardService(db, analyticsService) {
    if (!db || !analyticsService) {
        throw new Error('Attendance dashboard service requires the database and shared analytics service.');
    }

    async function getDashboard(input) {
        const schoolId = Number(input && input.schoolId);
        const sectionId = Number(input && input.sectionId);
        const session = String(input && input.session || '').trim();
        const term = String(input && input.term || '').trim();
        if (![schoolId, sectionId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school and section are required for attendance analytics.');
        }
        if (!session || !term) throw new Error('Select an academic session and term.');

        const classIds = Array.from(new Set((input.classIds || []).map(Number)
            .filter(value => Number.isSafeInteger(value) && value > 0)));
        const baseFilters = { schoolId, sectionId, session, term, classIds };
        if (!classIds.length) return emptyDashboard(baseFilters);

        const placeholders = classIds.map(() => '?').join(',');
        const classes = await db.all(`
            SELECT id, name FROM classes
            WHERE school_id = ? AND section_id = ? AND id IN (${placeholders})
            ORDER BY name, id
        `, [schoolId, sectionId, ...classIds]);
        if (!classes.length) return emptyDashboard(baseFilters);

        // The academic period is the date boundary. No daily schedule,
        // closure, generated-register or attendance-setup data is required.
        const periods = await db.all(`
            SELECT start_date, end_date
            FROM section_academic_periods
            WHERE school_id = ? AND section_id = ? AND session = ? AND term = ?
              AND status <> 'cancelled'
            ORDER BY start_date, end_date
        `, [schoolId, sectionId, session, term]);
        if (!periods.length) return emptyDashboard({ ...baseFilters, startDate: null, endDate: null });

        const startDate = periods.map(period => dateValue(period.start_date)).sort()[0];
        const endDate = periods.map(period => dateValue(period.end_date)).sort().slice(-1)[0];
        normalizeDate(startDate, 'Academic period start date');
        normalizeDate(endDate, 'Academic period end date');
        if (endDate < startDate) throw new Error('The selected academic period has an invalid date range.');

        const filters = { ...baseFilters, startDate, endDate };
        const daily = new Map();
        const classComparison = [];
        const lowAttendanceStudents = [];
        const lateStudentMap = new Map();
        let totalStudentDays = 0;
        let totalAttendedDays = 0;
        let totalPresent = 0;
        let totalLate = 0;
        let totalAbsent = 0;
        let totalLeave = 0;
        const studentIds = new Set();

        for (const classItem of classes) {
            const report = await analyticsService.getClassAttendanceReport({
                schoolId, classId: Number(classItem.id), sectionId,
                startDate, endDate, session, term
            });
            const rows = report.rows || [];
            const records = report.records || [];
            const totals = summarize(records);
            totalStudentDays += totals.totalDays;
            totalAttendedDays += totals.attendedDays;
            totalPresent += totals.present;
            totalLate += totals.late;
            totalAbsent += totals.absent;
            totalLeave += totals.leave;

            for (const student of rows) {
                studentIds.add(String(student.student_id));
                if (student.belowThreshold) {
                    lowAttendanceStudents.push({
                        classId: classItem.id, className: classItem.name,
                        studentId: student.student_id,
                        studentName: [student.first_name, student.last_name].filter(Boolean).join(' '),
                        attendanceRate: student.attendanceRate,
                        threshold: student.threshold,
                        totalDays: student.totalDays,
                        attendedDays: student.attendedDays,
                        absent: student.absent,
                        late: student.late
                    });
                }
                const key = String(student.student_id);
                if (!lateStudentMap.has(key)) {
                    lateStudentMap.set(key, {
                        studentId: student.student_id,
                        studentName: [student.first_name, student.last_name].filter(Boolean).join(' '),
                        className: classItem.name, late: 0
                    });
                }
                lateStudentMap.get(key).late += student.late || 0;
            }

            for (const record of records) {
                const date = dateValue(record.date);
                if (!daily.has(date)) daily.set(date, { date, present: 0, late: 0, absent: 0, leave: 0 });
                const day = daily.get(date);
                if (record.status === 'Present') day.present += 1;
                else if (record.status === 'Late') day.late += 1;
                else if (record.status === 'Absent') day.absent += 1;
                else if (record.status === 'Leave') day.leave += 1;
            }

            const classTotalDays = rows.reduce((sum, student) => sum + (student.totalDays || 0), 0);
            const classAttendedDays = rows.reduce((sum, student) => sum + (student.attendedDays || 0), 0);
            classComparison.push({
                classId: classItem.id, className: classItem.name,
                attendanceRate: classTotalDays > 0
                    ? Math.round((classAttendedDays / classTotalDays) * 1000) / 10 : null,
                totalStudentDays: classTotalDays,
                attendedStudentDays: classAttendedDays,
                studentsTracked: rows.length,
                lowAttendanceCount: rows.filter(student => student.belowThreshold).length,
                threshold: report.threshold === undefined ? null : report.threshold,
                thresholdError: report.thresholdError || null
            });
        }

        const attendanceRate = totalStudentDays > 0
            ? Math.round((totalAttendedDays / totalStudentDays) * 1000) / 10 : null;
        const dailySummary = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date))
            .map(day => {
                const marked = day.present + day.late + day.absent + day.leave;
                const attended = day.present + day.late + day.leave;
                return {
                    ...day, totalStudentDays: marked,
                    attendanceRate: marked > 0 ? Math.round((attended / marked) * 1000) / 10 : null
                };
            });
        lowAttendanceStudents.sort((a, b) =>
            (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101) ||
            a.studentName.localeCompare(b.studentName)
        );
        const topLateStudents = Array.from(lateStudentMap.values())
            .filter(student => student.late > 0)
            .sort((a, b) => b.late - a.late || a.studentName.localeCompare(b.studentName))
            .slice(0, 10);

        return {
            filters,
            overview: {
                attendanceRate, totalStudentDays, attendedStudentDays: totalAttendedDays,
                studentsTracked: studentIds.size, lowAttendanceCount: lowAttendanceStudents.length,
                lateArrivals: totalLate, absences: totalAbsent, leaveDays: totalLeave,
                presentDays: totalPresent
            },
            classComparison, dailySummary, lowAttendanceStudents, topLateStudents
        };
    }

    return { getDashboard };
}

module.exports = { createAttendanceAnalyticsDashboardService };
