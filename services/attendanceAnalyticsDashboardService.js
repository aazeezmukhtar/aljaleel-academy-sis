'use strict';

const { normalizeDate } = require('./attendanceAnalyticsService');
const { createAttendanceScheduleService } = require('./attendanceScheduleService');

function addDays(date, amount) {
    const value = new Date(date + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
}

function dateCovers(start, end, date) {
    const startKey = start instanceof Date ? start.toISOString().slice(0, 10) : String(start).slice(0, 10);
    const endKey = end instanceof Date ? end.toISOString().slice(0, 10) : (end ? String(end).slice(0, 10) : null);
    return startKey <= date && (!endKey || endKey >= date);
}

function closureCovers(closure, classId, sectionId, date) {
    if (!dateCovers(closure.start_date, closure.end_date, date)) return false;
    if (closure.scope_type === 'school') return true;
    if (closure.scope_type === 'section') return String(closure.section_id) === String(sectionId);
    return closure.scope_type === 'class' &&
        String(closure.section_id) === String(sectionId) &&
        String(closure.class_id) === String(classId);
}

function summarize(records) {
    const result = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const record of records) {
        if (record.status === 'Present') result.present += 1;
        else if (record.status === 'Late') result.late += 1;
        else if (record.status === 'Absent') result.absent += 1;
        else if (record.status === 'Leave') result.leave += 1;
    }
    const totalDays = result.present + result.late + result.absent + result.leave;
    const attendedDays = result.present + result.late + result.leave;
    return {
        ...result,
        totalDays,
        attendedDays,
        attendanceRate: totalDays > 0 ? Math.round((attendedDays / totalDays) * 1000) / 10 : null
    };
}

function createAttendanceAnalyticsDashboardService(db, analyticsService) {
    if (!db || !analyticsService) {
        throw new Error('Attendance dashboard service requires the database and shared analytics service.');
    }

    const scheduleService = createAttendanceScheduleService(db);

    async function getDashboard(input) {
        const schoolId = Number(input && input.schoolId);
        const sectionId = Number(input && input.sectionId);
        const session = String(input && input.session || '').trim();
        const term = String(input && input.term || '').trim();
        const startDate = normalizeDate(input && input.startDate, 'Start date');
        const endDate = normalizeDate(input && input.endDate, 'End date');
        if (![schoolId, sectionId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school and section are required for attendance analytics.');
        }
        if (!session || !term) throw new Error('Select an academic session and term.');
        if (endDate < startDate) throw new Error('End date cannot be earlier than start date.');
        const daySpan = Math.floor((new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000) + 1;
        if (daySpan > 366) throw new Error('Attendance analytics date range cannot exceed 366 days.');

        const classIds = Array.from(new Set((input.classIds || []).map(Number)
            .filter(value => Number.isSafeInteger(value) && value > 0)));
        if (!classIds.length) {
            return emptyDashboard({ schoolId, sectionId, session, term, startDate, endDate });
        }
        const placeholders = classIds.map(() => '?').join(',');
        const classes = await db.all(`
            SELECT id, name FROM classes
            WHERE school_id = ? AND section_id = ? AND id IN (${placeholders})
            ORDER BY name, id
        `, [schoolId, sectionId, ...classIds]);
        if (!classes.length) return emptyDashboard({ schoolId, sectionId, session, term, startDate, endDate });

        const periods = await db.all(`
            SELECT id, start_date, end_date
            FROM section_academic_periods
            WHERE school_id = ? AND section_id = ? AND session = ? AND term = ?
              AND status <> 'cancelled'
              AND start_date <= ? AND end_date >= ?
        `, [schoolId, sectionId, session, term, endDate, startDate]);
        if (!periods.length) {
            return emptyDashboard({ schoolId, sectionId, session, term, startDate, endDate, classIds });
        }
        const periodStart = periods.map(period => period.start_date instanceof Date
            ? period.start_date.toISOString().slice(0, 10) : String(period.start_date).slice(0, 10))
            .sort()[0];
        const periodEnd = periods.map(period => period.end_date instanceof Date
            ? period.end_date.toISOString().slice(0, 10) : String(period.end_date).slice(0, 10))
            .sort().slice(-1)[0];
        const effectiveStartDate = startDate < periodStart ? periodStart : startDate;
        const effectiveEndDate = endDate > periodEnd ? periodEnd : endDate;
        if (effectiveEndDate < effectiveStartDate) {
            return emptyDashboard({ schoolId, sectionId, session, term, startDate: effectiveStartDate, endDate: effectiveEndDate, classIds });
        }
        const closures = await db.all(`
            SELECT scope_type, section_id, class_id, start_date, end_date
            FROM class_attendance_closures
            WHERE school_id = ? AND status = 'approved'
              AND start_date <= ? AND end_date >= ?
            ORDER BY id
        `, [schoolId, effectiveEndDate, effectiveStartDate]);
        const registers = await db.all(`
            SELECT id, class_id, section_id, register_date, status
            FROM attendance_registers
            WHERE school_id = ? AND section_id = ?
              AND class_id IN (${placeholders})
              AND register_date BETWEEN ? AND ?
        `, [schoolId, sectionId, ...classIds, effectiveStartDate, effectiveEndDate]);

        const registersByKey = new Map(registers.map(register => {
            const date = register.register_date instanceof Date
                ? register.register_date.toISOString().slice(0, 10)
                : String(register.register_date).slice(0, 10);
            return [String(register.class_id) + '|' + date, register];
        }));

        const expectedDays = [];
        const scheduleIssues = [];
        const expectedKeys = new Set();
        const daily = new Map();
        const classExpected = new Map(classes.map(item => [String(item.id), {
            classId: item.id, className: item.name,
            expectedClassDays: 0, submittedRegisters: 0,
            incompleteRegisters: 0, missingRegisters: 0
        }]));

        for (let date = effectiveStartDate; date <= effectiveEndDate; date = addDays(date, 1)) {
            const insidePeriod = periods.some(period => dateCovers(period.start_date, period.end_date, date));
            if (!insidePeriod) continue;
            for (const classItem of classes) {
                let resolved;
                try {
                    resolved = await scheduleService.isExpectedSchoolDay({ schoolId, classId: Number(classItem.id), date });
                } catch (error) {
                    scheduleIssues.push({ classId: classItem.id, className: classItem.name,
                        sectionId, date, reason: error.code || 'schedule_resolution_error' });
                    continue;
                }
                if (!resolved.expected) continue;
                if (closures.some(closure => closureCovers(closure, classItem.id, sectionId, date))) continue;
                const key = String(classItem.id) + '|' + date;
                if (expectedKeys.has(key)) continue;
                expectedKeys.add(key);
                const register = registersByKey.get(key);
                const status = !register ? 'missing' :
                    register.status === 'submitted' ? 'submitted' : 'incomplete';
                expectedDays.push({ key, classId: classItem.id, date, status,
                    scheduleSetId: resolved.scheduleSetId, scheduleSource: resolved.source });
                const classStats = classExpected.get(String(classItem.id));
                if (classStats) {
                    classStats.expectedClassDays += 1;
                    if (status === 'submitted') classStats.submittedRegisters += 1;
                    else if (status === 'missing') classStats.missingRegisters += 1;
                    else classStats.incompleteRegisters += 1;
                }
                if (!daily.has(date)) {
                    daily.set(date, {
                        date, expectedClassDays: 0, submittedRegisters: 0,
                        incompleteRegisters: 0, missingRegisters: 0,
                        present: 0, late: 0, absent: 0, leave: 0
                    });
                }
                const dailyStats = daily.get(date);
                dailyStats.expectedClassDays += 1;
                if (status === 'submitted') dailyStats.submittedRegisters += 1;
                else if (status === 'missing') dailyStats.missingRegisters += 1;
                else dailyStats.incompleteRegisters += 1;
            }
        }

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
                startDate: effectiveStartDate, endDate: effectiveEndDate, session, term
            });
            const classStats = classExpected.get(String(classItem.id));
            const totals = summarize(report.records || []);
            totalStudentDays += totals.totalDays;
            totalAttendedDays += totals.attendedDays;
            totalPresent += totals.present;
            totalLate += totals.late;
            totalAbsent += totals.absent;
            totalLeave += totals.leave;

            for (const student of report.rows) {
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
                const studentKey = String(student.student_id);
                if (!lateStudentMap.has(studentKey)) {
                    lateStudentMap.set(studentKey, {
                        studentId: student.student_id,
                        studentName: [student.first_name, student.last_name].filter(Boolean).join(' '),
                        className: classItem.name,
                        late: 0
                    });
                }
                lateStudentMap.get(studentKey).late += student.late;
            }

            for (const record of report.records || []) {
                if (!daily.has(record.date)) continue;
                const dailyStats = daily.get(record.date);
                if (record.status === 'Present') dailyStats.present += 1;
                else if (record.status === 'Late') dailyStats.late += 1;
                else if (record.status === 'Absent') dailyStats.absent += 1;
                else if (record.status === 'Leave') dailyStats.leave += 1;
            }

            const classTotalDays = report.rows.reduce((sum, student) => sum + student.totalDays, 0);
            const classAttendedDays = report.rows.reduce((sum, student) => sum + student.attendedDays, 0);
            classComparison.push({
                classId: classItem.id,
                className: classItem.name,
                attendanceRate: classTotalDays > 0
                    ? Math.round((classAttendedDays / classTotalDays) * 1000) / 10 : null,
                totalStudentDays: classTotalDays,
                attendedStudentDays: classAttendedDays,
                lowAttendanceCount: report.rows.filter(student => student.belowThreshold).length,
                threshold: report.threshold,
                ...classStats
            });
        }

        const expectedClassDays = expectedDays.length;
        const submittedRegisters = expectedDays.filter(day => day.status === 'submitted').length;
        const incompleteRegisters = expectedDays.filter(day => day.status === 'incomplete').length;
        const missingRegisters = expectedDays.filter(day => day.status === 'missing').length;
        const attendanceRate = totalStudentDays > 0
            ? Math.round((totalAttendedDays / totalStudentDays) * 1000) / 10 : null;
        const dailySummary = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date))
            .map(day => {
                const marked = day.present + day.late + day.absent + day.leave;
                const attended = day.present + day.late + day.leave;
                return {
                    ...day,
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
            filters: { schoolId, sectionId, session, term, startDate: effectiveStartDate, endDate: effectiveEndDate, classIds },
            overview: {
                attendanceRate,
                totalStudentDays,
                attendedStudentDays: totalAttendedDays,
                studentsTracked: studentIds.size,
                lowAttendanceCount: lowAttendanceStudents.length,
                lateArrivals: totalLate,
                absences: totalAbsent,
                leaveDays: totalLeave
            },
            registerCompletion: {
                expectedClassDays,
                submittedRegisters,
                incompleteRegisters,
                missingRegisters,
                completionRate: expectedClassDays > 0
                    ? Math.round((submittedRegisters / expectedClassDays) * 1000) / 10 : null
            },
            classComparison,
            scheduleIssues,
            dailySummary,
            lowAttendanceStudents,
            topLateStudents
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
            registerCompletion: {
                expectedClassDays: 0, submittedRegisters: 0,
                incompleteRegisters: 0, missingRegisters: 0, completionRate: null
            },
            classComparison: [], scheduleIssues: [], dailySummary: [], lowAttendanceStudents: [], topLateStudents: []
        };
    }

    return { getDashboard };
}

module.exports = { createAttendanceAnalyticsDashboardService };
