'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { createAttendanceTrackingService } = require('../services/attendanceTrackingService');

(async () => {
    const sqlite = new Database(':memory:');
    try {
        sqlite.exec(`
            CREATE TABLE sections (
                id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, name TEXT NOT NULL,
                current_session TEXT, current_term TEXT
            );
            CREATE TABLE classes (
                id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, section_id INTEGER NOT NULL,
                name TEXT NOT NULL, form_teacher_id INTEGER
            );
            CREATE TABLE staff (
                id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, status TEXT NOT NULL,
                first_name TEXT NOT NULL, last_name TEXT NOT NULL
            );
            CREATE TABLE class_assignments (
                id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL, class_id INTEGER NOT NULL, session TEXT NOT NULL
            );
            CREATE TABLE subject_assignments (
                id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL, class_id INTEGER NOT NULL, session TEXT NOT NULL
            );
            CREATE TABLE attendance (
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, class_id INTEGER NOT NULL,
                status TEXT NOT NULL, date TEXT NOT NULL, session TEXT NOT NULL, term TEXT NOT NULL
            );
            CREATE TABLE notification_deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
                recipient_type TEXT NOT NULL, recipient_id INTEGER NOT NULL,
                source_type TEXT NOT NULL, source_id INTEGER NOT NULL,
                idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, delivered_at TEXT, title TEXT NOT NULL, body TEXT, destination TEXT
            );
            INSERT INTO sections VALUES
                (1, 1, 'Academy', '2026/2027', '1st Term'),
                (2, 1, 'Tahfeez', '2025/2026', '3rd Term');
            INSERT INTO classes VALUES
                (10, 1, 1, 'Nursery 2', 20),
                (11, 1, 1, 'Primary 1', NULL),
                (12, 1, 2, 'F 2', NULL);
            INSERT INTO staff VALUES
                (20, 1, 'active', 'Aisha', 'Teacher'),
                (21, 1, 'active', 'Bello', 'Teacher'),
                (22, 1, 'active', 'Old', 'Assignment'),
                (23, 1, 'inactive', 'Inactive', 'Teacher'),
                (24, 1, 'active', 'Subject', 'Only');
            INSERT INTO class_assignments VALUES
                (1, 20, 10, '2026/2027'),
                (2, 21, 10, '2026/2027'),
                (3, 22, 10, '2025/2026'),
                (4, 23, 10, '2026/2027'),
                (5, 24, 12, '2025/2026');
            INSERT INTO subject_assignments VALUES (1, 24, 10, '2026/2027');
            INSERT INTO attendance VALUES
                (1, 500, 11, 'Present', '2026-11-21', '2026/2027', '1st Term');
        `);

        const db = {
            get: async (sql, params = []) => sqlite.prepare(sql).get(...params),
            all: async (sql, params = []) => sqlite.prepare(sql).all(...params),
            run: async (sql, params = []) => {
                const result = sqlite.prepare(sql).run(...params);
                return { changes: result.changes, lastID: Number(result.lastInsertRowid) };
            }
        };
        const notificationKeys = new Set();
        const notificationDelivery = {
            async isAvailable() { return true; },
            async enqueue(input) {
                if (notificationKeys.has(input.idempotencyKey)) return { created: false };
                notificationKeys.add(input.idempotencyKey);
                await db.run(`
                    INSERT INTO notification_deliveries
                    (school_id, recipient_type, recipient_id, source_type, source_id,
                     idempotency_key, status, created_at, title, body, destination)
                    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
                `, [input.schoolId, input.recipientType, input.recipientId, input.sourceType,
                    input.sourceId, input.idempotencyKey, '2026-11-21T10:00:00.000Z',
                    input.title, input.body, input.destination]);
                return { created: true };
            },
            async dispatchDue() {
                const result = await db.run(`
                    UPDATE notification_deliveries SET status = 'delivered',
                        delivered_at = '2026-11-21T10:00:01.000Z'
                    WHERE status = 'queued'
                `);
                return { deliveredCount: result.changes };
            }
        };
        const service = createAttendanceTrackingService({
            db,
            sessionHelper: {
                async getCurrentSession() { return '2026/2027'; },
                async getCurrentTerm() { return '1st Term'; },
                async getAvailableSessions() { return ['2026/2027', '2025/2026']; },
                getAvailableTerms() { return ['1st Term', '2nd Term', '3rd Term']; }
            },
            notificationDelivery
        });

        const page = await service.getTrackingPage({
            schoolId: 1, date: '2026-11-21', sectionId: 1
        });
        assert.strictEqual(page.isCurrentContext, true);
        assert.strictEqual(page.classes.find(row => row.id === 11).recorded, true);
        assert.strictEqual(page.classes.find(row => row.id === 11).studentCount, 1);
        assert.deepStrictEqual(page.classes.find(row => row.id === 10).recipients.map(row => row.id), [20, 21],
            'only active form teacher and current-session administrative assignments are recipients');

        const tahfeezPage = await service.getTrackingPage({
            schoolId: 1, date: '2026-11-21', sectionId: 2
        });
        assert.strictEqual(tahfeezPage.session, '2025/2026');
        assert.strictEqual(tahfeezPage.term, '3rd Term');
        assert.strictEqual(tahfeezPage.isCurrentContext, true,
            'Tahfeez uses its own current session and term rather than Academy or school settings');

        const sent = await service.sendManualPing({
            schoolId: 1, actorStaffId: 1, classId: 10, sectionId: 1,
            date: '2026-11-21', session: '2026/2027', term: '1st Term'
        });
        assert.strictEqual(sent.recipientCount, 2);
        assert.strictEqual(sent.createdCount, 2);
        assert.strictEqual(sent.history.length, 2);
        assert.ok(sent.history.every(row => row.status === 'delivered'));

        const duplicate = await service.sendManualPing({
            schoolId: 1, actorStaffId: 1, classId: 10, sectionId: 1,
            date: '2026-11-21', session: '2026/2027', term: '1st Term'
        });
        assert.strictEqual(duplicate.createdCount, 0, 'repeated pings must be idempotent');

        await db.run(`
            INSERT INTO attendance VALUES (2, 501, 10, 'Present', '2026-11-21', '2026/2027', '1st Term')
        `);
        const afterAttendance = await service.getTrackingPage({
            schoolId: 1, date: '2026-11-21', sectionId: 1
        });
        const nurseryAfterPing = afterAttendance.classes.find(row => row.id === 10);
        assert.strictEqual(nurseryAfterPing.recorded, true);
        assert.strictEqual(nurseryAfterPing.pingHistory.length, 2,
            'ping history remains available after attendance is later recorded');

        await assert.rejects(() => service.sendManualPing({
            schoolId: 1, actorStaffId: 1, classId: 11, sectionId: 1,
            date: '2026-11-21', session: '2026/2027', term: '1st Term'
        }), /already recorded/i);

        await assert.rejects(() => service.sendManualPing({
            schoolId: 1, actorStaffId: 1, classId: 10, sectionId: 1,
            date: '2026-11-21', session: '2025/2026', term: '3rd Term'
        }), /currently configured session and term/i);

        const unavailableService = createAttendanceTrackingService({
            db,
            sessionHelper: {
                async getCurrentSession() { return '2026/2027'; },
                async getCurrentTerm() { return '1st Term'; },
                async getAvailableSessions() { return ['2026/2027']; },
                getAvailableTerms() { return ['1st Term', '2nd Term', '3rd Term']; }
            },
            notificationDelivery: { async isAvailable() { return false; } }
        });
        await assert.rejects(() => unavailableService.sendManualPing({
            schoolId: 1, actorStaffId: 1, classId: 10, sectionId: 1,
            date: '2026-11-22', session: '2026/2027', term: '1st Term'
        }), error => error.code === 'notification_unavailable');

        console.log('[attendance-tracking] section contexts, recorded status, administrative recipients, idempotency and unavailable-notification handling passed.');
    } finally {
        sqlite.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
