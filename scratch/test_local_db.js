const db = require('../utils/db');

async function test() {
    try {
        console.log('Testing DB connection...');
        const result = await db.all('SELECT 1 as test');
        console.log('Result:', result);
        console.log('Success!');
        process.exit(0);
    } catch (err) {
        console.error('Test Failed:', err);
        process.exit(1);
    }
}

test();
