'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.resolve(__dirname, '..', 'controllers', 'attendanceController.js');
const calls = { generated: 0, registerContext: 0, legacyTransaction: 0, inserted: 0 };

const mockDb = {
    async get(sql) {
        if (sql.includes('SELECT * FROM classes') || sql.includes('SELECT id, section_id FROM classes')) {
            return { id: 40, school_id: 1, section_id: 10, name: 'Primary 1' };
        }
        if (sql.includes('FROM sections s')) {
            return { id: 10, current_session: '2026/2027', current_term: '1st Term' };
        }
        if (sql.includes('FROM students s')) return { id: 30 };
        return null;
    },
    async all() { return []; },
    async run() { calls.inserted += 1; return { changes: 1 }; },
    async transaction(callback) {
        calls.legacyTransaction += 1;
        return callback({});
    }
};

const workflow = {
    async isFoundationAvailable() { throw new Error('Standard attendance must not inspect the register foundation'); },
    async getRegisterContext() { calls.registerContext += 1; throw new Error('Standard attendance must not load register context'); },
    async saveRegisterProgress() { throw new Error('Standard attendance must not save a register'); },
    async submitRegister() { throw new Error('Register submission is outside this standard marking test'); }
};
const generation = {
    async generateExpectedRegister() {
        calls.generated += 1;
        throw new Error('Standard attendance must not generate an expected register');
    }
};

const mocks = {
    '../utils/db': mockDb,
    '../utils/logger': { logAction() {} },
    '../utils/attendanceStudentHelper': {
        async getAttendanceStudents() {
            return [{ id: 30, first_name: 'Amina', last_name: 'Adamu', status: null }];
        }
    },
    '../utils/sessionHelper': {
        async getCurrentSession() { return '2026/2027'; },
        async getCurrentTerm() { return '1st Term'; }
    },
    '../utils/whatsappHelper': { buildWhatsAppAttendanceAction() { return {}; } },
    '../services/attendanceRegisterGenerationService': generation,
    '../services/attendanceRegisterWorkflowService': workflow,
    '../services/attendanceRegisterAdministrationService': {},
    '../services/attendanceClosureService': {},
    '../services/attendanceAnalyticsService': {
        createAttendanceAnalyticsService() { return {}; }
    },
    '../services/attendanceAnalyticsDashboardService': {
        createAttendanceAnalyticsDashboardService() { return {}; }
    }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (parent && parent.filename === controllerPath && Object.prototype.hasOwnProperty.call(mocks, request)) {
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
        rendered: null,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
        render(view, data) { this.rendered = { view, data }; return this; },
        redirect(location) { this.redirected = location; return this; },
        send(value) { this.sent = value; return this; }
    };
}

(async () => {
    const admin = { id: 21, school_id: 1, role: 'Admin' };

    const pageResponse = responseRecorder();
    await controller.getTakeAttendance({
        query: { class_id: '40', date: '2026-11-21' },
        session: { staff: admin },
        schoolId: 1
    }, pageResponse);

    assert.strictEqual(pageResponse.rendered.view, 'attendance/take');
    assert.strictEqual(pageResponse.rendered.data.register, null);
    assert.strictEqual(pageResponse.rendered.data.registerFeatureAvailable, false);
    assert.strictEqual(pageResponse.rendered.data.registerSkipReason, null);
    assert.strictEqual(pageResponse.rendered.data.readOnly, false,
        'legacy schedule/register setup must never freeze the standard attendance form');
    assert.strictEqual(pageResponse.rendered.data.canEdit, true);
    assert.strictEqual(pageResponse.rendered.data.students.length, 1);
    assert.strictEqual(calls.generated, 0);
    assert.strictEqual(calls.registerContext, 0);

    const saveResponse = responseRecorder();
    await controller.saveAttendance({
        body: {
            class_id: '40',
            date: '2026-11-21',
            session: '2026/2027',
            term: '1st Term',
            attendance: { 30: 'Present' }
        },
        session: { staff: admin },
        schoolId: 1,
        ip: '127.0.0.1'
    }, saveResponse);

    assert.strictEqual(saveResponse.statusCode, 200);
    assert.strictEqual(saveResponse.body.success, true,
        'attendance must save through the established attendance table path');
    assert.strictEqual(calls.legacyTransaction, 1);
    assert.strictEqual(calls.inserted, 1);
    assert.strictEqual(calls.generated, 0);
    assert.strictEqual(calls.registerContext, 0);

    console.log('[attendance-controller-handlers] standard attendance remains editable and saves without invoking deferred register/schedule setup.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
