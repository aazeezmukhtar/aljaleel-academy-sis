const { getEnrolledStudents } = require('./utils/enrollmentHelper');
const db = require('./utils/db');

async function test() {
    console.log("Testing enrollments...");
    const classes = await db.all('SELECT * FROM classes LIMIT 1');
    if (classes.length === 0) {
        console.log("No classes found");
        return;
    }
    const classId = classes[0].id;
    console.log("Class ID:", classId, "Name:", classes[0].name);
    
    const settings = await db.all('SELECT key, value FROM settings');
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    const session = settingsMap.current_session || '2025/2026';
    console.log("Session:", session);

    const students = await getEnrolledStudents(classId, session);
    console.log("Students found:", students.length);
    console.log("Students array:", students);
}
test().catch(console.error);
