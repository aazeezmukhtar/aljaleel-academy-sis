'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.resolve(__dirname, '..', 'controllers', 'notificationController.js');
const calls = { deliveredForStaff: [], acknowledgements: [], committed: 0, rolledBack: 0, readInserts: 0 };
let failReadInsert = false;

const reminder = {
    id: 501,
    class_id: 40,
    register_date: '2026-11-20',
    created_at: '2026-11-20T13:00:00.000Z'
};

const mockDb = {
    async all(sql, params) {
        if (sql.includes('FROM announcements')) return [];
        if (sql.includes('FROM class_posts')) return [];
        if (sql.includes('FROM attendance_register_reminders')) return [reminder];
        if (sql.includes('FROM notification_reads')) return [];
        throw new Error('Unexpected notification query: ' + sql);
    },
    async run(sql, params, client) {
        if (sql.includes('INSERT INTO notification_reads')) {
            assert.ok(client, 'reminder read-state insert must use the acknowledgement transaction');
            calls.readInserts += 1;
            if (failReadInsert) throw new Error('Simulated read-state write failure');
            return { changes: 1 };
        }
        throw new Error('Unexpected notification write: ' + sql);
    },
    async transaction(callback) {
        const client = { transaction: calls.committed + calls.rolledBack + 1 };
        try {
            const result = await callback(client);
            calls.committed += 1;
            return result;
        } catch (error) {
            calls.rolledBack += 1;
            throw error;
        }
    }
};

const mocks = {
    '../utils/db': mockDb,
    '../services/attendanceRegisterWorkflowService': {
        async isFoundationAvailable() { return true; }
    },
    '../services/attendanceRegisterReminderService': {
        async deliverDueRemindersForStaff(input) {
            calls.deliveredForStaff.push(input.staffId);
            return [];
        },
        async acknowledgeReminder(input, client) {
            calls.acknowledgements.push({ input, client });
            return Number(input.reminderId) !== 999;
        }
    }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === controllerPath &&
        Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
};

let controller;
try {
    controller = require(controllerPath);
} finally {
    Module._load = originalLoad;
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; }
    };
}

(async () => {
    const response = responseRecorder();
    await controller.getLatestNotifications({
        session: { staff: { id: 20, school_id: 1, role: 'Teacher' } },
        schoolId: 1
    }, response);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.notifications.length, 1);

    const notification = response.body.notifications[0];
    assert.strictEqual(notification.id, 501);
    assert.strictEqual(notification.type, 'Attendance Reminder');
    assert.strictEqual(notification.source_type, 'attendance_register_reminder');
    assert.strictEqual(
        notification.url,
        '/attendance/take?class_id=40&date=2026-11-20',
        'attendance reminder notifications must retain a working register destination'
    );
    assert.strictEqual(notification.isRead, false);
    assert.strictEqual(response.body.unreadCount, 1);
    assert.deepStrictEqual(calls.deliveredForStaff, [20]);

    const acknowledgementResponse = responseRecorder();
    await controller.markAsRead({
        session: { staff: { id: 20, school_id: 1, role: 'Teacher' } },
        body: { source_id: 501, source_type: 'attendance_register_reminder' }
    }, acknowledgementResponse);
    assert.strictEqual(acknowledgementResponse.statusCode, 200);
    assert.deepStrictEqual(acknowledgementResponse.body, { success: true });
    assert.strictEqual(calls.committed, 1);
    assert.strictEqual(calls.readInserts, 1);
    assert.strictEqual(calls.acknowledgements[0].input.staffId, 20);
    assert.strictEqual(calls.acknowledgements[0].input.reminderId, 501);
    assert.ok(calls.acknowledgements[0].client, 'acknowledgement must share the read-state transaction');

    const missingReminderResponse = responseRecorder();
    await controller.markAsRead({
        session: { staff: { id: 20, school_id: 1, role: 'Teacher' } },
        body: { source_id: 999, source_type: 'attendance_register_reminder' }
    }, missingReminderResponse);
    assert.strictEqual(missingReminderResponse.statusCode, 404);
    assert.strictEqual(calls.readInserts, 1, 'unknown or unowned reminders must not create read-state rows');

    failReadInsert = true;
    const failedTransactionResponse = responseRecorder();
    await controller.markAsRead({
        session: { staff: { id: 20, school_id: 1, role: 'Teacher' } },
        body: { source_id: 501, source_type: 'attendance_register_reminder' }
    }, failedTransactionResponse);
    assert.strictEqual(failedTransactionResponse.statusCode, 500);
    assert.strictEqual(calls.rolledBack, 1, 'read-state failure must roll back the acknowledgement transaction');

    console.log('[attendance-reminder-notification] notification retrieval and atomic reminder acknowledgement tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
