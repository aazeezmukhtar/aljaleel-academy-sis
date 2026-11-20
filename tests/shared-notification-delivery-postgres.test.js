'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createSharedNotificationDeliveryService } =
    require('../services/sharedNotificationDeliveryService');

const url = process.env.PG_TEST_URL;
if (!url) {
    console.error('[shared-notification-delivery-postgres] PG_TEST_URL required; refusing application DB fallback.');
    process.exit(1);
}

(async () => {
    const schema = 'shared_notification_test_' + process.pid;
    const bootstrapPool = new Pool({ connectionString: url, max: 1 });
    let bootstrapClient;
    let pool;
    let setupClient;
    try {
        bootstrapClient = await bootstrapPool.connect();
        await bootstrapClient.query('CREATE SCHEMA "' + schema + '"');
        await bootstrapClient.query('SET search_path TO "' + schema + '"');
        await bootstrapClient.query(`
            CREATE TABLE schools (id INTEGER PRIMARY KEY);
            INSERT INTO schools (id) VALUES (1), (2);
            CREATE TABLE staff (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL);
            CREATE TABLE students (id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL);
            INSERT INTO staff (id, school_id) VALUES
                (20, 1), (30, 1), (31, 1), (32, 1), (33, 1), (34, 1), (35, 1),
                (50, 1), (60, 1);
            CREATE TABLE notification_reads (
                user_id INTEGER NOT NULL,
                user_type TEXT NOT NULL,
                source_id BIGINT NOT NULL,
                source_type TEXT NOT NULL,
                read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, user_type, source_id, source_type)
            );
        `);
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'database', 'migrations', '20261120_shared_notification_deliveries.postgres.sql'),
            'utf8'
        );
        await bootstrapClient.query(migration);
        await bootstrapClient.query(migration);
        await bootstrapClient.query('SET search_path TO public');
        bootstrapClient.release();
        bootstrapClient = null;

        pool = new Pool({
            connectionString: url,
            max: 4,
            options: '-c search_path=' + schema
        });
        setupClient = await pool.connect();

        const db = {
            DB_TYPE: 'postgres',
            async query(sql, params = [], client = null) {
                let index = 1;
                const converted = sql.replace(/\?/g, () => '$' + index++);
                return (client || pool).query(converted, params);
            },
            async get(sql, params = [], client = null) {
                const result = await this.query(sql, params, client);
                return result.rows[0];
            },
            async all(sql, params = [], client = null) {
                const result = await this.query(sql, params, client);
                return result.rows;
            },
            async run(sql, params = [], client = null) {
                const result = await this.query(sql, params, client);
                return { changes: result.rowCount };
            },
            async transaction(callback) {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    const result = await callback(client);
                    await client.query('COMMIT');
                    return result;
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            }
        };
        const service = createSharedNotificationDeliveryService(db);
        const common = {
            schoolId: 1,
            recipientType: 'staff',
            recipientId: 20,
            category: 'attendance',
            sourceType: 'attendance_register_reminder',
            title: 'Attendance register overdue',
            body: 'Please complete the register.',
            destination: '/attendance/take?class_id=40&date=2026-11-20',
            scheduledAt: '2026-11-20T10:00:00.000Z'
        };

        const first = await service.enqueue({
            ...common, sourceId: 1001, idempotencyKey: 'pg:attendance:1001:20'
        });
        const duplicate = await service.enqueue({
            ...common, sourceId: 1001, idempotencyKey: 'pg:attendance:1001:20'
        });
        assert.strictEqual(duplicate.created, false);
        assert.strictEqual(String(duplicate.id), String(first.id));

        const queued = [];
        for (let i = 0; i < 6; i += 1) {
            queued.push(await service.enqueue({
                ...common,
                recipientId: 30 + i,
                sourceId: 1100 + i,
                idempotencyKey: 'pg:concurrent:' + i
            }));
        }
        const concurrent = await Promise.all([
            service.dispatchDue({ now: '2026-11-20T10:30:00.000Z', limit: 20 }),
            service.dispatchDue({ now: '2026-11-20T10:30:00.000Z', limit: 20 })
        ]);
        assert.strictEqual(
            concurrent.reduce((sum, result) => sum + result.deliveredCount, 0),
            7,
            'overlapping dispatchers must publish each due item once'
        );
        const deliveredRows = await setupClient.query(`
            SELECT id, status, delivered_at, attempt_count
            FROM notification_deliveries
            ORDER BY id
        `);
        assert.strictEqual(deliveredRows.rows.length, 7);
        assert.ok(deliveredRows.rows.every(row =>
            row.status === 'delivered' && row.delivered_at && Number(row.attempt_count) === 1
        ));

        const read = await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 20, deliveryId: first.id
        });
        assert.strictEqual(read, true);
        const repeatedRead = await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 20, deliveryId: first.id
        });
        assert.strictEqual(repeatedRead, true);
        assert.strictEqual(
            (await setupClient.query("SELECT COUNT(*)::int AS n FROM notification_reads WHERE source_type = 'notification_delivery' AND source_id = $1", [first.id])).rows[0].n,
            1
        );
        assert.strictEqual(await service.markRead({
            schoolId: 1, recipientType: 'staff', recipientId: 999, deliveryId: first.id
        }), false, 'a different recipient cannot mark this notification as read');

        const future = await service.enqueue({
            ...common, recipientId: 50, sourceId: 1200,
            idempotencyKey: 'pg:future', scheduledAt: '2026-11-21T10:00:00.000Z'
        });
        assert.strictEqual(await service.cancel({
            schoolId: 1, deliveryId: future.id, now: '2026-11-20T10:45:00.000Z'
        }), true);
        assert.strictEqual(await service.cancel({
            schoolId: 2, deliveryId: future.id
        }), false, 'another school cannot cancel this notification');

        const failed = await service.enqueue({
            ...common, recipientId: 60, sourceId: 1300, idempotencyKey: 'pg:failed',
            scheduledAt: '2026-11-21T10:00:00.000Z'
        });
        assert.strictEqual(await service.markFailed({
            schoolId: 1, deliveryId: failed.id, errorMessage: 'Simulated dispatch failure'
        }), true);
        const failedRow = (await setupClient.query(
            'SELECT status, attempt_count, last_error FROM notification_deliveries WHERE id = $1',
            [failed.id]
        )).rows[0];
        assert.deepStrictEqual(failedRow, {
            status: 'failed', attempt_count: 1, last_error: 'Simulated dispatch failure'
        });

        const recipientRows = await service.listForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 20
        });
        assert.strictEqual(recipientRows.length, 1);
        assert.strictEqual(recipientRows[0].status, 'read');
        assert.strictEqual(Number(recipientRows[0].is_read), 1);

        console.log('[shared-notification-delivery-postgres] migration, idempotency, concurrent dispatch, recipient isolation, read state, cancellation and failure handling passed.');
    } finally {
        if (setupClient) setupClient.release();
        if (pool) await pool.end();
        if (bootstrapClient) bootstrapClient.release();
        const cleanupClient = await bootstrapPool.connect();
        try {
            await cleanupClient.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
        } finally {
            cleanupClient.release();
            await bootstrapPool.end();
        }
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
