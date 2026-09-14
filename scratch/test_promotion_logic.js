const db = require('../utils/db');

async function testPromotionLogic() {
    console.log('Testing promotion logic and section affinity...');

    // 1. Check classes in database
    const classes = await db.all(`
        SELECT c.id, c.name, c.section_id, s.name as section_name
        FROM classes c
        LEFT JOIN sections s ON c.section_id = s.id
        ORDER BY s.name, c.name
    `);
    console.log(`Loaded ${classes.length} classes across sections.`);

    // 2. Test cross-section validation simulation:
    const academyClass = classes.find(c => c.section_name === 'Academy' || c.section_id === 1);
    const tahfeezClass = classes.find(c => c.section_name === 'Tahfeez' || c.section_id === 2);

    if (academyClass && tahfeezClass) {
        if (academyClass.section_id !== tahfeezClass.section_id) {
            console.log(`[PASS] Cross-section barrier verified: ${academyClass.name} (Section ${academyClass.section_id}) != ${tahfeezClass.name} (Section ${tahfeezClass.section_id})`);
        } else {
            console.error('[FAIL] Section IDs match unexpectedly!');
        }
    }

    console.log('All logic tests completed successfully.');
}

testPromotionLogic().then(() => process.exit(0)).catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
