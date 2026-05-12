const db = require('./utils/db');

async function migrate() {
    console.log('Starting Section Terms Migration...');
    try {
        // Add current_session and current_term to sections table
        try {
            await db.run("ALTER TABLE sections ADD COLUMN current_session TEXT");
            console.log("Added current_session to sections.");
        } catch(e) {
            if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
                console.error("sections current_session error:", e.message);
            } else {
                console.log("current_session already exists on sections.");
            }
        }

        try {
            await db.run("ALTER TABLE sections ADD COLUMN current_term TEXT");
            console.log("Added current_term to sections.");
        } catch(e) {
            if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
                console.error("sections current_term error:", e.message);
            } else {
                console.log("current_term already exists on sections.");
            }
        }

        // Seed with current global settings
        const sessionRow = await db.get("SELECT value FROM settings WHERE key = 'current_session'");
        const termRow = await db.get("SELECT value FROM settings WHERE key = 'current_term'");
        const currentSession = sessionRow ? sessionRow.value : '2024/2025';
        const currentTerm = termRow ? termRow.value : '1st Term';

        await db.run(
            "UPDATE sections SET current_session = ?, current_term = ? WHERE current_session IS NULL",
            [currentSession, currentTerm]
        );
        console.log(`Seeded sections with session: ${currentSession}, term: ${currentTerm}`);

        console.log('Migration completed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

migrate();
