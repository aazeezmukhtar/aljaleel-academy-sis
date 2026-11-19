'use strict';

const VALID_STATUSES = new Set(['Present', 'Late', 'Absent', 'Leave']);

function normalizeDate(value, label = 'Date') {
    const date = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(label + ' must use YYYY-MM-DD format.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error(label + ' is not a valid calendar date.');
    }
    return date;
}

function normalizeDateValue(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
    return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function calculateAttendanceSummary(records, threshold = null) {
    const counts = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const record of records || []) {
        if (record.status === 'Present') counts.present += 1;
        else if (record.status === 'Late') counts.late += 1;
        else if (record.status === 'Absent') counts.absent += 1;
        else if (record.status === 'Leave') counts.leave += 1;
    }
    const totalDays = counts.present + counts.late + counts.absent + counts.leave;
    const attendedDays = counts.present + counts.late + counts.leave;
    const attendanceRate = totalDays > 0
        ? Math.round((attendedDays / totalDays) * 1000) / 10
        : null;
    const numericThreshold = threshold === null || threshold === undefined || threshold === ''
        ? null : Number(threshold);
    return {
        ...counts,
        totalDays,
        attendedDays,
        attendanceRate,
        absenceRate: totalDays > 0 ? Math.round((counts.absent / totalDays) * 1000) / 10 : null,
        lateRate: totalDays > 0 ? Math.round((counts.late / totalDays) * 1000) / 10 : null,
        threshold: Number.isFinite(numericThreshold) ? numericThreshold : null,
        belowThreshold: attendanceRate !== null && Number.isFinite(numericThreshold)
            ? attendanceRate < numericThreshold : false
    };
}

function createAttendanceAnalyticsService(db) {
    if (!db) throw new Error('An attendance analytics database adapter is required.');
    const { createAttendanceRegisterWorkflowService } = require('./attendanceRegisterWorkflowService');
    const registerWorkflow = createAttendanceRegisterWorkflowService(db);

    async function hasRegisterFoundation() {
        return registerWorkflow.isFoundationAvailable();
    }

    async function getAttendanceThreshold(input) {
        const schoolId = Number(input.schoolId);
        const classId = Number(input.classId);
        const sectionId = Number(input.sectionId);
        const referenceDate = normalizeDate(input.referenceDate || input.endDate || input.startDate);
        const row = await db.get(`
            SELECT low_attendance_threshold
            FROM class_attendance_settings
            WHERE school_id = ? AND class_id = ? AND section_id = ?
              AND effective_from <= ?
              AND (effective_to IS NULL OR effective_to >= ?)
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
        `, [schoolId, classId, sectionId, referenceDate, referenceDate]);
        return row ? Number(row.low_attendance_threshold) : null;
    }

    function buildRegisterEligibilityClause(alias = 'a', classAlias = 'c') {
        return `(
            NOT EXISTS (
                SELECT 1 FROM attendance_registers ar
                WHERE ar.school_id = ${classAlias}.school_id
                  AND ar.class_id = ${alias}.class_id
                  AND ar.section_id = ${alias}.section_id
                  AND ar.register_date = ${alias}.date
            )
            OR EXISTS (
                SELECT 1
                FROM attendance_registers ar
                JOIN attendance_register_students rs ON rs.register_id = ar.id
                WHERE ar.school_id = ${classAlias}.school_id
                  AND ar.class_id = ${alias}.class_id
                  AND ar.section_id = ${alias}.section_id
                  AND ar.register_date = ${alias}.date
                  AND ar.status = 'submitted'
                  AND rs.student_id = ${alias}.student_id
            )
        )`;
    }

    async function getStudentAttendanceRecords(input) {
        const schoolId = Number(input && input.schoolId);
        const studentId = Number(input && input.studentId);
        const sectionId = Number(input && input.sectionId);
        if (![schoolId, studentId, sectionId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, student and section are required for attendance analytics.');
        }
        const conditions = [
            'a.student_id = ?',
            'a.section_id = ?',
            'c.school_id = ?',
            'c.section_id = a.section_id'
        ];
        const params = [studentId, sectionId, schoolId];
        if (input.startDate) {
            conditions.push('a.date >= ?');
            params.push(normalizeDate(input.startDate, 'Start date'));
        }
        if (input.endDate) {
            conditions.push('a.date <= ?');
            params.push(normalizeDate(input.endDate, 'End date'));
        }
        if (input.session) {
            conditions.push('a.session = ?');
            params.push(String(input.session));
        }
        if (input.term) {
            conditions.push('a.term = ?');
            params.push(String(input.term));
        }
        if (await hasRegisterFoundation()) {
            conditions.push(buildRegisterEligibilityClause('a', 'c'));
        }
        const rows = await db.all(`
            SELECT a.id, a.date, a.status, a.reason, a.reason_type, a.custom_reason,
                   a.session, a.term, a.class_id
            FROM attendance a
            JOIN classes c ON c.id = a.class_id
            JOIN students s ON s.id = a.student_id AND s.school_id = c.school_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY a.date DESC, a.id DESC
        `, params);
        return rows.map(row => ({ ...row, date: normalizeDateValue(row.date) }))
            .filter(row => VALID_STATUSES.has(row.status));
    }

    async function getClassAttendanceReport(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const sectionId = Number(input && input.sectionId);
        const startDate = normalizeDate(input && input.startDate, 'Start date');
        const endDate = normalizeDate(input && input.endDate, 'End date');
        if (![schoolId, classId, sectionId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid school, class and section are required for attendance analytics.');
        }
        if (endDate < startDate) throw new Error('End date cannot be earlier than start date.');

        const conditions = [
            'a.class_id = ?', 'a.section_id = ?', 'c.school_id = ?',
            'c.section_id = a.section_id', 'a.date BETWEEN ? AND ?'
        ];
        const params = [classId, sectionId, schoolId, startDate, endDate];
        if (input.session) {
            conditions.push('a.session = ?');
            params.push(String(input.session));
        }
        if (input.term) {
            conditions.push('a.term = ?');
            params.push(String(input.term));
        }
        if (await hasRegisterFoundation()) {
            conditions.push(buildRegisterEligibilityClause('a', 'c'));
        }
        const records = await db.all(`
            SELECT s.id AS student_id, s.first_name, s.last_name,
                   a.date, a.status
            FROM attendance a
            JOIN classes c ON c.id = a.class_id
            JOIN students s ON s.id = a.student_id AND s.school_id = c.school_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY s.last_name, s.first_name, a.date
        `, params);

        const referenceDate = endDate;
        const threshold = await getAttendanceThreshold({
            schoolId, classId, sectionId, referenceDate
        }).catch(() => null);
        const grouped = new Map();
        for (const record of records) {
            if (!VALID_STATUSES.has(record.status)) continue;
            const key = String(record.student_id);
            if (!grouped.has(key)) {
                grouped.set(key, {
                    student_id: record.student_id,
                    first_name: record.first_name,
                    last_name: record.last_name,
                    records: []
                });
            }
            grouped.get(key).records.push(record);
        }
        const rows = Array.from(grouped.values()).map(student => ({
            student_id: student.student_id,
            first_name: student.first_name,
            last_name: student.last_name,
            ...calculateAttendanceSummary(student.records, threshold)
        }));
        const registerCompletion = await getRegisterCompletion({
            schoolId, classId, sectionId, startDate, endDate
        });
        return {
            rows, threshold, registerCompletion, recordCount: records.length,
            records: records.filter(record => VALID_STATUSES.has(record.status)).map(record => ({
                ...record, date: normalizeDateValue(record.date)
            }))
        };
    }

    async function getRegisterCompletion(input) {
        if (!(await hasRegisterFoundation())) {
            return { generatedRegisters: null, submittedRegisters: null, pendingRegisters: null, completionRate: null };
        }
        const row = await db.get(`
            SELECT COUNT(*) AS expected_registers,
                   SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_registers,
                   SUM(CASE WHEN status IN ('expected', 'in_progress', 'reopened') THEN 1 ELSE 0 END) AS pending_registers
            FROM attendance_registers
            WHERE school_id = ? AND class_id = ? AND section_id = ?
              AND register_date BETWEEN ? AND ?
        `, [input.schoolId, input.classId, input.sectionId, input.startDate, input.endDate]);
        const generatedRegisters = Number(row && row.expected_registers || 0);
        const submittedRegisters = Number(row && row.submitted_registers || 0);
        const pendingRegisters = Number(row && row.pending_registers || 0);
        return {
            generatedRegisters,
            submittedRegisters,
            pendingRegisters,
            completionRate: generatedRegisters > 0
                ? Math.round((submittedRegisters / generatedRegisters) * 1000) / 10 : null
        };
    }

    return {
        getStudentAttendanceRecords,
        getClassAttendanceReport,
        getAttendanceThreshold,
        getRegisterCompletion,
        calculateAttendanceSummary
    };
}

module.exports = {
    VALID_STATUSES,
    normalizeDate,
    normalizeDateValue,
    calculateAttendanceSummary,
    createAttendanceAnalyticsService
};
