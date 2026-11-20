'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createNotificationDeliveryService } = require('../services/notificationDeliveryService');

const url = process.env.PG_TEST_URL;
if (!url) {
    console.error('[notification-delivery-postgres] PG_TEST_URL required; refusing application DB fallback.');
    process.exit(1);
}

(async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const schema = 'notification_delivery_' + process.pid;
    const convert = sql => {
        let index = 0;
        return sql.replace(/\?/g, () => '$' + (++index));
    };
    const db = {
        DB_TYPE: 'postgres',
        all: async (sql, params = [], tx = null) => (await (tx || client).query(convert(sql), params)).rows,
        get: async (sql, params = [], tx = null) => {
            const result = await (tx || client).query(convert(sql), params);
            return result.rows[0];
        },
        run: async (sql, params = [], tx = null) => {
            const result = await (tx || client).query(convert(sql), params);
            return { changes: result.rowCount };
        },
        transaction: async callback => {
            await client.query('BEGIN');
            try {
                const result = await callback(client);
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        }
    };

    try {
        await client.query('CREATE SCHEMA "' + schema + '"');
        await client.query('SET search_path TO "' + schema + '"');
        const migration = fs.readFileSync(
            path.join(__dirname, '..', 'database', 'migrations', '20261120_shared_notification_deliveries.postgres.sql'),
            'utf8'
        );
        await client.query(migration);
        const service = createNotificationDeliveryService(db);
        const input = {
            schoolId: 1, recipientType: 'staff', recipientId: 20,
            sourceType: 'attendance_register_reminder', sourceId: 501,
            idempotencyKey: 'attendance:501:staff:20:stage:1',
            category: 'attendance', title: 'Attendance register overdue',
            scheduledAt: '2026-11-20T10:00:00.000Z'
        };
        const first = await service.enqueue(input);
        const duplicate = await service.enqueue(input);
        assert.strictEqual(String(first.id), String(duplicate.id));
        const result = await service.dispatchDue({ now: '2026-11-20T10:00:00.000Z' });
        assert.strictEqual(result.deliveredCount, 1);
        const feed = await service.listDeliveredForRecipient({
            schoolId: 1, recipientType: 'staff', recipientId: 20
        });
        assert.strictEqual(feed.length, 1);
        assert.strictEqual(feed[0].status, undefined, 'feed intentionally returns presentation fields only');
        assert.strictEqual(feed[0].title, 'Attendance register overdue');
        console.log('[notification-delivery-postgres] migration, idempotent enqueue, dispatch and recipient feed passed.');
    } finally {
        try {
            await client.query('SET search_path TO public');
            await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
        } finally {
            client.release();
            await pool.end();
        }
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
