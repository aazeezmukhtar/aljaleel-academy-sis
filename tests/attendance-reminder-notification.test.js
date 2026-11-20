'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.resolve(__dirname, '..', 'controllers', 'notificationController.js');
const calls = { deliveredForStaff: [] };

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
    async run() {
        throw new Error('This notification destination test must not write to the database');
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
        async acknowledgeReminder() { return true; }
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

    console.log('[attendance-reminder-notification] actual notification handler preserves the register destination and delivers reminders for the signed-in staff member.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
