const db = require('../utils/db');

const getAcademicSettings = async (class_id) => {
    if (class_id) {
        const sec = await db.get(
            `SELECT s.current_session, s.current_term FROM sections s JOIN classes c ON c.section_id = s.id WHERE c.id = ?`,
            [class_id]
        );
        if (sec && sec.current_session && sec.current_term) {
            return { session: sec.current_session, term: sec.current_term };
        }
    }
    const school = await db.all('SELECT key, value FROM settings');
    const settings = {};
    school.forEach(s => { settings[s.key] = s.value; });
    return {
        session: settings.current_session || '2024/2025',
        term: settings.current_term || '1st Term'
    };
};

async function main() {
    try {
        const classes = await db.all('SELECT * FROM classes ORDER BY name ASC');
        console.log('Classes count:', classes.length);

        const limitRow = await db.get(`SELECT value FROM settings WHERE key = 'attendance.term_absence_limit'`);
        console.log('limitRow:', limitRow);
        const termAbsenceLimit = Number(limitRow ? limitRow.value : 10);
        console.log('termAbsenceLimit:', termAbsenceLimit);

        const flaggedStudents = {};
        for (const cls of classes) {
            const s = await getAcademicSettings(cls.id);
            const flagged = await db.all(
                `SELECT s.id, s.first_name, s.last_name,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_days
                FROM attendance a
                JOIN students s ON a.student_id = s.id
                WHERE a.class_id = ? AND a.term = ? AND a.session = ?
                GROUP BY s.id
                HAVING absent_days >= ?`,
                [cls.id, s.term, s.session, termAbsenceLimit]
            );
            if (flagged.length > 0) {
                flaggedStudents[cls.id] = { class: cls, students: flagged };
                console.log(`Class ${cls.name} (id=${cls.id}): ${flagged.length} flagged students`);
            }
        }
        console.log('\nSUCCESS. Total flagged class groups:', Object.keys(flaggedStudents).length);
    } catch (e) {
        console.error('ERROR:', e.message);
        console.error(e.stack);
    }
    process.exit(0);
}

main();
