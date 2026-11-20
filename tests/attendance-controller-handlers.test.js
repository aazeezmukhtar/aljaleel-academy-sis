'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.resolve(__dirname, '..', 'controllers', 'attendanceController.js');
const calls = { generated: 0, legacyTransaction: 0 };
let generationReason = 'enrollment_dates_need_review';
const mockDb = {
    async get(sql) {
        if (sql.includes('SELECT * FROM classes') || sql.includes('SELECT id, section_id FROM classes')) {
            return { id: 40, school_id: 1, section_id: 10, name: 'Primary 1' };
        }
        if (sql.includes('FROM sections s')) {
            return { id: 10, current_session: '2026/2027', current_term: '1st Term' };
        }
        return null;
    },
    async all() { return []; },
    async run() { throw new Error('Unexpected database write in controller guard test'); },
    async transaction() {
        calls.legacyTransaction += 1;
        throw new Error('Legacy attendance transaction must not run for enrollment-review cases');
    }
};

const workflow = {
    async isFoundationAvailable() { return true; },
    async getRegisterContext() { return null; },
    async saveRegisterProgress() { throw new Error('Register save must not run'); },
    async submitRegister() { throw new Error('Register submit must not run'); }
};
const generation = {
    async generateExpectedRegister() {
        calls.generated += 1;
        return { created: false, skipped: true, reason: generationReason };
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
        query: { class_id: '40', date: '2026-11-20' },
        session: { staff: admin },
        schoolId: 1
    }, pageResponse);

    assert.strictEqual(pageResponse.rendered.view, 'attendance/take');
    assert.strictEqual(pageResponse.rendered.data.registerSkipReason, 'enrollment_dates_need_review');
    assert.strictEqual(pageResponse.rendered.data.readOnly, true);
    assert.strictEqual(pageResponse.rendered.data.canEdit, false);
    assert.strictEqual(pageResponse.rendered.data.students.length, 1);
    assert.strictEqual(calls.generated, 1, 'GET must attempt register generation and preserve the skip reason');

    calls.generated = 0;
    const saveResponse = responseRecorder();
    await controller.saveAttendance({
        body: {
            class_id: '40',
            date: '2026-11-20',
            session: '2026/2027',
            term: '1st Term',
            attendance: { 30: 'Present' }
        },
        session: { staff: admin },
        schoolId: 1,
        ip: '127.0.0.1'
    }, saveResponse);

    assert.strictEqual(saveResponse.statusCode, 409);
    assert.strictEqual(saveResponse.body.success, false);
    assert.strictEqual(saveResponse.body.code, 'enrollment_dates_need_review');
    assert.match(saveResponse.body.message, /administrative review/i);
    assert.strictEqual(calls.generated, 1);
    assert.strictEqual(calls.legacyTransaction, 0, 'blocked requests must never fall through to legacy attendance writes');

    for (const reason of ['no_academic_period', 'attendance_settings_missing']) {
        generationReason = reason;
        calls.generated = 0;
        const blockedPage = responseRecorder();
        await controller.getTakeAttendance({
            query: { class_id: '40', date: '2026-11-20' },
            session: { staff: admin }, schoolId: 1
        }, blockedPage);
        assert.strictEqual(blockedPage.rendered.data.registerSkipReason, reason);
        assert.strictEqual(blockedPage.rendered.data.readOnly, true, reason + ' must render a read-only page');
        assert.strictEqual(blockedPage.rendered.data.canEdit, false, reason + ' must disable editing');

        calls.generated = 0;
        const blockedSave = responseRecorder();
        await controller.saveAttendance({
            body: { class_id: '40', date: '2026-11-20', session: '2026/2027', term: '1st Term', attendance: { 30: 'Present' } },
            session: { staff: admin }, schoolId: 1, ip: '127.0.0.1'
        }, blockedSave);
        assert.strictEqual(blockedSave.statusCode, 409, reason + ' must reject legacy attendance saving');
        assert.strictEqual(blockedSave.body.code, reason);
        assert.match(blockedSave.body.message, /administrator/i);
        assert.strictEqual(calls.generated, 1);
        assert.strictEqual(calls.legacyTransaction, 0, reason + ' must not fall through to legacy writes');
    }

    console.log('[attendance-controller-handlers] actual GET and POST handlers block enrollment-review, missing-period and missing-settings cases without legacy writes.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
