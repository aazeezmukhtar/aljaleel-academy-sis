'use strict';

function dateKeyInNigeria(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value).reduce((out, part) => {
        if (part.type !== 'literal') out[part.type] = part.value;
        return out;
    }, {});
    return parts.year + '-' + parts.month + '-' + parts.day;
}

function shiftDate(date, amount) {
    const value = new Date(date + 'T00:00:00Z');
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
}

function key(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
}

function weekday(date) {
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    return day === 0 ? 7 : day;
}

function covers(start, end, date) {
    return key(start) <= date && (!end || key(end) >= date);
}

function closureApplies(closure, classId, sectionId, date) {
    if (!covers(closure.start_date, closure.end_date, date)) return false;
    if (closure.scope_type === 'school') return true;
    if (closure.scope_type === 'section') return String(closure.section_id) === String(sectionId);
    return closure.scope_type === 'class' &&
        String(closure.section_id) === String(sectionId) &&
        String(closure.class_id) === String(classId);
}

function parseRunSummary(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return null; }
}

function createAttendanceOperationsService(db) {
    if (!db) throw new Error('An attendance operations database adapter is required.');

    async function getSchedulerHistory(nowIso) {
        let tableExists = false;
        if (db.DB_TYPE === 'postgres') {
            const result = await db.get(
                "SELECT to_regclass('public.attendance_scheduler_runs') AS table_name", []
            );
            tableExists = Boolean(result && result.table_name);
        } else {
            const result = await db.get(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
                ['attendance_scheduler_runs']
            );
            tableExists = Boolean(result);
        }
        if (!tableExists) {
            return {
                available: false, runs: [],
                summary: { total: 0, succeeded: 0, failed: 0, running: 0, staleRunning: 0 },
                latest: null
            };
        }

        const records = await db.all(`
            SELECT id, started_at, completed_at, status, summary, error_message
            FROM attendance_scheduler_runs
            ORDER BY started_at DESC, id DESC
            LIMIT 20
        `, []);
        const now = new Date(nowIso).getTime();
        const runs = records.map(record => {
            const startedAt = record.started_at instanceof Date
                ? record.started_at.toISOString() : String(record.started_at);
            const ageMinutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
            return {
                id: record.id, startedAt, completedAt: record.completed_at || null,
                status: record.status, ageMinutes,
                stale: record.status === 'running' && ageMinutes >= 15,
                summary: parseRunSummary(record.summary),
                errorMessage: record.error_message || null
            };
        });
        return {
            available: true,
            runs,
            latest: runs[0] || null,
            summary: {
                total: runs.length,
                succeeded: runs.filter(run => run.status === 'succeeded').length,
                failed: runs.filter(run => run.status === 'failed').length,
                running: runs.filter(run => run.status === 'running').length,
                staleRunning: runs.filter(run => run.stale).length
            }
        };
    }

    async function getOperations(input) {
        const schoolId = Number(input && input.schoolId);
        if (!Number.isSafeInteger(schoolId) || schoolId <= 0) throw new Error('A valid school is required.');
        const today = dateKeyInNigeria(input && input.now ? new Date(input.now) : new Date());
        const startDate = shiftDate(today, -13);
        const nowIso = input && input.now ? new Date(input.now).toISOString() : new Date().toISOString();

        const [classes, periods, schedules, closures, registers] = await Promise.all([
            db.all(`SELECT c.id AS class_id, c.name AS class_name, c.section_id, s.name AS section_name
                FROM classes c JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id
                WHERE c.school_id = ? ORDER BY s.name, c.name`, [schoolId]),
            db.all(`SELECT id, section_id, session, term, start_date, end_date
                FROM section_academic_periods
                WHERE school_id = ? AND status IN ('active', 'completed')
                  AND start_date <= ? AND end_date >= ?`, [schoolId, today, startDate]),
            db.all(`SELECT class_id, section_id, weekday, effective_from, effective_to
                FROM class_attendance_schedules
                WHERE school_id = ? AND effective_from <= ?
                  AND (effective_to IS NULL OR effective_to >= ?)`, [schoolId, today, startDate]),
            db.all(`SELECT scope_type, section_id, class_id, start_date, end_date
                FROM class_attendance_closures
                WHERE school_id = ? AND status = 'approved'
                  AND start_date <= ? AND end_date >= ?`, [schoolId, today, startDate]),
            db.all(`SELECT ar.id, ar.class_id, ar.section_id, ar.register_date, ar.status,
                       ar.submission_deadline_at, ar.responsibility_id,
                       st.first_name AS teacher_first_name, st.last_name AS teacher_last_name
                FROM attendance_registers ar
                LEFT JOIN class_attendance_responsibilities cr ON cr.id = ar.responsibility_id
                LEFT JOIN staff st ON st.id = cr.staff_id AND st.school_id = ar.school_id
                WHERE ar.school_id = ? AND ar.register_date BETWEEN ? AND ?
                ORDER BY ar.register_date DESC, ar.id DESC`, [schoolId, startDate, today])
        ]);

        const reminders = await db.all(`SELECT r.id, r.register_id, r.recipient_staff_id,
                r.reminder_stage, r.reminder_type, r.scheduled_at, r.sent_at,
                r.acknowledged_at, r.status, r.attempt_count, r.last_error,
                st.first_name, st.last_name
            FROM attendance_register_reminders r
            JOIN attendance_registers ar ON ar.id = r.register_id
            LEFT JOIN staff st ON st.id = r.recipient_staff_id AND st.school_id = ar.school_id
            WHERE ar.school_id = ? AND ar.register_date BETWEEN ? AND ?
            ORDER BY r.scheduled_at DESC, r.id DESC`, [schoolId, startDate, today]);

        const schedulerHistory = await getSchedulerHistory(nowIso);
        const classMap = new Map(classes.map(item => [String(item.class_id), item]));
        const registerMap = new Map(registers.map(item => [String(item.class_id) + '|' + key(item.register_date), item]));
        const remindersByRegister = new Map();
        for (const reminder of reminders) {
            const list = remindersByRegister.get(String(reminder.register_id)) || [];
            list.push(reminder);
            remindersByRegister.set(String(reminder.register_id), list);
        }

        const expected = new Map();
        for (let date = startDate; date <= today; date = shiftDate(date, 1)) {
            for (const schedule of schedules) {
                if (Number(schedule.weekday) !== weekday(date) ||
                    !covers(schedule.effective_from, schedule.effective_to, date)) continue;
                const classInfo = classMap.get(String(schedule.class_id));
                if (!classInfo || String(classInfo.section_id) !== String(schedule.section_id)) continue;
                const period = periods.find(item => String(item.section_id) === String(schedule.section_id) &&
                    covers(item.start_date, item.end_date, date));
                if (!period || closures.some(item => closureApplies(item, schedule.class_id, schedule.section_id, date))) continue;
                const id = String(schedule.class_id) + '|' + date;
                if (expected.has(id)) continue;
                const register = registerMap.get(id) || null;
                const status = !register ? 'missing' : register.status === 'submitted' ? 'submitted' : 'incomplete';
                const deadline = register && register.submission_deadline_at
                    ? new Date(register.submission_deadline_at).getTime() : null;
                const isOverdue = status === 'incomplete' && deadline !== null && deadline <= new Date(nowIso).getTime();
                const registerReminders = register ? (remindersByRegister.get(String(register.id)) || []) : [];
                expected.set(id, {
                    key: id, classId: classInfo.class_id, className: classInfo.class_name,
                    sectionId: classInfo.section_id, sectionName: classInfo.section_name,
                    date, session: period.session, term: period.term,
                    status, overdue: isOverdue,
                    registerId: register ? register.id : null,
                    deadline: register ? register.submission_deadline_at : null,
                    responsibleTeacher: register
                        ? [register.teacher_first_name, register.teacher_last_name].filter(Boolean).join(' ') : '',
                    reminderCount: registerReminders.length,
                    reminders: registerReminders.map(item => ({
                        id: item.id, stage: item.reminder_stage, type: item.reminder_type,
                        recipient: [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unknown staff',
                        scheduledAt: item.scheduled_at, sentAt: item.sent_at,
                        acknowledgedAt: item.acknowledged_at, status: item.status,
                        attemptCount: Number(item.attempt_count || 0), lastError: item.last_error || null
                    }))
                });
            }
        }

        const rows = Array.from(expected.values()).sort((a, b) =>
            b.date.localeCompare(a.date) || a.sectionName.localeCompare(b.sectionName) ||
            a.className.localeCompare(b.className)
        );
        const summary = {
            expected: rows.length,
            submitted: rows.filter(row => row.status === 'submitted').length,
            incomplete: rows.filter(row => row.status === 'incomplete').length,
            missing: rows.filter(row => row.status === 'missing').length,
            overdue: rows.filter(row => row.overdue).length,
            reminders: reminders.length,
            pendingReminders: reminders.filter(item => item.status === 'pending').length,
            failedReminders: reminders.filter(item => item.status === 'failed').length,
            escalations: reminders.filter(item => item.reminder_type === 'administrator_escalation').length
        };
        return { startDate, endDate: today, summary, rows, reminderHistory: reminders, schedulerHistory };
    }

    return { getOperations };
}

module.exports = { createAttendanceOperationsService };
