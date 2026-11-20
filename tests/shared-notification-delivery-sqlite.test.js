'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createSharedNotificationDeliveryService } =
    require('../services/sharedNotificationDeliveryService');

(async () => {
    const sqlite = new Database(':memory:');
    try {
        sqlite.pragma('foreign_keys = ON');
        sqlite.exec(`
            CREATE TABLE schools (id INTEGER PRIMARY KEY);
            INSERT INTO schools (id) VALUES (1), (2);
            CREATE TABLE staff (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL);
            CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL);
            INSERT INTO staff (id, school_id) VALUES (20, 1), (21, 1), (22, 1);
            INSERT INTO students (id, school_id) VALUES (30, 1);
            CREATE TABLE notification_reads (
                user_id INTEGER NOT NULL,
                user_type TEXT NOT NULL,
                source_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                read_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, user_type, source_id, source_type)
            );
        `);
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'database', 'migrations', '20261120_shared_notification_deliveries.sqlite.sql'),
            'utf8'
        );
        sqlite.exec(migration);
        sqlite.exec(migration);

        const db = {
            DB_TYPE: 'sqlite',
            async get(sql, params = [], client = null) {
                return (client || sqlite).prepare(sql).get(params);
            },
            async all(sql, params = [], client = null) {
                return (client || sqlite).prepare(sql).all(params);
            },
            async run(sql, params = [], client = null) {
                const result = (client || sqlite).prepare(sql).run(params);
                return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
            },
            async transaction(callback) {
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
        const service = createSharedNotificationDeliveryService(db);
        const base = {
            schoolId: 1,
            recipientType: 'staff',
            recipientId: 20,
            category: 'attendance',
            sourceType: 'attendance_register_reminder',
            sourceId: 501,
            idempotencyKey: 'attendance-reminder:501:staff:20',
            title: 'Attendance register overdue',
            body: 'Please complete the register.',
            destination: '/attendance/take?class_id=40&date=2026-11-20',
            scheduledAt: '2026-11-20T10:00:00.000Z'
        };

        const first = await service.enqueue(base);
        assert.strictEqual(first.created, true);
        const duplicate = await service.enqueue(base);
        assert.strictEqual(duplicate.id, first.id);
        await assert.rejects(() => service.enqueue({
            ...base, recipientId: 21
        }), /idempotency key is already assigned/);
        await assert.rejects(() => service.enqueue({
            ...base, schoolId: 2, idempotencyKey: 'wrong-school-recipient'
        }), /does not belong to the selected school/);
        assert.strictEqual(duplicate.created, false);
        assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM notification_deliveries').get().n, 1);

        await assert.rejects(() => service.enqueue({
            ...base, idempotencyKey: 'external-destination', destination: 'https://example.com'
        }), /internal application path/);
        await assert.rejects(() => service.enqueue({
            ...base, idempotencyKey: 'protocol-relative-destination', destination: '//outside.example'
        }), /internal application path/);
        await assert.rejects(() => service.enqueue({
            ...base, idempotencyKey: 'invalid-recipient-type', recipientType: 'parent'
        }), /staff or student/);

        const future = await service.enqueue({
            ...base,
            idempotencyKey: 'future-delivery',
            sourceId: 502,
            recipientId: 21,
            scheduledAt: '2026-11-20T11:00:00.000Z'
        });
        const dueResult = await service.dispatchDue({
            now: '2026-11-20T10:30:00.000Z',
            limit: 10
        });
        assert.strictEqual(dueResult.deliveredCount, 1);
        assert.deepStrictEqual(dueResult.deliveredIds, [first.id]);
        assert.strictEqual(
            sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(first.id).status,
            'delivered'
        );
        assert.strictEqual(
            sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(future.id).status,
            'queued',
            'future deliveries must remain queued'
        );

        const recipientItems = await service.listForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 20
        });
        assert.strictEqual(recipientItems.length, 1);
        assert.strictEqual(recipientItems[0].id, first.id);
        assert.strictEqual(recipientItems[0].is_read, 0);
        assert.strictEqual((await service.listForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 999
        })).length, 0, 'recipients must not see another user\'s deliveries');
        assert.strictEqual((await service.listForRecipient({
            schoolId: 2, recipientType: 'staff', recipientId: 20
        })).length, 0, 'recipients must not see deliveries from another school');

        assert.strictEqual(await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 21, deliveryId: first.id
        }), false, 'another recipient must not mark the delivery as read');
        assert.strictEqual(await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 20, deliveryId: first.id
        }), true);
        assert.strictEqual(await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 20, deliveryId: first.id
        }), true, 'repeated read acknowledgement must be idempotent');
        assert.strictEqual(
            sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(first.id).status,
            'read'
        );
        assert.strictEqual(
            sqlite.prepare("SELECT COUNT(*) AS n FROM notification_reads WHERE source_type = 'notification_delivery' AND source_id = ?").get(first.id).n,
            1
        );

        const cancelA = await service.enqueue({
            ...base, idempotencyKey: 'cancel-source-a', sourceId: 600, scheduledAt: '2026-11-21T10:00:00Z'
        });
        const cancelB = await service.enqueue({
            ...base, idempotencyKey: 'cancel-source-b', sourceId: 600, recipientId: 22, scheduledAt: '2026-11-21T10:00:00Z'
        });
        assert.strictEqual(await service.cancelSource({
            schoolId: 1, sourceType: base.sourceType, sourceId: 600,
            now: '2026-11-20T10:45:00Z'
        }), 2);
        assert.strictEqual(await service.cancel({
            schoolId: 1, deliveryId: cancelA.id
        }), false, 'already cancelled deliveries must remain unchanged');
        assert.strictEqual(
            sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(cancelB.id).status,
            'cancelled'
        );

        const failed = await service.enqueue({
            ...base, idempotencyKey: 'failure-case', sourceId: 700, scheduledAt: '2026-11-21T10:00:00Z'
        });
        assert.strictEqual(await service.markFailed({
            schoolId: 1, deliveryId: failed.id, errorMessage: 'Simulated publication failure'
        }), true);
        const failedRow = sqlite.prepare('SELECT status, attempt_count, last_error FROM notification_deliveries WHERE id = ?').get(failed.id);
        assert.deepStrictEqual(failedRow, {
            status: 'failed', attempt_count: 1, last_error: 'Simulated publication failure'
        });
        assert.strictEqual(await service.markFailed({
            schoolId: 1, deliveryId: failed.id, errorMessage: 'Second failure'
        }), false, 'failure transition must not overwrite an already failed item');

        const rollbackItem = await service.enqueue({
            ...base, idempotencyKey: 'read-rollback', sourceId: 800
        });
        await service.dispatchDue({ now: '2026-11-22T10:00:00Z' });
        sqlite.exec(`
            CREATE TRIGGER reject_notification_read
            BEFORE INSERT ON notification_reads
            WHEN NEW.source_id = ${Number(rollbackItem.id)}
            BEGIN SELECT RAISE(ABORT, 'simulated read insert failure'); END;
        `);
        await assert.rejects(() => service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 20, deliveryId: rollbackItem.id
        }), /simulated read insert failure/);
        assert.strictEqual(
            sqlite.prepare('SELECT status FROM notification_deliveries WHERE id = ?').get(rollbackItem.id).status,
            'delivered',
            'read status must roll back if notification_reads cannot be written'
        );

        assert.deepStrictEqual(sqlite.pragma('foreign_key_check'), []);
        console.log('[shared-notification-delivery-sqlite] migration, idempotency, scheduling, recipient isolation, read transaction, cancellation and failure handling passed.');
    } finally {
        sqlite.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
