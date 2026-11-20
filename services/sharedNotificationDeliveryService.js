'use strict';

function isoTimestamp(value, fallback = new Date()) {
    const date = value === undefined || value === null ? fallback : value;
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new Error('A valid notification timestamp is required.');
    return parsed.toISOString();
}

function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error('A valid ' + label + ' is required.');
    }
    return number;
}

function positiveId(value, label) {
    const normalized = String(value === undefined || value === null ? '' : value).trim();
    if (!/^[1-9]\d*$/.test(normalized)) throw new Error('A valid ' + label + ' is required.');
    return normalized;
}

function requiredText(value, label, maxLength = 200) {
    const normalized = String(value === undefined || value === null ? '' : value).trim();
    if (!normalized || normalized.length > maxLength) {
        throw new Error(label + ' is required and must be no longer than ' + maxLength + ' characters.');
    }
    return normalized;
}

function createSharedNotificationDeliveryService(db) {
    if (!db || typeof db.get !== 'function' || typeof db.all !== 'function' ||
        typeof db.run !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('A shared notification database adapter is required.');
    }

    async function enqueue(input, client = null) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const recipientType = String(input && input.recipientType || '').trim().toLowerCase();
        if (!['staff', 'student'].includes(recipientType)) {
            throw new Error('Notification recipient type must be staff or student.');
        }
        const recipientId = positiveInteger(input && input.recipientId, 'recipient');
        const category = requiredText(input && input.category, 'Notification category', 80);
        const sourceType = requiredText(input && input.sourceType, 'Notification source type', 80);
        const sourceId = positiveId(input && input.sourceId, 'notification source');
        const idempotencyKey = requiredText(input && input.idempotencyKey, 'Notification idempotency key', 200);
        const title = requiredText(input && input.title, 'Notification title', 240);
        const body = input && input.body == null ? null : String(input.body).slice(0, 5000);
        const destination = input && input.destination != null
            ? requiredText(input.destination, 'Notification destination', 500)
            : null;
        if (destination !== null &&
            (!destination.startsWith('/') || destination.startsWith('//') || destination.includes('\\'))) {
            throw new Error('Notification destination must be an internal application path.');
        }
        const scheduledAt = isoTimestamp(input && input.scheduledAt);
        const result = await db.get(`
            INSERT INTO notification_deliveries
                (school_id, recipient_type, recipient_id, category, source_type,
                 source_id, channel, idempotency_key, title, body, destination, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?, 'in_app', ?, ?, ?, ?, ?)
            ON CONFLICT (school_id, idempotency_key) DO NOTHING
            RETURNING id
        `, [schoolId, recipientType, recipientId, category, sourceType,
            sourceId, idempotencyKey, title, body, destination, scheduledAt], client);
        if (result && result.id !== undefined) return { id: result.id, created: true };

        const existing = await db.get(`
            SELECT id, recipient_type, recipient_id, source_type, source_id
            FROM notification_deliveries
            WHERE school_id = ? AND idempotency_key = ?
        `, [schoolId, idempotencyKey], client);
        if (!existing) throw new Error('The notification could not be queued.');
        if (existing.recipient_type !== recipientType ||
            Number(existing.recipient_id) !== recipientId ||
            existing.source_type !== sourceType ||
            String(existing.source_id) !== sourceId) {
            throw new Error('The notification idempotency key is already assigned to a different recipient or source.');
        }
        return { id: existing.id, created: false };
    }

    async function dispatchDue(input = {}) {
        const now = isoTimestamp(input.now);
        const limit = input.limit === undefined ? 100 : Number(input.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
            throw new Error('Notification dispatch limit must be between 1 and 500.');
        }
        return db.transaction(async client => {
            const lock = db.DB_TYPE === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
            const due = await db.all(`
                SELECT id
                FROM notification_deliveries
                WHERE status = 'queued' AND scheduled_at <= ?
                ORDER BY scheduled_at, id
                LIMIT ?${lock}
            `, [now, limit], client);
            const deliveredIds = [];
            for (const row of due) {
                const updated = await db.run(`
                    UPDATE notification_deliveries
                    SET status = 'delivered', delivered_at = ?, updated_at = ?,
                        attempt_count = attempt_count + 1, last_error = NULL
                    WHERE id = ? AND status = 'queued'
                `, [now, now, row.id], client);
                if (Number(updated.changes || 0) > 0) deliveredIds.push(row.id);
            }
            return { deliveredCount: deliveredIds.length, deliveredIds, checkedAt: now };
        });
    }

    async function cancel(input) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const deliveryId = positiveId(input && input.deliveryId, 'notification delivery');
        const now = isoTimestamp(input && input.now);
        const result = await db.run(`
            UPDATE notification_deliveries
            SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE id = ? AND school_id = ? AND status = 'queued'
        `, [now, now, deliveryId, schoolId]);
        return Number(result.changes || 0) > 0;
    }

    async function cancelSource(input) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const sourceType = requiredText(input && input.sourceType, 'Notification source type', 80);
        const sourceId = positiveId(input && input.sourceId, 'notification source');
        const now = isoTimestamp(input && input.now);
        const result = await db.run(`
            UPDATE notification_deliveries
            SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE school_id = ? AND source_type = ? AND source_id = ? AND status = 'queued'
        `, [now, now, schoolId, sourceType, sourceId]);
        return Number(result.changes || 0);
    }

    async function markFailed(input) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const deliveryId = positiveId(input && input.deliveryId, 'notification delivery');
        const errorMessage = requiredText(input && input.errorMessage, 'Notification failure reason', 2000);
        const now = isoTimestamp(input && input.now);
        const result = await db.run(`
            UPDATE notification_deliveries
            SET status = 'failed', last_error = ?, attempt_count = attempt_count + 1,
                updated_at = ?
            WHERE id = ? AND school_id = ? AND status = 'queued'
        `, [errorMessage, now, deliveryId, schoolId]);
        return Number(result.changes || 0) > 0;
    }

    async function listForRecipient(input) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const recipientType = String(input && input.recipientType || '').trim().toLowerCase();
        if (!['staff', 'student'].includes(recipientType)) {
            throw new Error('Notification recipient type must be staff or student.');
        }
        const recipientId = positiveInteger(input && input.recipientId, 'recipient');
        const limit = input && input.limit === undefined ? 50 : Number(input.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Notification retrieval limit must be between 1 and 100.');
        }
        return db.all(`
            SELECT d.id, d.school_id, d.recipient_type, d.recipient_id, d.category,
                   d.source_type, d.source_id, d.title, d.body, d.destination,
                   d.scheduled_at, d.delivered_at, d.status, d.created_at,
                   CASE WHEN r.source_id IS NULL THEN 0 ELSE 1 END AS is_read
            FROM notification_deliveries d
            LEFT JOIN notification_reads r
              ON r.user_id = d.recipient_id
             AND r.user_type = d.recipient_type
             AND r.source_id = d.id
             AND r.source_type = 'notification_delivery'
            WHERE d.school_id = ? AND d.recipient_type = ? AND d.recipient_id = ?
              AND d.status IN ('delivered', 'read')
            ORDER BY d.delivered_at DESC, d.id DESC
            LIMIT ?
        `, [schoolId, recipientType, recipientId, limit]);
    }

    async function markRead(input) {
        const schoolId = positiveInteger(input && input.schoolId, 'school');
        const recipientType = String(input && input.recipientType || '').trim().toLowerCase();
        if (!['staff', 'student'].includes(recipientType)) {
            throw new Error('Notification recipient type must be staff or student.');
        }
        const recipientId = positiveInteger(input && input.recipientId, 'recipient');
        const deliveryId = positiveId(input && input.deliveryId, 'notification delivery');
        return db.transaction(async client => {
            const delivery = await db.get(`
                SELECT id, status FROM notification_deliveries
                WHERE id = ? AND school_id = ? AND recipient_type = ? AND recipient_id = ?
            `, [deliveryId, schoolId, recipientType, recipientId], client);
            if (!delivery || !['delivered', 'read'].includes(delivery.status)) return false;
            await db.run(`
                UPDATE notification_deliveries
                SET status = 'read', updated_at = ?
                WHERE id = ? AND school_id = ? AND recipient_type = ? AND recipient_id = ?
                  AND status IN ('delivered', 'read')
            `, [new Date().toISOString(), deliveryId, schoolId, recipientType, recipientId], client);
            await db.run(`
                INSERT INTO notification_reads (user_id, user_type, source_id, source_type)
                VALUES (?, ?, ?, 'notification_delivery')
                ON CONFLICT (user_id, user_type, source_id, source_type) DO NOTHING
            `, [recipientId, recipientType, deliveryId], client);
            return true;
        });
    }

    return { enqueue, dispatchDue, cancel, cancelSource, markFailed, listForRecipient, markRead };
}

let defaultService = null;
function getDefaultService() {
    if (!defaultService) defaultService = createSharedNotificationDeliveryService(require('../utils/db'));
    return defaultService;
}

module.exports = {
    createSharedNotificationDeliveryService,
    enqueue: (...args) => getDefaultService().enqueue(...args),
    dispatchDue: (...args) => getDefaultService().dispatchDue(...args),
    cancel: (...args) => getDefaultService().cancel(...args),
    cancelSource: (...args) => getDefaultService().cancelSource(...args),
    markFailed: (...args) => getDefaultService().markFailed(...args),
    listForRecipient: (...args) => getDefaultService().listForRecipient(...args),
    markRead: (...args) => getDefaultService().markRead(...args)
};
