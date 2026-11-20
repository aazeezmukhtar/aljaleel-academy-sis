'use strict';

function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(label + ' must be a positive whole number.');
    }
    return number;
}

function requiredText(value, label, maxLength = 200) {
    const text = String(value == null ? '' : value).trim();
    if (!text || text.length > maxLength) {
        throw new Error(label + ' is required and must not exceed ' + maxLength + ' characters.');
    }
    return text;
}

function isoTimestamp(value, label) {
    const date = value == null ? new Date() : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(label + ' must be a valid timestamp.');
    return date.toISOString();
}

function createNotificationDeliveryService(db) {
    if (!db || typeof db.all !== 'function' || typeof db.get !== 'function' ||
        typeof db.run !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('A notification delivery database adapter is required.');
    }

    async function enqueue(input = {}) {
        const schoolId = positiveInteger(input.schoolId, 'School ID');
        const recipientType = requiredText(input.recipientType, 'Recipient type', 20).toLowerCase();
        if (!['staff', 'student'].includes(recipientType)) {
            throw new Error('Recipient type must be staff or student.');
        }
        const recipientId = positiveInteger(input.recipientId, 'Recipient ID');
        const sourceType = requiredText(input.sourceType, 'Source type', 80);
        const sourceId = positiveInteger(input.sourceId, 'Source ID');
        const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency key', 160);
        const category = requiredText(input.category, 'Notification category', 80);
        const title = requiredText(input.title, 'Notification title', 240);
        const body = input.body == null ? null : String(input.body).trim();
        const destinationPath = input.destinationPath == null ? null : requiredText(input.destinationPath, 'Destination path', 500);
        const scheduledAt = isoTimestamp(input.scheduledAt, 'Scheduled time');

        return db.transaction(async client => {
            await db.run(`
                INSERT INTO notification_deliveries
                    (school_id, recipient_type, recipient_id, source_type, source_id,
                     idempotency_key, category, title, body, destination_path, scheduled_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (school_id, recipient_type, recipient_id, idempotency_key) DO NOTHING
            `, [schoolId, recipientType, recipientId, sourceType, sourceId,
                idempotencyKey, category, title, body, destinationPath, scheduledAt], client);
            const row = await db.get(`
                SELECT * FROM notification_deliveries
                WHERE school_id = ? AND recipient_type = ? AND recipient_id = ?
                  AND idempotency_key = ?
            `, [schoolId, recipientType, recipientId, idempotencyKey], client);
            if (!row) throw new Error('The notification delivery could not be persisted.');
            return row;
        });
    }

    async function dispatchDue(input = {}) {
        const now = isoTimestamp(input.now, 'Dispatch time');
        const limit = input.limit === undefined ? 100 : Number(input.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
            throw new Error('Notification dispatch limit must be between 1 and 500.');
        }

        return db.transaction(async client => {
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
            const due = await db.all(`
                SELECT id FROM notification_deliveries
                WHERE status = 'queued' AND scheduled_at <= ?
                ORDER BY scheduled_at, id
                LIMIT ? ${lock}
            `, [now, limit], client);
            let deliveredCount = 0;
            for (const item of due) {
                const updated = await db.run(`
                    UPDATE notification_deliveries
                    SET status = 'delivered', delivered_at = ?, updated_at = ?,
                        attempt_count = attempt_count + 1, last_error = NULL
                    WHERE id = ? AND status = 'queued' AND scheduled_at <= ?
                `, [now, now, item.id, now], client);
                deliveredCount += Number(updated.changes || 0);
            }
            return {
                selectedCount: due.length,
                deliveredCount,
                checkedAt: now
            };
        });
    }

    async function listDeliveredForRecipient(input = {}) {
        const schoolId = positiveInteger(input.schoolId, 'School ID');
        const recipientType = requiredText(input.recipientType, 'Recipient type', 20).toLowerCase();
        if (!['staff', 'student'].includes(recipientType)) {
            throw new Error('Recipient type must be staff or student.');
        }
        const recipientId = positiveInteger(input.recipientId, 'Recipient ID');
        const limit = input.limit === undefined ? 50 : Number(input.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Notification feed limit must be between 1 and 100.');
        }
        return db.all(`
            SELECT id, school_id, recipient_type, recipient_id, source_type, source_id,
                   category, title, body, destination_path, scheduled_at, delivered_at,
                   created_at
            FROM notification_deliveries
            WHERE school_id = ? AND recipient_type = ? AND recipient_id = ?
              AND status = 'delivered'
            ORDER BY delivered_at DESC, id DESC
            LIMIT ?
        `, [schoolId, recipientType, recipientId, limit]);
    }

    async function cancelQueued(input = {}) {
        const schoolId = positiveInteger(input.schoolId, 'School ID');
        const sourceType = requiredText(input.sourceType, 'Source type', 80);
        const sourceId = positiveInteger(input.sourceId, 'Source ID');
        const now = isoTimestamp(input.now, 'Cancellation time');
        return db.run(`
            UPDATE notification_deliveries
            SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE school_id = ? AND source_type = ? AND source_id = ? AND status = 'queued'
        `, [now, now, schoolId, sourceType, sourceId]);
    }

    return { enqueue, dispatchDue, listDeliveredForRecipient, cancelQueued };
}

module.exports = { createNotificationDeliveryService };
