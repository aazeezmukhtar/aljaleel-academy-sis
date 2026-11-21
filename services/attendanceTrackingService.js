'use strict';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
    const date = String(value || '').trim();
    if (!DATE_PATTERN.test(date)) throw new Error('Choose a valid attendance date.');
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Choose a valid attendance date.');
    }
    return date;
}

function safeId(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Choose a valid ' + label + '.');
    return number;
}

function createAttendanceTrackingService({ db, sessionHelper, notificationDelivery }) {
    if (!db || !sessionHelper || !notificationDelivery) {
        throw new Error('Attendance tracking requires database, session and notification services.');
    }

    async function resolveSectionContext(section, schoolId) {
        const fallbackSession = section.current_session || await sessionHelper.getCurrentSession(schoolId);
        const fallbackTerm = section.current_term || await sessionHelper.getCurrentTerm(schoolId);
        return { session: fallbackSession || null, term: fallbackTerm || null };
    }

    async function getSections(schoolId) {
        const sections = await db.all(
            'SELECT id, name, current_session, current_term FROM sections WHERE school_id = ? ORDER BY name',
            [schoolId]
        );
        for (const section of sections) {
            section.academicContext = await resolveSectionContext(section, schoolId);
        }
        return sections;
    }

    async function getSessionOptions(schoolId) {
        const options = new Set(await sessionHelper.getAvailableSessions(schoolId));
        const historical = await db.all(`
            SELECT DISTINCT a.session
            FROM attendance a
            JOIN classes c ON c.id = a.class_id
            WHERE c.school_id = ? AND a.session IS NOT NULL AND trim(a.session) <> ''
            ORDER BY a.session DESC
        `, [schoolId]);
        historical.forEach(row => options.add(row.session));
        return Array.from(options).sort((a, b) => {
            const yearA = Number.parseInt(String(a).split('/')[0], 10) || 0;
            const yearB = Number.parseInt(String(b).split('/')[0], 10) || 0;
            return yearB - yearA || String(b).localeCompare(String(a));
        });
    }

    async function getTrackingPage(input) {
        const schoolId = safeId(input && input.schoolId, 'school');
        const date = normalizeDate(input && input.date);
        const sections = await getSections(schoolId);
        const sessionOptions = await getSessionOptions(schoolId);
        const sectionId = input && input.sectionId
            ? safeId(input.sectionId, 'section')
            : (sections[0] ? Number(sections[0].id) : null);
        const section = sections.find(item => Number(item.id) === sectionId);
        if (sectionId && !section) throw new Error('The selected section does not belong to this school.');

        if (!section) {
            return { date, sections, selectedSection: null, session: null, term: null, sessionOptions, terms: sessionHelper.getAvailableTerms(), classes: [], notificationAvailable: await notificationDelivery.isAvailable() };
        }

        const requestedSession = String(input && input.session || section.academicContext.session || '').trim();
        const requestedTerm = String(input && input.term || section.academicContext.term || '').trim();
        if (requestedSession.length > 40 || requestedTerm.length > 40) throw new Error('Invalid academic context.');
        const session = requestedSession || null;
        const term = requestedTerm || null;
        const notificationAvailable = await notificationDelivery.isAvailable();

        const classes = await db.all(`
            SELECT c.id, c.name, c.form_teacher_id, c.section_id
            FROM classes c
            WHERE c.school_id = ? AND c.section_id = ?
            ORDER BY c.name
        `, [schoolId, sectionId]);

        const attendanceCounts = session && term ? await db.all(`
            SELECT a.class_id, COUNT(a.id) AS record_count,
                   COUNT(DISTINCT a.student_id) AS student_count
            FROM attendance a
            JOIN classes c ON c.id = a.class_id
            WHERE c.school_id = ? AND c.section_id = ?
              AND a.date = ? AND a.session = ? AND a.term = ?
            GROUP BY a.class_id
        `, [schoolId, sectionId, date, session, term]) : [];
        const countsByClass = new Map(attendanceCounts.map(row => [String(row.class_id), row]));

        for (const clazz of classes) {
            const count = countsByClass.get(String(clazz.id));
            clazz.recordCount = Number(count ? count.record_count : 0);
            clazz.studentCount = Number(count ? count.student_count : 0);
            clazz.recorded = clazz.recordCount > 0;
            clazz.recipients = session ? await getPingRecipients(schoolId, clazz, session) : [];
            clazz.pingHistory = notificationAvailable && session && term
                ? await getPingHistory({ schoolId, classId: clazz.id, date, session, term })
                : [];
        }

        return {
            date, sections, selectedSection: section, sectionId, session, term,
            sessionOptions, terms: sessionHelper.getAvailableTerms(), classes,
            notificationAvailable,
            isCurrentContext: Boolean(session && term &&
                session === section.academicContext.session && term === section.academicContext.term)
        };
    }

    async function getPingRecipients(schoolId, clazz, session) {
        return db.all(`
            SELECT DISTINCT st.id, st.first_name, st.last_name
            FROM staff st
            WHERE st.school_id = ? AND st.status = 'active'
              AND (
                st.id = ?
                OR EXISTS (
                    SELECT 1 FROM class_assignments ca
                    WHERE ca.class_id = ? AND ca.staff_id = st.id AND ca.session = ?
                )
              )
            ORDER BY st.last_name, st.first_name
        `, [schoolId, clazz.form_teacher_id || 0, clazz.id, session]);
    }

    function pingKeyPrefix(classId, date, session, term) {
        return 'attendance-class-ping:' + classId + ':' + date + ':' +
            encodeURIComponent(session) + ':' + encodeURIComponent(term) + ':';
    }

    async function getPingHistory({ schoolId, classId, date, session, term }) {
        const prefix = pingKeyPrefix(classId, date, session, term);
        return db.all(`
            SELECT d.id, d.recipient_id, d.status, d.created_at, d.delivered_at,
                   st.first_name, st.last_name
            FROM notification_deliveries d
            JOIN staff st ON st.id = d.recipient_id AND st.school_id = d.school_id
            WHERE d.school_id = ? AND d.source_type = 'attendance_class_ping'
              AND d.source_id = ? AND d.idempotency_key LIKE ?
            ORDER BY d.id
        `, [schoolId, classId, prefix + '%']);
    }

    async function sendManualPing(input) {
        const schoolId = safeId(input && input.schoolId, 'school');
        const actorStaffId = safeId(input && input.actorStaffId, 'administrator');
        const classId = safeId(input && input.classId, 'class');
        const sectionId = safeId(input && input.sectionId, 'section');
        const date = normalizeDate(input && input.date);
        const session = String(input && input.session || '').trim();
        const term = String(input && input.term || '').trim();
        if (!session || session.length > 40 || !term || term.length > 40) {
            throw new Error('A valid session and term are required.');
        }

        const section = await db.get(
            'SELECT id, current_session, current_term FROM sections WHERE id = ? AND school_id = ?',
            [sectionId, schoolId]
        );
        if (!section) throw new Error('The selected section does not belong to this school.');
        const current = await resolveSectionContext(section, schoolId);
        if (session !== current.session || term !== current.term) {
            throw new Error('Pings are available only for the section\'s currently configured session and term.');
        }

        const clazz = await db.get(
            'SELECT id, name, section_id, form_teacher_id FROM classes WHERE id = ? AND section_id = ? AND school_id = ?',
            [classId, sectionId, schoolId]
        );
        if (!clazz) throw new Error('The selected class does not belong to this section.');

        const existingAttendance = await db.get(`
            SELECT COUNT(*) AS record_count
            FROM attendance a
            WHERE a.class_id = ? AND a.date = ? AND a.session = ? AND a.term = ?
        `, [classId, date, session, term]);
        if (Number(existingAttendance && existingAttendance.record_count || 0) > 0) {
            throw new Error('Attendance is already recorded for this class, date and academic context.');
        }

        if (!(await notificationDelivery.isAvailable())) {
            const error = new Error('In-app notifications are not available yet. No ping was sent.');
            error.code = 'notification_unavailable';
            throw error;
        }

        const recipients = await getPingRecipients(schoolId, clazz, session);
        if (!recipients.length) throw new Error('No active administrative class teacher is assigned to receive this ping.');

        const prefix = pingKeyPrefix(classId, date, session, term);
        let createdCount = 0;
        for (const recipient of recipients) {
            const queued = await notificationDelivery.enqueue({
                schoolId,
                recipientType: 'staff',
                recipientId: recipient.id,
                category: 'attendance',
                sourceType: 'attendance_class_ping',
                sourceId: classId,
                idempotencyKey: prefix + recipient.id,
                title: 'Attendance not yet recorded',
                body: 'Please record attendance for ' + clazz.name + ' on ' + date +
                    ' (' + term + ', ' + session + ') if the class opened.',
                destination: '/attendance/take?class_id=' + classId + '&date=' + encodeURIComponent(date)
            });
            if (queued.created) createdCount += 1;
        }

        const dispatched = await notificationDelivery.dispatchDue({ limit: 100 });
        const history = await getPingHistory({ schoolId, classId, date, session, term });
        return {
            className: clazz.name,
            recipientCount: recipients.length,
            createdCount,
            deliveredCount: dispatched.deliveredCount,
            history
        };
    }

    return { getTrackingPage, sendManualPing, getPingRecipients, getPingHistory, normalizeDate };
}

module.exports = { createAttendanceTrackingService, normalizeDate };
