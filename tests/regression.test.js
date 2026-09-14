const { execSync } = require('child_process');
const path = require('path');

const testFiles = [
  'tenant-isolation.test.js',
  'phase2-auth-security.test.js',
  'phase2.1-security-audit.test.js',
  'phase3-session-tenant.test.js'
];

let passed = 0;
let failed = 0;

console.log('=== Running Regression Test Suite ===');

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  try {
    execSync(`node "${filePath}"`, { stdio: 'inherit' });
    console.log(`✅ ${file} passed`);
    passed++;
  } catch (e) {
    console.error(`❌ ${file} failed`);
    failed++;
  }
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
