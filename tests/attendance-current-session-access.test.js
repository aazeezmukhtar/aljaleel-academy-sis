'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const { createAttendanceClassAccessService } = require('../services/attendanceClassAccessService');

(async () => {
    const sqlite = new Database(':memory:');
    try {
        sqlite.exec(`
            CREATE TABLE sections (
                id INTEGER PRIMARY KEY,
                school_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                current_session TEXT
            );
            CREATE TABLE classes (
                id INTEGER PRIMARY KEY,
                school_id INTEGER NOT NULL,
                section_id INTEGER,
                name TEXT NOT NULL,
                form_teacher_id INTEGER
            );
            CREATE TABLE class_assignments (
                id INTEGER PRIMARY KEY,
                staff_id INTEGER NOT NULL,
                class_id INTEGER NOT NULL,
                session TEXT NOT NULL
            );
            INSERT INTO sections VALUES
                (1, 1, 'Academy', '2026/2027'),
                (2, 1, 'Tahfeez', '2025/2026');
            INSERT INTO classes VALUES
                (10, 1, 1, 'Nursery 2', NULL),
                (11, 1, 1, 'Primary 1', NULL),
                (12, 1, 2, 'F 2', NULL),
                (13, 1, 1, 'Primary 2', 20);
            INSERT INTO class_assignments VALUES
                (1, 20, 10, '2025/2026'),
                (2, 20, 11, '2026/2027'),
                (3, 20, 12, '2025/2026');
        `);

        const db = {
            all: async (sql, params) => sqlite.prepare(sql).all(params)
        };
        const service = createAttendanceClassAccessService({
            db,
            sessionHelper: { getCurrentSession: async () => '2026/2027' }
        });
        const teacher = { id: 20, role: 'Teacher' };
        const visible = await service.getAssignedClasses(teacher, 1);
        assert.deepStrictEqual(visible.map(row => Number(row.id)).sort((a, b) => a - b), [11, 12, 13],
            'only assignments matching each class section current session are available');
        assert.strictEqual(await service.hasClassAttendanceAuthority(teacher, 10, 1), false,
            'a prior-session class assignment must not grant current attendance access');
        assert.strictEqual(await service.hasClassAttendanceAuthority(teacher, 11, 1), true,
            'a current-session class assignment grants attendance access');
        assert.strictEqual(await service.hasClassAttendanceAuthority(teacher, 13, 1), true,
            'the current form-teacher field remains a valid administrative responsibility');
        assert.strictEqual(await service.hasClassAttendanceAuthority(teacher, 12, 1), true,
            'a section with its own current session uses that session instead of the school fallback');
        assert.strictEqual(await service.hasClassAttendanceAuthority({ id: 99, role: 'Admin' }, 10, 1), true,
            'administrators retain school-wide access');

        const subjectOnlyDb = {
            all: async () => [],
        };
        const subjectOnlyService = createAttendanceClassAccessService({
            db: subjectOnlyDb,
            sessionHelper: { getCurrentSession: async () => '2026/2027' }
        });
        assert.strictEqual(await subjectOnlyService.hasClassAttendanceAuthority(teacher, 10, 1), false,
            'subject assignments are not queried and cannot grant attendance access');
        console.log('Attendance current-session access tests passed.');
    } finally {
        sqlite.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
