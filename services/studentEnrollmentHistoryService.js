'use strict';

const db = require('../utils/db');

const EVENT_TYPES = new Set([
    'admission', 'internal_transfer', 'promotion', 'repetition',
    'correction', 'section_exit', 'external_transfer', 'graduation'
]);

const REQUIRED_CLASS_SHAPES = {
    admission: 'destination',
    internal_transfer: 'both',
    promotion: 'both',
    repetition: 'both',
    correction: 'both',
    section_exit: 'source',
    external_transfer: 'source',
    graduation: 'source'
};

const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function validateEffectiveDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Effective date must use YYYY-MM-DD format.');
    }
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error('Effective date is not a valid calendar date.');
    }
    return date;
}

async function applyEnrollmentChange(input, client) {
    const {
        schoolId, studentId, sectionId: requestedSectionId,
        sourceClassId = null, destinationClassId = null,
        sourceSession = null, destinationSession = null,
        eventType, effectiveDate = null, reason = null,
        destinationSchool = null, recordedBy = null, destinationTerm = null
    } = input || {};

    if (!positiveId(schoolId) || !positiveId(studentId)) {
        throw new Error('A valid school and student are required for an enrollment change.');
    }
    if (!EVENT_TYPES.has(eventType)) {
        throw new Error('Unsupported enrollment history event type.');
    }

    const shape = REQUIRED_CLASS_SHAPES[eventType];
    if ((shape === 'source' && (!sourceClassId || destinationClassId)) ||
        (shape === 'destination' && (sourceClassId || !destinationClassId)) ||
        (shape === 'both' && (!sourceClassId || !destinationClassId))) {
        throw new Error('The source and destination classes do not match this event type.');
    }
    if (sourceClassId && !sourceSession) throw new Error('Source session is required.');
    if (destinationClassId && !destinationSession) throw new Error('Destination session is required.');
    if (sourceClassId && destinationClassId &&
        String(sourceSession) === String(destinationSession) &&
        Number(sourceClassId) === Number(destinationClassId)) {
        return { changed: false, reason: 'Assignment is already unchanged.' };
    }

    const normalizedDate = validateEffectiveDate(effectiveDate);
    if (['internal_transfer', 'external_transfer', 'section_exit'].includes(eventType)) {
        if (!normalizedDate) throw new Error('An effective date is required for this transfer or section exit.');
        if (!reason || !String(reason).trim()) throw new Error('A reason is required for this transfer or section exit.');
    }
    const student = await db.get(
        'SELECT id FROM students WHERE id = ? AND school_id = ?',
        [studentId, schoolId], client
    );
    if (!student) throw new Error('Student was not found in this school.');

    let sourceClass = null;
    let destinationClass = null;
    if (sourceClassId) {
        sourceClass = await db.get(
            'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
            [sourceClassId, schoolId], client
        );
        if (!sourceClass) throw new Error('Source class was not found in this school.');
    }
    if (destinationClassId) {
        destinationClass = await db.get(
            'SELECT id, section_id FROM classes WHERE id = ? AND school_id = ?',
            [destinationClassId, schoolId], client
        );
        if (!destinationClass) throw new Error('Destination class was not found in this school.');
    }

    const resolvedSectionId = sourceClass ? sourceClass.section_id : destinationClass.section_id;
    if (sourceClass && destinationClass &&
        Number(sourceClass.section_id) !== Number(destinationClass.section_id)) {
        throw new Error('An enrollment change cannot move a student between sections. Manage each section independently.');
    }
    if (requestedSectionId !== undefined && requestedSectionId !== null &&
        Number(requestedSectionId) !== Number(resolvedSectionId)) {
        throw new Error('The selected section does not match the source and destination classes.');
    }

    if (sourceClass) {
        const sourceEnrollment = await db.get(
            'SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?',
            [studentId, sourceClassId, sourceSession], client
        );
        if (!sourceEnrollment) {
            throw new Error('The expected source enrollment no longer exists. Refresh and review the student placement.');
        }
    }

    if (destinationClass) {
        let conflictSql = `
            SELECT se.id, se.class_id
            FROM student_enrollments se
            JOIN classes c ON c.id = se.class_id AND c.school_id = ?
            WHERE se.student_id = ?
              AND se.session = ?
              AND c.section_id = ?
        `;
        const conflictParams = [schoolId, studentId, destinationSession, resolvedSectionId];
        if (sourceClass && String(sourceSession) === String(destinationSession)) {
            conflictSql += ' AND se.class_id <> ?';
            conflictParams.push(sourceClassId);
        }
        conflictSql += ' LIMIT 1';
        const conflictingTarget = await db.get(conflictSql, conflictParams, client);
        if (conflictingTarget && Number(conflictingTarget.class_id) !== Number(destinationClassId)) {
            throw new Error('The student already has a different placement in the destination section and session. Resolve it before continuing.');
        }
    }

    // Same-session moves replace the current row. Cross-session moves preserve
    // the source row as historical placement and add the destination row.
    // Departures remove the source placement without deleting academic records.
    if (sourceClass && (!destinationClass || String(sourceSession) === String(destinationSession))) {
        await db.run(
            'DELETE FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?',
            [studentId, sourceClassId, sourceSession], client
        );
    }

    if (destinationClass) {
        const existingDestination = await db.get(
            'SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND session = ?',
            [studentId, destinationClassId, destinationSession], client
        );
        if (!existingDestination) {
            await db.run(
                'INSERT INTO student_enrollments (student_id, class_id, session, term) VALUES (?, ?, ?, ?)',
                [studentId, destinationClassId, destinationSession, destinationTerm], client
            );
        }
    }

    await db.run(`
        INSERT INTO student_enrollment_history (
            school_id, student_id, section_id,
            source_class_id, destination_class_id,
            source_session, destination_session,
            event_type, effective_date, reason,
            destination_school, recorded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        schoolId, studentId, resolvedSectionId,
        sourceClassId || null, destinationClassId || null,
        sourceSession || null, destinationSession || null,
        eventType, normalizedDate, reason ? String(reason).trim() : null,
        destinationSchool ? String(destinationSchool).trim() : null,
        positiveId(recordedBy) ? Number(recordedBy) : null
    ], client);

    return {
        changed: true, sectionId: resolvedSectionId,
        sourceClassId: sourceClassId || null,
        destinationClassId: destinationClassId || null,
        eventType
    };
}

/**
 * Apply one assignment change atomically. Callers already inside a transaction
 * must pass { inTransaction: true, client }; SQLite uses a null client while
 * PostgreSQL uses the transaction-scoped PoolClient.
 */
async function changeEnrollment(input, options = {}) {
    if (options.inTransaction) {
        return applyEnrollmentChange(input, options.client || null);
    }
    return db.transaction(async client => applyEnrollmentChange(input, client || null));
}

module.exports = {
    changeEnrollment,
    EVENT_TYPES: Array.from(EVENT_TYPES)
};
