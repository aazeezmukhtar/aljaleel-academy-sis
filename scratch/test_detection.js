const path = require('path');

function testDetection(env) {
    const DB_TYPE = env.DB_TYPE || (env.DATABASE_URL ? 'postgres' : 'sqlite');
    const isVercel = env.VERCEL === '1' || env.NOW_REGION;
    
    console.log(`Input: DB_TYPE=${env.DB_TYPE}, DATABASE_URL=${env.DATABASE_URL ? 'PRESENT' : 'MISSING'}, VERCEL=${env.VERCEL}`);
    console.log(`Output: DB_TYPE=${DB_TYPE}, isVercel=${isVercel}`);
    console.log('---');
}

console.log('Testing Detection Logic:');
testDetection({ DB_TYPE: 'sqlite' });
testDetection({ DATABASE_URL: 'postgres://...' });
testDetection({ DB_TYPE: 'postgres', DATABASE_URL: 'postgres://...' });
testDetection({ VERCEL: '1' });
testDetection({ VERCEL: '1', DATABASE_URL: 'postgres://...' });
