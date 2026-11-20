'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function date(value, label) {
    const v = String(value || '').trim();
    if (!DATE_RE.test(v) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw new Error((label || 'Date') + ' is invalid; use YYYY-MM-DD.');
    return v;
}
function overlaps(a, b, c, d) { return a <= (d || '9999-12-31') && c <= (b || '9999-12-31'); }
function createAttendanceSetupService(db) {
    if (!db) throw new Error('Attendance setup database adapter is required.');
    const sql = parts => parts.join(' ');
    async function admin(input, client) {
        const schoolId = Number(input.schoolId), actorStaffId = Number(input.actorStaffId);
        if (![schoolId, actorStaffId].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Valid school and administrator are required.');
        const actor = await db.get('SELECT id, role FROM staff WHERE id = ? AND school_id = ?', [actorStaffId, schoolId], client);
        if (!actor || actor.role !== 'Admin') throw new Error('Only a school administrator may manage attendance setup.');
        if (db.DB_TYPE === 'postgres') await db.get('SELECT id FROM schools WHERE id = ? FOR UPDATE', [schoolId], client);
        return { schoolId, actorStaffId };
    }
    async function ownership(schoolId, classId, sectionId, client) {
        const section = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?', [sectionId, schoolId], client);
        const clazz = await db.get('SELECT id FROM classes WHERE id = ? AND school_id = ? AND section_id = ?', [classId, schoolId, sectionId], client);
        if (!section || !clazz) throw new Error('The selected class and section do not belong to this school.');
    }
    async function log(client, entity, id, action, actor, after, reason) {
        await db.run('INSERT INTO attendance_foundation_audit_logs (entity_type, entity_id, action, actor_staff_id, after_data, reason) VALUES (?, ?, ?, ?, ?, ?)',
            [entity, id, action, actor, JSON.stringify(after), reason || null], client);
    }
    async function listSetup(input) {
        const schoolId = Number(input.schoolId), actorStaffId = Number(input.actorStaffId);
        const a = await db.get('SELECT id, role FROM staff WHERE id = ? AND school_id = ?', [actorStaffId, schoolId]);
        if (!a || a.role !== 'Admin') throw new Error('Only a school administrator may view attendance setup.');
        const [sections, classes, staff, periods, schedules, responsibilities, settings] = await Promise.all([
            db.all('SELECT id, name FROM sections WHERE school_id = ? ORDER BY name', [schoolId]),
            db.all('SELECT c.id, c.name, c.section_id, s.name AS section_name FROM classes c JOIN sections s ON s.id = c.section_id AND s.school_id = c.school_id WHERE c.school_id = ? ORDER BY s.name, c.name', [schoolId]),
            db.all("SELECT id, first_name, last_name, role FROM staff WHERE school_id = ? AND status = 'active' ORDER BY first_name, last_name", [schoolId]),
            db.all('SELECT p.*, s.name AS section_name FROM section_academic_periods p JOIN sections s ON s.id = p.section_id WHERE p.school_id = ? ORDER BY p.start_date DESC, p.id DESC', [schoolId]),
            db.all('SELECT a.*, c.name AS class_name, s.name AS section_name FROM class_attendance_schedules a JOIN classes c ON c.id = a.class_id JOIN sections s ON s.id = a.section_id WHERE a.school_id = ? ORDER BY a.effective_from DESC, a.class_id, a.weekday', [schoolId]),
            db.all('SELECT r.*, c.name AS class_name, s.name AS section_name, st.first_name, st.last_name FROM class_attendance_responsibilities r JOIN classes c ON c.id = r.class_id JOIN sections s ON s.id = r.section_id JOIN staff st ON st.id = r.staff_id WHERE r.school_id = ? ORDER BY r.effective_from DESC, r.class_id', [schoolId]),
            db.all('SELECT a.*, c.name AS class_name, s.name AS section_name FROM class_attendance_settings a JOIN classes c ON c.id = a.class_id JOIN sections s ON s.id = a.section_id WHERE a.school_id = ? ORDER BY a.effective_from DESC, a.class_id', [schoolId])
        ]);
        return { sections, classes, staff, periods, schedules, responsibilities, settings };
    }
    async function createAcademicPeriod(i) {
        const start = date(i.startDate, 'Start date'), end = date(i.endDate, 'End date'), session = String(i.session || '').trim(), term = String(i.term || '').trim();
        if (end < start || !session || !term || session.length > 40 || term.length > 40) throw new Error('Enter a valid session, term and date range.');
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(i, client), sectionId = Number(i.sectionId);
            const section = await db.get('SELECT id FROM sections WHERE id = ? AND school_id = ?', [sectionId, schoolId], client);
            if (!section) throw new Error('The selected section does not belong to this school.');
            const conflict = await db.get('SELECT id FROM section_academic_periods WHERE school_id = ? AND section_id = ? AND status <> ? AND start_date <= ? AND end_date >= ?', [schoolId, sectionId, 'cancelled', end, start], client);
            if (conflict) throw new Error('This date range overlaps an existing academic period for the section.');
            const row = await db.get('INSERT INTO section_academic_periods (school_id, section_id, session, term, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [schoolId, sectionId, session, term, start, end, 'active'], client);
            const after = { section_id: sectionId, session, term, start_date: start, end_date: end, status: 'active' };
            await log(client, 'section_academic_period', row.id, 'academic_period_created', actorStaffId, after);
            return row;
        });
    }
    async function createSchedule(i) {
        const start = date(i.startDate, 'Effective from'), end = i.endDate ? date(i.endDate, 'Effective to') : null, weekday = Number(i.weekday);
        if (end && end < start || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('Choose a valid weekday and effective date range.');
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(i, client), classId = Number(i.classId), sectionId = Number(i.sectionId);
            await ownership(schoolId, classId, sectionId, client);
            const rows = await db.all('SELECT effective_from, effective_to FROM class_attendance_schedules WHERE school_id = ? AND class_id = ? AND section_id = ? AND weekday = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)',
                [schoolId, classId, sectionId, weekday, end || '9999-12-31', start], client);
            if (rows.some(r => overlaps(start, end, String(r.effective_from).slice(0,10), r.effective_to && String(r.effective_to).slice(0,10)))) throw new Error('An opening-day schedule already overlaps these dates.');
            const row = await db.get('INSERT INTO class_attendance_schedules (school_id, class_id, section_id, weekday, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [schoolId, classId, sectionId, weekday, start, end, actorStaffId], client);
            await log(client, 'class_attendance_schedule', row.id, 'schedule_created', actorStaffId, { class_id: classId, section_id: sectionId, weekday, effective_from: start, effective_to: end });
            return row;
        });
    }
    async function createResponsibility(i) {
        const start = date(i.startDate, 'Effective from'), end = i.endDate ? date(i.endDate, 'Effective to') : null, type = String(i.responsibilityType || '');
        if (end && end < start || !['primary', 'substitute'].includes(type)) throw new Error('Choose a valid responsibility type and effective date range.');
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(i, client), classId = Number(i.classId), sectionId = Number(i.sectionId), staffId = Number(i.staffId);
            await ownership(schoolId, classId, sectionId, client);
            const teacher = await db.get("SELECT id FROM staff WHERE id = ? AND school_id = ? AND status = 'active'", [staffId, schoolId], client);
            if (!teacher) throw new Error('Choose an active staff member from this school.');
            const rows = await db.all('SELECT effective_from, effective_to FROM class_attendance_responsibilities WHERE school_id = ? AND class_id = ? AND section_id = ? AND responsibility_type = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)',
                [schoolId, classId, sectionId, type, end || '9999-12-31', start], client);
            if (rows.some(r => overlaps(start, end, String(r.effective_from).slice(0,10), r.effective_to && String(r.effective_to).slice(0,10)))) throw new Error('Another ' + type + ' teacher assignment overlaps these dates. End the earlier assignment first.');
            const row = await db.get('INSERT INTO class_attendance_responsibilities (school_id, class_id, section_id, staff_id, responsibility_type, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [schoolId, classId, sectionId, staffId, type, start, end, actorStaffId], client);
            await log(client, 'class_attendance_responsibility', row.id, 'responsibility_created', actorStaffId, { class_id: classId, section_id: sectionId, staff_id: staffId, responsibility_type: type, effective_from: start, effective_to: end });
            return row;
        });
    }
    async function createSettings(i) {
        const start = date(i.startDate, 'Effective from'), end = i.endDate ? date(i.endDate, 'Effective to') : null, deadline = String(i.deadline || '').trim();
        const delay = Number(i.firstReminderDelayMinutes), threshold = Number(i.lowAttendanceThreshold);
        let intervals = i.subsequentReminderIntervals;
        if (typeof intervals === 'string') { try { intervals = JSON.parse(intervals); } catch (_) { throw new Error('Reminder intervals must be a JSON array.'); } }
        if (end && end < start || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(deadline)) throw new Error('Choose a valid deadline and effective date range.');
        if (!Number.isSafeInteger(delay) || delay < 0 || delay > 10080 || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('Reminder delay or attendance threshold is outside the allowed range.');
        if (!Array.isArray(intervals) || intervals.length > 10 || intervals.some(n => !Number.isSafeInteger(Number(n)) || Number(n) < 1 || Number(n) > 10080)) throw new Error('Provide up to 10 reminder intervals, each between 1 and 10,080 minutes.');
        intervals = intervals.map(Number);
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(i, client), classId = Number(i.classId), sectionId = Number(i.sectionId);
            await ownership(schoolId, classId, sectionId, client);
            const rows = await db.all('SELECT effective_from, effective_to FROM class_attendance_settings WHERE school_id = ? AND class_id = ? AND section_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)',
                [schoolId, classId, sectionId, end || '9999-12-31', start], client);
            if (rows.some(r => overlaps(start, end, String(r.effective_from).slice(0,10), r.effective_to && String(r.effective_to).slice(0,10)))) throw new Error('Attendance settings already overlap these dates for this class.');
            const row = await db.get('INSERT INTO class_attendance_settings (school_id, class_id, section_id, effective_from, effective_to, submission_deadline_time, first_reminder_delay_minutes, subsequent_reminder_intervals_minutes, low_attendance_threshold, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [schoolId, classId, sectionId, start, end, deadline, delay, JSON.stringify(intervals), threshold, actorStaffId], client);
            await log(client, 'class_attendance_settings', row.id, 'settings_created', actorStaffId, { class_id: classId, section_id: sectionId, effective_from: start, effective_to: end, submission_deadline_time: deadline, first_reminder_delay_minutes: delay, subsequent_reminder_intervals_minutes: intervals, low_attendance_threshold: threshold });
            return row;
        });
    }
    async function endConfiguration(i) {
        const map = { academic_period: ['section_academic_periods','section_academic_period','end_date','start_date'], schedule: ['class_attendance_schedules','class_attendance_schedule','effective_to','effective_from'], responsibility: ['class_attendance_responsibilities','class_attendance_responsibility','effective_to','effective_from'], settings: ['class_attendance_settings','class_attendance_settings','effective_to','effective_from'] };
        const c = map[String(i.type)], id = Number(i.recordId), end = date(i.endDate, 'End date'), reason = String(i.reason || '').trim();
        if (!c || !Number.isSafeInteger(id) || id <= 0 || !reason || reason.length > 500) throw new Error('Choose a valid record and provide a reason (maximum 500 characters).');
        return db.transaction(async client => {
            const { schoolId, actorStaffId } = await admin(i, client);
            const before = await db.get('SELECT * FROM ' + c[0] + ' WHERE id = ? AND school_id = ?', [id, schoolId], client);
            if (!before) throw new Error('The selected configuration record was not found in this school.');
            if (end < String(before[c[3]]).slice(0,10)) throw new Error('The end date cannot be earlier than the configuration start date.');
            if (before[c[2]] && String(before[c[2]]).slice(0,10) <= end) throw new Error('This configuration already ends on or before the selected date.');
            await db.run('UPDATE ' + c[0] + ' SET ' + c[2] + ' = ? WHERE id = ? AND school_id = ?', [end, id, schoolId], client);
            const after = { ...before, [c[2]]: end };
            await db.run('INSERT INTO attendance_foundation_audit_logs (entity_type, entity_id, action, actor_staff_id, before_data, after_data, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [c[1], id, 'configuration_ended', actorStaffId, JSON.stringify(before), JSON.stringify(after), reason], client);
            return { id, endDate: end };
        });
    }
    return { listSetup, createAcademicPeriod, createSchedule, createResponsibility, createSettings, endConfiguration };
}
let singleton;
function service() { if (!singleton) singleton = createAttendanceSetupService(require('../utils/db')); return singleton; }
module.exports = {
    createAttendanceSetupService,
    listSetup: (...a) => service().listSetup(...a),
    createAcademicPeriod: (...a) => service().createAcademicPeriod(...a),
    createSchedule: (...a) => service().createSchedule(...a),
    createResponsibility: (...a) => service().createResponsibility(...a),
    createSettings: (...a) => service().createSettings(...a),
    endConfiguration: (...a) => service().endConfiguration(...a)
};
