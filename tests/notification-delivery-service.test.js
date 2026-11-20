'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createNotificationDeliveryService } = require('../services/notificationDeliveryService');

(async () => {
    const sqlite = new Database(':memory:');
    try {
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'database', 'migrations', '20261120_shared_notification_deliveries.sqlite.sql'),
            'utf8'
        );
        sqlite.exec(migration);
        const db = {
            DB_TYPE: 'sqlite',
            all: async (sql, params = []) => sqlite.prepare(sql).all(params),
            get: async (sql, params = []) => sqlite.prepare(sql).get(params),
            run: async (sql, params = []) => {
                const result = sqlite.prepare(sql).run(params);
                return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
            },
            transaction: async callback => {
                sqlite.exec('BEGIN');
                try {
                    const result = await callback(null);
                    sqlite.exec('COMMIT');
                    return result;
                } catch (error) {
                    sqlite.exec('ROLLBACK');
                    throw error;
                }
            }
        };
        const service = createNotificationDeliveryService(db);
        const base = {
            schoolId: 1, recipientType: 'staff', recipientId: 20,
            sourceType: 'attendance_register_reminder', sourceId: 501,
            idempotencyKey: 'attendance:501:staff:20:stage:1',
            category: 'attendance', title: 'Attendance register overdue',
            destinationPath: '/attendance/take?class_id=40&date=2026-11-20',
            scheduledAt: '2026-11-20T10:00:00.000Z'
        };

        const first = await service.enqueue(base);
        const duplicate = await service.enqueue({ ...base, title: 'Changed title on retry' });
        assert.strictEqual(first.id, duplicate.id, 'same recipient and idempotency key must return the original delivery');
        assert.strictEqual(duplicate.title, 'Attendance register overdue');
        assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_deliveries').get().count, 1);

        const otherRecipient = await service.enqueue({ ...base, recipientId: 21 });
        assert.notStrictEqual(otherRecipient.id, first.id, 'idempotency must be scoped to the recipient');
        const otherSchool = await service.enqueue({ ...base, schoolId: 2 });
        assert.notStrictEqual(otherSchool.id, first.id, 'idempotency must be scoped to the school');

        const beforeDue = await service.dispatchDue({ now: '2026-11-20T09:59:59.000Z', limit: 10 });
        assert.strictEqual(beforeDue.deliveredCount, 0);
        const dispatched = await service.dispatchDue({ now: '2026-11-20T10:00:00.000Z', limit: 10 });
        assert.strictEqual(dispatched.selectedCount, 3);
        assert.strictEqual(dispatched.deliveredCount, 3);
        const repeated = await service.dispatchDue({ now: '2026-11-20T10:01:00.000Z', limit: 10 });
        assert.strictEqual(repeated.deliveredCount, 0, 'repeated dispatch must not redeliver already delivered rows');

        const staffFeed = await service.listDeliveredForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 20
        });
        assert.strictEqual(staffFeed.length, 1);
        assert.strictEqual(staffFeed[0].id, first.id);
        const wrongStaffFeed = await service.listDeliveredForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 999
        });
        assert.strictEqual(wrongStaffFeed.length, 0);
        const wrongSchoolFeed = await service.listDeliveredForRecipient({
            schoolId: 2, recipientType: 'staff', recipientId: 20
        });
        assert.strictEqual(wrongSchoolFeed.length, 1);
        assert.strictEqual(wrongSchoolFeed[0].id, otherSchool.id);

        const future = await service.enqueue({
            ...base, sourceId: 502, idempotencyKey: 'attendance:502:staff:20:stage:1',
            scheduledAt: '2026-11-21T10:00:00.000Z'
        });
        const cancelled = await service.cancelQueued({
            schoolId: 1, sourceType: 'attendance_register_reminder', sourceId: 502,
            now: '2026-11-20T12:00:00.000Z'
        });
        assert.strictEqual(cancelled.changes, 1);
        const afterCancel = await service.dispatchDue({ now: '2026-11-22T10:00:00.000Z' });
        assert.strictEqual(afterCancel.deliveredCount, 0);
        assert.strictEqual(sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(future.id).status, 'cancelled');

        await assert.rejects(() => service.enqueue({ ...base, recipientType: 'parent' }), /staff or student/);
        await assert.rejects(() => service.dispatchDue({ limit: 501 }), /between 1 and 500/);
        await assert.rejects(() => service.listDeliveredForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 20, limit: 101
        }), /between 1 and 100/);

        assert.throws(() => sqlite.prepare(`
            INSERT INTO notification_deliveries
                (school_id, recipient_type, recipient_id, source_type, source_id,
                 idempotency_key, category, title, status)
            VALUES (1, 'staff', 20, 'test', 900, 'invalid', 'test', 'bad', 'delivered')
        `).run(), /CHECK constraint failed/);

        console.log('[notification-delivery-service] idempotency, due dispatch, recipient isolation, cancellation and validation passed.');
    } finally {
        sqlite.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
