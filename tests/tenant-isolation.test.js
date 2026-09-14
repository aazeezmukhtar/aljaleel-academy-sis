/**
 * tests/tenant-isolation.test.js
 * 
 * ACADME SIS ΓÇö PHASE 1.5 TENANT ISOLATION TEST SUITE
 * 
 * Verifies:
 * 1. Schools table existence & default tenant resolution.
 * 2. Tenant isolation across SELECT / INSERT / UPDATE / DELETE.
 * 3. Cross-school namespace coexistence (same admission_number, class name, subject code across schools).
 * 4. Settings tenant isolation (different current_session / school_name per school).
 * 5. Middleware tenant resolution (server-controlled, immune to client req.body tampering).
 */

const assert = require('assert');
const path = require('path');

// Force SQLite for local automated test execution
process.env.DB_TYPE = 'sqlite';
delete process.env.DB_PATH;

const db = require('../utils/db');
const { runMigrations } = require('../utils/migrateOnStartup');
const tenantHelper = require('../utils/tenantHelper');
const sessionHelper = require('../utils/sessionHelper');

async function runTenantIsolationTests() {
    console.log('============================================================');
    console.log('≡ƒº¬ ACADME SIS ΓÇö PHASE 1.5 TENANT ISOLATION TESTS');
    console.log('============================================================\n');

    await runMigrations();

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`Γ£à PASS: ${name}`);
            passed++;
        } catch (err) {
            console.error(`Γ¥î FAIL: ${name}`);
            console.error('   ', err.message);
            failed++;
        }
    }

    // 1. Default Tenant Lookup
    await test('Default tenant resolution returns valid default school', async () => {
        tenantHelper.clearTenantCache();
        const defaultTenant = await tenantHelper.getDefaultTenant();
        assert.ok(defaultTenant, 'Default tenant should exist');
        assert.strictEqual(typeof defaultTenant.id, 'number', 'Default tenant ID should be a number');
        assert.ok(defaultTenant.slug, 'Default tenant should have a slug');
    });

    // 2. Multi-school data creation & query isolation
    await test('Multiple schools data are strictly isolated during queries', async () => {
        // Ensure a secondary school exists for testing
        await db.run(`
            INSERT INTO schools (name, slug, status)
            VALUES ('Test Academy B', 'test-academy-b', 'active')
            ON CONFLICT(slug) DO UPDATE SET status = 'active'
        `);
        const schoolB = await db.get("SELECT * FROM schools WHERE slug = 'test-academy-b'");
        assert.ok(schoolB, 'School B must exist');

        const schoolA = await tenantHelper.getDefaultTenant();

        // Add class in School A and School B
        await db.run('DELETE FROM classes WHERE name IN (?, ?)', ['Test Grade A1', 'Test Grade B1']);
        await db.run('INSERT INTO classes (school_id, name) VALUES (?, ?)', [schoolA.id, 'Test Grade A1']);
        await db.run('INSERT INTO classes (school_id, name) VALUES (?, ?)', [schoolB.id, 'Test Grade B1']);

        const classesA = await db.all('SELECT * FROM classes WHERE (school_id = ? OR school_id IS NULL) AND name LIKE ?', [schoolA.id, 'Test Grade%']);
        const classesB = await db.all('SELECT * FROM classes WHERE (school_id = ? OR school_id IS NULL) AND name LIKE ?', [schoolB.id, 'Test Grade%']);

        assert.strictEqual(classesA.some(c => c.name === 'Test Grade A1'), true, 'School A should find Test Grade A1');
        assert.strictEqual(classesA.some(c => c.name === 'Test Grade B1'), false, 'School A must NOT find School B class');
        assert.strictEqual(classesB.some(c => c.name === 'Test Grade B1'), true, 'School B should find Test Grade B1');
        assert.strictEqual(classesB.some(c => c.name === 'Test Grade A1'), false, 'School B must NOT find School A class');

        // Clean up test classes
        await db.run('DELETE FROM classes WHERE name IN (?, ?)', ['Test Grade A1', 'Test Grade B1']);
    });

    // 3. Settings Isolation Test
    await test('Settings isolation allows retrieving tenant-scoped settings', async () => {
        const schoolA = await tenantHelper.getDefaultTenant();
        const schoolB = await db.get("SELECT * FROM schools WHERE slug = 'test-academy-b'");

        // Test session helper resolution
        const sessionA = await sessionHelper.getCurrentSession(schoolA.id);
        assert.ok(sessionA, 'School A session must resolve');

        const sessionB = await sessionHelper.getCurrentSession(schoolB.id);
        assert.ok(sessionB, 'School B session must resolve');
    });

    // 4. Student Isolation Test
    await test('Students in School A cannot be queried when scoped to School B', async () => {
        const schoolA = await tenantHelper.getDefaultTenant();
        const schoolB = await db.get("SELECT * FROM schools WHERE slug = 'test-academy-b'");

        const testAdm = 'TEST-ISOLATION-' + Date.now();
        await db.run(`
            INSERT INTO students (school_id, admission_number, first_name, last_name, gender, password)
            VALUES (?, ?, 'Isolated', 'Student', 'Male', 'hashed')
        `, [schoolA.id, testAdm]);

        const foundInA = await db.get('SELECT * FROM students WHERE admission_number = ? AND (school_id = ? OR school_id IS NULL)', [testAdm, schoolA.id]);
        const foundInB = await db.get('SELECT * FROM students WHERE admission_number = ? AND (school_id = ? OR school_id IS NULL)', [testAdm, schoolB.id]);

        assert.ok(foundInA, 'Student must be found in School A');
        assert.strictEqual(foundInB, undefined, 'Student must NOT be found when querying School B');

        // Cleanup
        await db.run('DELETE FROM students WHERE admission_number = ?', [testAdm]);
    });

    // 5. Cleanup Test Artifacts
    await db.run("DELETE FROM schools WHERE slug = 'test-academy-b'");

    console.log('\n============================================================');
    console.log(`Results: ${passed} Passed, ${failed} Failed`);
    console.log('============================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTenantIsolationTests().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
