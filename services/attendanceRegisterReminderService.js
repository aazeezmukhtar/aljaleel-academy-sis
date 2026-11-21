'use strict';

const { createSharedNotificationDeliveryService } = require('./sharedNotificationDeliveryService');

function asIso(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('A valid UTC timestamp is required.');
    return date.toISOString();
}

function asDateKey(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
}

function parseIntervals(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch (_) {
            throw new Error('Subsequent attendance reminder intervals must be a valid JSON array.');
        }
    }
    if (!Array.isArray(parsed) || parsed.some(minutes =>
        !Number.isSafeInteger(Number(minutes)) || Number(minutes) <= 0
    )) {
        throw new Error('Subsequent attendance reminder intervals must contain positive whole minutes.');
    }
    return parsed.map(Number);
}

function addMinutes(value, minutes) {
    return new Date(new Date(value).getTime() + minutes * 60 * 1000).toISOString();
}

function createAttendanceRegisterReminderService(db) {
    if (!db) throw new Error('An attendance reminder database adapter is required.');
    const { createAttendanceRegisterService } =
        require('./attendanceRegisterGenerationService');
    const registerGenerator = createAttendanceRegisterService(db);
    const scheduleCompatibility = require('./attendanceScheduleCompatibilityService').createAttendanceScheduleCompatibilityService(db);
    const notificationDelivery = createSharedNotificationDeliveryService(db);

    async function isDeliveryQueueAvailable() {
        try {
            await db.get('SELECT id FROM notification_deliveries LIMIT 0');
            return true;
        } catch (_) {
            return false;
        }
    }

    async function cancelQueuedDeliveryForReminder(reminderId, now, client, queueAvailable) {
        if (!queueAvailable) return 0;
        const result = await db.run(`
            UPDATE notification_deliveries
            SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE source_type = 'attendance_register_reminder' AND source_id = ?
              AND status = 'queued'
        `, [now, now, reminderId], client);
        return Number(result.changes || 0);
    }

    function localDateKey(timestamp) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(timestamp)).reduce((result, part) => {
            if (part.type !== 'literal') result[part.type] = part.value;
            return result;
        }, {});
        return parts.year + '-' + parts.month + '-' + parts.day;
    }

    function shiftDate(date, offset) {
        const value = new Date(date + 'T00:00:00Z');
        value.setUTCDate(value.getUTCDate() + offset);
        return value.toISOString().slice(0, 10);
    }

    async function reconcileMissingRegisters(now, limit) {
        const today = localDateKey(now);
        let generatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let remaining = limit;
        for (let offset = 6; offset >= 0 && remaining > 0; offset -= 1) {
            const date = shiftDate(today, -offset);
            const candidates = await db.all(`
                SELECT DISTINCT c.school_id, c.id AS class_id, c.section_id
                FROM classes c
                JOIN sections sec ON sec.id = c.section_id AND sec.school_id = c.school_id
                JOIN section_academic_periods ap
                  ON ap.school_id = c.school_id AND ap.section_id = c.section_id
                 AND ap.start_date <= ? AND ap.end_date >= ?
                 AND ap.status IN ('active', 'completed')
                JOIN class_attendance_settings cfg
                  ON cfg.school_id = c.school_id AND cfg.class_id = c.id
                 AND cfg.section_id = c.section_id AND cfg.effective_from <= ?
                 AND (cfg.effective_to IS NULL OR cfg.effective_to >= ?)
                WHERE NOT EXISTS (
                    SELECT 1 FROM attendance_registers ar
                    WHERE ar.school_id = c.school_id AND ar.class_id = c.id
                      AND ar.section_id = c.section_id AND ar.register_date = ?
                )
                  AND NOT EXISTS (
                    SELECT 1 FROM class_attendance_closures cl
                    WHERE cl.school_id = c.school_id AND cl.status = 'approved'
                      AND cl.start_date <= ? AND cl.end_date >= ?
                      AND (
                        cl.scope_type = 'school'
                        OR (cl.scope_type = 'section' AND cl.section_id = c.section_id)
                        OR (cl.scope_type = 'class' AND cl.section_id = c.section_id AND cl.class_id = c.id)
                      )
                  )
                ORDER BY c.school_id, c.id
            `, [date, date, date, date, date, date, date]);
            for (const candidate of candidates) {
                let expectedDay;
                try {
                    expectedDay = await scheduleCompatibility.isExpectedSchoolDay({
                        schoolId: candidate.school_id, classId: candidate.class_id,
                        sectionId: candidate.section_id, date
                    });
                } catch (error) {
                    errorCount += 1;
                    console.error('[attendance-reminder-scheduler] Schedule resolution failed:', {
                        schoolId: candidate.school_id, classId: candidate.class_id, date,
                        message: error.message
                    });
                    remaining -= 1;
                    continue;
                }
                if (!expectedDay.configured || !expectedDay.expected) continue;
                if (remaining <= 0) break;
                try {
                    const result = await registerGenerator.generateExpectedRegister({
                        schoolId: candidate.school_id,
                        classId: candidate.class_id,
                        registerDate: date
                    });
                    if (result.created) generatedCount += 1;
                    else skippedCount += 1;
                } catch (error) {
                    errorCount += 1;
                    console.error('[attendance-reminder-scheduler] Missing register generation failed:', {
                        schoolId: candidate.school_id, classId: candidate.class_id, date,
                        message: error.message
                    });
                }
                remaining -= 1;
            }
        }
        return { generatedCount, skippedCount, errorCount };
    }

    async function cancelObsoleteReminders(client, now, queueAvailable) {
        const pending = await db.all(`
            SELECT DISTINCT r.id AS reminder_id, r.register_id
            FROM attendance_register_reminders r
            JOIN attendance_registers ar ON ar.id = r.register_id
            WHERE r.status = 'pending'
              AND (
                ar.status IN ('submitted', 'closed')
                OR EXISTS (
                    SELECT 1 FROM class_attendance_closures cl
                    WHERE cl.school_id = ar.school_id AND cl.status = 'approved'
                      AND cl.start_date <= ar.register_date AND cl.end_date >= ar.register_date
                      AND (
                        cl.scope_type = 'school'
                        OR (cl.scope_type = 'section' AND cl.section_id = ar.section_id)
                        OR (cl.scope_type = 'class' AND cl.section_id = ar.section_id AND cl.class_id = ar.class_id)
                      )
                )
              )
        `, [], client);
        let cancelledCount = 0;
        for (const row of pending) {
            const result = await db.run(
                "UPDATE attendance_register_reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
                [row.reminder_id], client
            );
            cancelledCount += Number(result.changes || 0);
            if (Number(result.changes || 0) > 0) {
                await cancelQueuedDeliveryForReminder(row.reminder_id, now, client, queueAvailable);
            }
        }
        return cancelledCount;
    }

    async function scheduleDueReminders(input = {}) {
        const now = asIso(input.now || new Date());
        const limit = input.limit === undefined ? 100 : Number(input.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
            throw new Error('Reminder scheduling limit must be between 1 and 500.');
        }

        const deliveryTableAvailable = await isDeliveryQueueAvailable();
        const queueAvailable = deliveryTableAvailable &&
            process.env.ATTENDANCE_REMINDER_SCHEDULER_DELIVERY === 'true';
        const reconciliation = await reconcileMissingRegisters(now, limit);
        const candidates = await db.all(`
            SELECT ar.id
            FROM attendance_registers ar
            WHERE ar.status IN ('expected', 'in_progress', 'reopened')
              AND ar.submission_deadline_at <= ?
              AND EXISTS (
                SELECT 1 FROM class_attendance_settings cfg
                WHERE cfg.school_id = ar.school_id
                  AND cfg.class_id = ar.class_id AND cfg.section_id = ar.section_id
                  AND cfg.effective_from <= ar.register_date
                  AND (cfg.effective_to IS NULL OR cfg.effective_to >= ar.register_date)
              )
              AND NOT EXISTS (
                SELECT 1 FROM class_attendance_closures cl
                WHERE cl.school_id = ar.school_id AND cl.status = 'approved'
                  AND cl.start_date <= ar.register_date AND cl.end_date >= ar.register_date
                  AND (
                    cl.scope_type = 'school'
                    OR (cl.scope_type = 'section' AND cl.section_id = ar.section_id)
                    OR (cl.scope_type = 'class' AND cl.section_id = ar.section_id AND cl.class_id = ar.class_id)
                  )
              )
            ORDER BY ar.submission_deadline_at, ar.id
            LIMIT ?
        `, [now, limit]);

        let scheduledCount = 0;
        let processedCount = 0;
        let cancelledCount = 0;

        for (const candidate of candidates) {
            const result = await db.transaction(async client => {
                const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE' : '';
                const register = await db.get(`
                    SELECT id, school_id, class_id, section_id, register_date,
                           submission_deadline_at, responsibility_id, status
                    FROM attendance_registers
                    WHERE id = ? ${lock}
                `, [candidate.id], client);
                if (!register || !['expected', 'in_progress', 'reopened'].includes(register.status)) {
                    return { scheduled: 0, processed: false, cancelled: 0 };
                }

                const registerDate = asDateKey(register.register_date);
                const closure = await db.get(`
                    SELECT id FROM class_attendance_closures
                    WHERE school_id = ? AND status = 'approved'
                      AND start_date <= ? AND end_date >= ?
                      AND (
                        scope_type = 'school'
                        OR (scope_type = 'section' AND section_id = ?)
                        OR (scope_type = 'class' AND section_id = ? AND class_id = ?)
                      )
                    LIMIT 1
                `, [register.school_id, registerDate, registerDate,
                    register.section_id, register.section_id, register.class_id], client);
                if (closure) {
                    const obsolete = await db.all(
                        "SELECT id FROM attendance_register_reminders WHERE register_id = ? AND status = 'pending'",
                        [register.id], client
                    );
                    let cancelledCount = 0;
                    for (const reminder of obsolete) {
                        const cancelled = await db.run(
                            "UPDATE attendance_register_reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
                            [reminder.id], client
                        );
                        cancelledCount += Number(cancelled.changes || 0);
                        if (Number(cancelled.changes || 0) > 0) {
                            await cancelQueuedDeliveryForReminder(reminder.id, now, client, queueAvailable);
                        }
                    }
                    return { scheduled: 0, processed: false, cancelled: cancelledCount };
                }

                const settings = await db.get(`
                    SELECT first_reminder_delay_minutes, subsequent_reminder_intervals_minutes
                    FROM class_attendance_settings
                    WHERE school_id = ? AND class_id = ? AND section_id = ?
                      AND effective_from <= ?
                      AND (effective_to IS NULL OR effective_to >= ?)
                    ORDER BY effective_from DESC, id DESC
                `, [register.school_id, register.class_id, register.section_id,
                    registerDate, registerDate], client);
                if (!settings) return { scheduled: 0, processed: false, cancelled: 0 };

                const intervals = parseIntervals(settings.subsequent_reminder_intervals_minutes);
                const firstDelay = Number(settings.first_reminder_delay_minutes);
                if (!Number.isSafeInteger(firstDelay) || firstDelay < 0) {
                    throw new Error('The first attendance reminder delay must be a non-negative whole number of minutes.');
                }

                const responsibility = register.responsibility_id
                    ? await db.get(`
                        SELECT r.staff_id, st.school_id AS staff_school_id
                        FROM class_attendance_responsibilities r
                        JOIN staff st ON st.id = r.staff_id
                        WHERE r.id = ? AND r.school_id = ?
                    `, [register.responsibility_id, register.school_id], client)
                    : null;
                if (responsibility && Number(responsibility.staff_school_id) !== Number(register.school_id)) {
                    throw new Error('The responsible attendance teacher does not belong to the register school.');
                }
                const administrators = await db.all(
                    "SELECT id FROM staff WHERE school_id = ? AND role = 'Admin' ORDER BY id",
                    [register.school_id], client
                );

                const existing = await db.all(`
                    SELECT reminder_stage, scheduled_at
                    FROM attendance_register_reminders
                    WHERE register_id = ?
                    ORDER BY reminder_stage DESC, id DESC
                `, [register.id], client);
                let latestStage = existing.length ? Number(existing[0].reminder_stage) : 0;
                let previousStageAt = existing.length ? asIso(existing[0].scheduled_at) : null;
                const deadlineAt = asIso(register.submission_deadline_at);
                const firstScheduledAt = addMinutes(deadlineAt, firstDelay);
                let count = 0;

                while (latestStage === 0 || latestStage <= intervals.length) {
                    const stage = latestStage + 1;
                    const scheduledAt = stage === 1
                        ? firstScheduledAt
                        : addMinutes(previousStageAt, intervals[stage - 2]);
                    const stageIsDue = new Date(scheduledAt).getTime() <= new Date(now).getTime();

                    let recipients;
                    let reminderType;
                    if (stage === 1 && responsibility) {
                        recipients = [{ id: responsibility.staff_id }];
                        reminderType = 'responsible_teacher';
                    } else {
                        recipients = administrators.filter(admin =>
                            !(stage > 1 && responsibility && String(admin.id) === String(responsibility.staff_id))
                        );
                        reminderType = 'administrator_escalation';
                    }
                    if (!recipients.length) break;

                    for (const recipient of recipients) {
                        await db.run(`
                            INSERT INTO attendance_register_reminders
                                (register_id, recipient_staff_id, reminder_stage, reminder_type, scheduled_at, status)
                            VALUES (?, ?, ?, ?, ?, 'pending')
                            ON CONFLICT (register_id, recipient_staff_id, reminder_stage) DO NOTHING
                        `, [register.id, recipient.id, stage, reminderType, scheduledAt], client);
                    }
                    count += recipients.length;
                    latestStage = stage;
                    previousStageAt = scheduledAt;
                    // Persist the next reminder stage even when it is scheduled for the
                    // future so the shared queue can hold it and cancel it if the register
                    // is submitted or closed before its due time.
                    if (!stageIsDue) break;
                }

                return { scheduled: count, processed: true, cancelled: 0 };
            });
            scheduledCount += result.scheduled;
            cancelledCount += result.cancelled;
            if (result.processed) processedCount += 1;
        }

        // Also cancel queued reminders when a register was submitted or closed
        // after it stopped qualifying as a scheduling candidate.
        const staleCancelled = await db.transaction(client =>
            cancelObsoleteReminders(client, now, deliveryTableAvailable)
        );

        let queuedDeliveryCount = 0;
        let dispatchedDeliveryCount = 0;
        let legacySchedulerDeliveryCount = 0;
        if (!queueAvailable) {
            // Until the additive queue migration is installed, keep delivery scheduler-owned
            // using the existing reminder status transition (never from a feed request).
            const legacyRecipients = await db.all(`
                SELECT DISTINCT recipient_staff_id
                FROM attendance_register_reminders
                WHERE status = 'pending' AND scheduled_at <= ?
                ORDER BY recipient_staff_id
                LIMIT ?
            `, [now, limit]);
            for (const recipient of legacyRecipients) {
                const delivered = await deliverDueRemindersForStaff({
                    staffId: recipient.recipient_staff_id,
                    now,
                    queueAvailable: deliveryTableAvailable
                });
                legacySchedulerDeliveryCount += delivered.length;
            }
        }
        if (queueAvailable) {
            const dueReminders = await db.all(`
                SELECT r.id, r.recipient_staff_id, r.scheduled_at,
                       ar.school_id, ar.class_id, ar.register_date
                FROM attendance_register_reminders r
                JOIN attendance_registers ar ON ar.id = r.register_id
                WHERE r.status = 'pending'
                  AND ar.status IN ('expected', 'in_progress', 'reopened')
                  AND NOT EXISTS (
                    SELECT 1 FROM class_attendance_closures cl
                    WHERE cl.school_id = ar.school_id AND cl.status = 'approved'
                      AND cl.start_date <= ar.register_date AND cl.end_date >= ar.register_date
                      AND (
                        cl.scope_type = 'school'
                        OR (cl.scope_type = 'section' AND cl.section_id = ar.section_id)
                        OR (cl.scope_type = 'class' AND cl.section_id = ar.section_id AND cl.class_id = ar.class_id)
                      )
                  )
                ORDER BY r.scheduled_at, r.id
                LIMIT ?
            `, [limit]);

            for (const reminder of dueReminders) {
                const registerDate = asDateKey(reminder.register_date);
                const queued = await notificationDelivery.enqueue({
                    schoolId: reminder.school_id,
                    recipientType: 'staff',
                    recipientId: reminder.recipient_staff_id,
                    category: 'attendance',
                    sourceType: 'attendance_register_reminder',
                    sourceId: reminder.id,
                    idempotencyKey: 'attendance-reminder:' + reminder.id + ':staff:' + reminder.recipient_staff_id,
                    title: 'Attendance register overdue',
                    body: 'An attendance register is overdue. Please complete the register.',
                    destination: '/attendance/take?class_id=' + encodeURIComponent(reminder.class_id) +
                        '&date=' + encodeURIComponent(registerDate),
                    scheduledAt: reminder.scheduled_at
                });
                if (queued.created) queuedDeliveryCount += 1;
            }

            const dispatched = await notificationDelivery.dispatchDue({ now, limit });
            dispatchedDeliveryCount = dispatched.deliveredCount;

            const publishedReminders = await db.all(`
                SELECT d.source_id, d.status, d.delivered_at
                FROM notification_deliveries d
                JOIN attendance_register_reminders r ON r.id = d.source_id
                WHERE d.source_type = 'attendance_register_reminder'
                  AND d.status IN ('delivered', 'read')
                  AND r.status = 'pending'
                ORDER BY d.id
                LIMIT ?
            `, [limit]);
            for (const reminder of publishedReminders) {
                await db.run(`
                    UPDATE attendance_register_reminders
                    SET status = 'sent', sent_at = COALESCE(sent_at, ?),
                        attempt_count = CASE WHEN attempt_count < 1 THEN 1 ELSE attempt_count END,
                        last_error = NULL
                    WHERE id = ? AND status = 'pending'
                `, [reminder.delivered_at || now, reminder.source_id]);
            }
        }

        return {
            processedCount,
            scheduledCount,
            cancelledCount: cancelledCount + staleCancelled,
            generatedRegisterCount: reconciliation.generatedCount,
            skippedRegisterCount: reconciliation.skippedCount,
            registerGenerationErrorCount: reconciliation.errorCount,
            deliveryMode: queueAvailable ? 'shared_queue' : 'legacy_scheduler',
            queuedDeliveryCount,
            dispatchedDeliveryCount,
            legacySchedulerDeliveryCount,
            checkedAt: now
        };
    }

    async function deliverDueRemindersForStaff(input) {
        const staffId = Number(input && input.staffId);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) {
            throw new Error('A valid staff member is required to deliver attendance reminders.');
        }
        const now = asIso(input.now || new Date());
        const queueAvailable = typeof input.queueAvailable === 'boolean'
            ? input.queueAvailable
            : await isDeliveryQueueAvailable();
        return db.transaction(async client => {
            await cancelObsoleteReminders(client, now, queueAvailable);
            const reminders = await db.all(`
                SELECT r.id, r.register_id
                FROM attendance_register_reminders r
                JOIN attendance_registers ar ON ar.id = r.register_id
                WHERE r.recipient_staff_id = ? AND r.status = 'pending'
                  AND r.scheduled_at <= ?
                  AND ar.status IN ('expected', 'in_progress', 'reopened')
                  AND NOT EXISTS (
                    SELECT 1 FROM class_attendance_closures cl
                    WHERE cl.school_id = ar.school_id AND cl.status = 'approved'
                      AND cl.start_date <= ar.register_date AND cl.end_date >= ar.register_date
                      AND (
                        cl.scope_type = 'school'
                        OR (cl.scope_type = 'section' AND cl.section_id = ar.section_id)
                        OR (cl.scope_type = 'class' AND cl.section_id = ar.section_id AND cl.class_id = ar.class_id)
                      )
                  )
                ORDER BY r.scheduled_at, r.id
                LIMIT 50
            `, [staffId, now], client);
            const delivered = [];
            for (const reminder of reminders) {
                const updated = await db.run(`
                    UPDATE attendance_register_reminders
                    SET status = 'sent', sent_at = ?,
                        attempt_count = attempt_count + 1, last_error = NULL
                    WHERE id = ? AND recipient_staff_id = ? AND status = 'pending'
                `, [now, reminder.id, staffId], client);
                if (Number(updated.changes || 0) > 0) {
                    delivered.push(reminder.id);
                    // If rollout has been switched back to legacy delivery, retire any
                    // previously queued copy so it cannot be dispatched later as a duplicate.
                    await cancelQueuedDeliveryForReminder(reminder.id, now, client, queueAvailable);
                }
            }
            return delivered;
        });
    }

    async function acknowledgeReminder(input, client) {
        const staffId = Number(input && input.staffId);
        const reminderId = Number(input && input.reminderId);
        if (![staffId, reminderId].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new Error('A valid staff member and reminder are required.');
        }
        const result = await db.run(`
            UPDATE attendance_register_reminders
            SET status = 'acknowledged',
                acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
            WHERE id = ? AND recipient_staff_id = ?
              AND status IN ('sent', 'acknowledged')
        `, [reminderId, staffId], client);
        return Number(result.changes || 0) > 0;
    }

    const { createAttendanceSchedulerRunRecorder } = require('./attendanceSchedulerRunHistoryService');
    const runScheduler = createAttendanceSchedulerRunRecorder(db, scheduleDueReminders);

    return { scheduleDueReminders, runScheduler, deliverDueRemindersForStaff, acknowledgeReminder };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) defaultService = createAttendanceRegisterReminderService(require('../utils/db'));
    return defaultService;
}

module.exports = {
    createAttendanceRegisterReminderService,
    scheduleDueReminders: (...args) => getDefaultService().scheduleDueReminders(...args),
    runScheduler: (...args) => getDefaultService().runScheduler(...args),
    deliverDueRemindersForStaff: (...args) => getDefaultService().deliverDueRemindersForStaff(...args),
    acknowledgeReminder: (...args) => getDefaultService().acknowledgeReminder(...args)
};
