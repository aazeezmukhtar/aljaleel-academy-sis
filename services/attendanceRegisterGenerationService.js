'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function normalizeDate(value) {
    const date = String(value || '').trim();
    if (!DATE_RE.test(date)) throw new Error('Register date must use YYYY-MM-DD format.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Register date is not a valid calendar date.');
    }
    return date;
}

function isoWeekday(date) {
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    return day === 0 ? 7 : day;
}

function localDateTimeToUtc(date, time, timezone) {
    if (!TIME_RE.test(String(time || ''))) {
        throw new Error('Attendance submission deadline must use HH:MM (24-hour) format.');
    }
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = String(time).split(':').map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let candidate = target;

    // Resolve the wall-clock time in the selected IANA timezone without
    // assuming the server process timezone. Africa/Lagos has no DST, but the
    // iterative conversion also supports zones with ordinary UTC offsets.
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(candidate)).reduce((result, part) => {
            if (part.type !== 'literal') result[part.type] = Number(part.value);
            return result;
        }, {});
        const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
        const difference = target - represented;
        if (difference === 0) break;
        candidate += difference;
    }

    const resolved = new Date(candidate);
    const check = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(resolved).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    const expected = { year: String(year), month: String(month).padStart(2, '0'), day: String(day).padStart(2, '0'),
        hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0') };
    if (Object.keys(expected).some(key => check[key] !== expected[key])) {
        throw new Error('The configured deadline does not resolve to a valid local time in ' + timezone + '.');
    }
    return resolved.toISOString();
}

function createAttendanceRegisterService(db) {
    if (!db) throw new Error('An attendance register database adapter is required.');
    const attendanceScheduleService = require('./attendanceScheduleCompatibilityService').createAttendanceScheduleCompatibilityService(db);
    async function generateExpectedRegister(input) {
        const schoolId = Number(input && input.schoolId);
        const classId = Number(input && input.classId);
        const registerDate = normalizeDate(input && input.registerDate);
        const generatedBy = input && input.generatedBy !== undefined && input.generatedBy !== null && input.generatedBy !== ''
            ? Number(input.generatedBy) : null;

        if (!Number.isSafeInteger(schoolId) || schoolId <= 0 ||
            !Number.isSafeInteger(classId) || classId <= 0) {
            throw new Error('A valid school and class are required to generate an attendance register.');
        }
        if (generatedBy !== null && (!Number.isSafeInteger(generatedBy) || generatedBy <= 0)) {
            throw new Error('Register generator staff ID is invalid.');
        }

        return db.transaction(async client => {
            if (generatedBy !== null) {
                const actor = await db.get(
                    'SELECT id FROM staff WHERE id = ? AND school_id = ?',
                    [generatedBy, schoolId], client
                );
                if (!actor) throw new Error('Register generator is not a staff member of this school.');
            }

            const clazz = await db.get(`
                SELECT c.id, c.school_id, c.section_id, s.school_id AS section_school_id
                FROM classes c
                JOIN sections s ON s.id = c.section_id
                WHERE c.id = ? AND c.school_id = ? AND s.school_id = ?
            `, [classId, schoolId, schoolId], client);
            if (!clazz) throw new Error('Class or its section does not belong to the selected school.');

            const academicPeriods = await db.all(`
                SELECT id, session, term
                FROM section_academic_periods
                WHERE school_id = ? AND section_id = ?
                  AND start_date <= ? AND end_date >= ?
                  AND status IN ('active', 'completed')
                ORDER BY start_date, id
            `, [schoolId, clazz.section_id, registerDate, registerDate], client);
            if (academicPeriods.length === 0) {
                return { created: false, skipped: true, reason: 'no_academic_period' };
            }
            if (academicPeriods.length !== 1) {
                throw new Error('More than one academic period covers this section and date.');
            }
            const academicPeriod = academicPeriods[0];

            const resolvedSchedule = await attendanceScheduleService.isExpectedSchoolDay({
                schoolId, classId, sectionId: clazz.section_id, date: registerDate
            }, client);
            if (!resolvedSchedule.configured) return { created: false, skipped: true, reason: 'missing_schedule' };
            if (!resolvedSchedule.expected) return { created: false, skipped: true, reason: 'not_a_scheduled_day',
                scheduleSetId: resolvedSchedule.scheduleSetId || null, scheduleSource: resolvedSchedule.source };

            const closures = await db.all(`
                SELECT id, scope_type
                FROM class_attendance_closures
                WHERE school_id = ? AND status = 'approved'
                  AND start_date <= ? AND end_date >= ?
                  AND (
                    scope_type = 'school'
                    OR (scope_type = 'section' AND section_id = ?)
                    OR (scope_type = 'class' AND section_id = ? AND class_id = ?)
                  )
                ORDER BY id
            `, [schoolId, registerDate, registerDate, clazz.section_id, clazz.section_id, classId], client);
            if (closures.length > 0) {
                return { created: false, skipped: true, reason: 'approved_closure', closureIds: closures.map(row => row.id) };
            }

            const settingsRows = await db.all(`
                SELECT id, submission_deadline_time, low_attendance_threshold
                FROM class_attendance_settings
                WHERE school_id = ? AND class_id = ? AND section_id = ?
                  AND effective_from <= ?
                  AND (effective_to IS NULL OR effective_to >= ?)
                ORDER BY effective_from DESC, id DESC
            `, [schoolId, classId, clazz.section_id, registerDate, registerDate], client);
            if (settingsRows.length === 0) {
                return { created: false, skipped: true, reason: 'attendance_settings_missing' };
            }
            if (settingsRows.length !== 1) {
                throw new Error('Overlapping attendance settings cover this class and date.');
            }
            const settings = settingsRows[0];

            const responsibilityRows = await db.all(`
                SELECT r.id, r.staff_id, r.responsibility_type, st.school_id AS staff_school_id
                FROM class_attendance_responsibilities r
                LEFT JOIN staff st ON st.id = r.staff_id
                WHERE r.school_id = ? AND r.class_id = ? AND r.section_id = ?
                  AND r.effective_from <= ?
                  AND (r.effective_to IS NULL OR r.effective_to >= ?)
                  AND r.responsibility_type IN ('primary', 'substitute')
                ORDER BY r.effective_from DESC, r.id DESC
            `, [schoolId, classId, clazz.section_id, registerDate, registerDate], client);
            if (responsibilityRows.some(row => Number(row.staff_school_id) !== schoolId)) {
                throw new Error('An active attendance responsibility points to staff outside this school.');
            }
            const substitutes = responsibilityRows.filter(row => row.responsibility_type === 'substitute');
            const primaries = responsibilityRows.filter(row => row.responsibility_type === 'primary');
            if (substitutes.length > 1 || primaries.length > 1) {
                throw new Error('Multiple active primary or substitute attendance responsibilities exist for this class and date.');
            }
            const responsibility = substitutes[0] || primaries[0] || null;

            const rosterRows = await db.all(`
                SELECT ep.id AS enrollment_period_id, ep.student_id, ep.date_status
                FROM student_enrollment_periods ep
                JOIN students s ON s.id = ep.student_id AND s.school_id = ep.school_id
                JOIN classes c ON c.id = ep.class_id AND c.school_id = ep.school_id
                JOIN sections sec ON sec.id = ep.section_id AND sec.school_id = ep.school_id
                WHERE ep.school_id = ? AND ep.class_id = ? AND ep.section_id = ?
                  AND c.section_id = ep.section_id
                  AND ep.session = ?
                  AND ep.start_date <= ?
                  AND (ep.end_date IS NULL OR ep.end_date >= ?)
                ORDER BY ep.student_id, ep.start_date, ep.id
            `, [schoolId, classId, clazz.section_id, academicPeriod.session, registerDate, registerDate], client);

            if (rosterRows.some(row => row.date_status !== 'confirmed')) {
                return { created: false, skipped: true, reason: 'enrollment_dates_need_review' };
            }
            const seenStudents = new Set();
            for (const row of rosterRows) {
                const key = String(row.student_id);
                if (seenStudents.has(key)) {
                    throw new Error('Overlapping dated enrollment periods produce duplicate roster membership for student ' + key + '.');
                }
                seenStudents.add(key);
            }

            const timezone = 'Africa/Lagos';
            const deadlineAt = localDateTimeToUtc(registerDate, settings.submission_deadline_time, timezone);
            const inserted = await db.get(`
                INSERT INTO attendance_registers (
                    school_id, class_id, section_id, academic_period_id, schedule_id, schedule_set_id,
                    responsibility_id, register_date, timezone, submission_deadline_at,
                    expected_student_count, submitted_student_count, status
                ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 'expected')
                ON CONFLICT (class_id, section_id, register_date) DO NOTHING
                RETURNING id
            `, [
                schoolId, classId, clazz.section_id, academicPeriod.id, resolvedSchedule.scheduleSetId,
                responsibility ? responsibility.id : null, registerDate, timezone,
                deadlineAt, rosterRows.length
            ], client);

            if (!inserted) {
                const existing = await db.get(`
                    SELECT id, status, expected_student_count
                    FROM attendance_registers
                    WHERE class_id = ? AND section_id = ? AND register_date = ?
                `, [classId, clazz.section_id, registerDate], client);
                return {
                    created: false, skipped: false, alreadyExists: true,
                    registerId: existing.id, status: existing.status,
                    expectedStudentCount: Number(existing.expected_student_count)
                };
            }

            for (const row of rosterRows) {
                await db.run(`
                    INSERT INTO attendance_register_students
                        (register_id, student_id, enrollment_period_id)
                    VALUES (?, ?, ?)
                `, [inserted.id, row.student_id, row.enrollment_period_id], client);
            }

            await db.run(`
                INSERT INTO attendance_register_events
                    (register_id, event_type, actor_staff_id, new_status, metadata)
                VALUES (?, 'generated', ?, 'expected', ?)
            `, [
                inserted.id, generatedBy,
                JSON.stringify({
                    expected_student_count: rosterRows.length,
                    academic_period_id: academicPeriod.id,
                    schedule_set_id: resolvedSchedule.scheduleSetId,
                    schedule_source: resolvedSchedule.source,
                    responsibility_id: responsibility ? responsibility.id : null,
                    submission_deadline_at: deadlineAt
                })
            ], client);

            return {
                created: true,
                registerId: inserted.id,
                status: 'expected',
                expectedStudentCount: rosterRows.length,
                deadlineAt,
                warning: rosterRows.length === 0 ? 'empty_roster_requires_review' : null,
                lowAttendanceThreshold: Number(settings.low_attendance_threshold),
                responsibleStaffId: responsibility ? responsibility.staff_id : null
            };
        });
    }

    async function generateExpectedRegistersForDate(input) {
        const schoolId = Number(input && input.schoolId);
        const registerDate = normalizeDate(input && input.registerDate);
        if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
            throw new Error('A valid school is required to generate attendance registers.');
        }
        const classes = await db.all(`
            SELECT id
            FROM classes
            WHERE school_id = ? AND section_id IS NOT NULL
            ORDER BY section_id, id
        `, [schoolId]);
        const results = [];
        for (const row of classes) {
            results.push({
                classId: row.id,
                ...(await generateExpectedRegister({
                    schoolId, classId: row.id, registerDate,
                    generatedBy: input && input.generatedBy
                }))
            });
        }
        return {
            schoolId, registerDate,
            totalClasses: classes.length,
            created: results.filter(row => row.created).length,
            alreadyExists: results.filter(row => row.alreadyExists).length,
            skipped: results.filter(row => row.skipped).length,
            results
        };
    }

    return { generateExpectedRegister, generateExpectedRegistersForDate };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) defaultService = createAttendanceRegisterService(require('../utils/db'));
    return defaultService;
}

module.exports = {
    generateExpectedRegister: (...args) => getDefaultService().generateExpectedRegister(...args),
    generateExpectedRegistersForDate: (...args) => getDefaultService().generateExpectedRegistersForDate(...args),
    createAttendanceRegisterService,
    normalizeDate,
    isoWeekday,
    localDateTimeToUtc
};
