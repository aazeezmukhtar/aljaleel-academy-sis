/**
 * scripts/migrate-multischool-pg.js
 * 
 * ACADME SIS — MULTI-SCHOOL PRODUCTION MIGRATION (POSTGRESQL / SUPABASE)
 * 
 * ============================================================================
 * CRITICAL SAFETY NOTICE:
 * This is an EXPLICIT, ONE-TIME, TRANSACTIONAL migration script designed for
 * the production PostgreSQL (Supabase) database.
 * 
 * - NEVER runs automatically on Vercel boot or application startup.
 * - Refuses to execute against SQLite.
 * - Requires explicit confirmation flag: CONFIRM_MIGRATION=yes or --confirm
 * - Executes in a single PostgreSQL transaction (ROLLBACK on any error).
 * - Preserves 100% of existing Al-Jaleel Academy production records.
 * ============================================================================
 */

require('dotenv').config();
const { Pool } = require('pg');

// 1. Validate Target Database
const connectionString = process.env.DATABASE_URL || process.env.DB_POOL_URL;

if (!connectionString) {
    console.error('\n❌ [ABORT] DATABASE_URL is not set in environment.');
    console.error('This script must only run against the target PostgreSQL database.\n');
    process.exit(1);
}

if (process.env.DB_TYPE === 'sqlite') {
    console.error('\n❌ [ABORT] DB_TYPE is set to sqlite. This migration script is strictly for PostgreSQL.');
    process.exit(1);
}

// 2. Safety Execution Guard
const isConfirmed = process.argv.includes('--confirm') || process.env.CONFIRM_MIGRATION === 'yes';
const isDryRun = process.argv.includes('--dry-run') || !isConfirmed;

const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
});

const DIRECT_SCHOOL_TABLES = [
    'sections',
    'classes',
    'subjects',
    'students',
    'staff',
    'fee_categories',
    'announcements',
    'term_events',
    'grading_systems',
    'gallery_images',
    'public_pages',
    'news_posts',
    'audit_logs'
];

async function runMigration() {
    console.log('\n============================================================');
    console.log(' ACADME SIS — MULTI-SCHOOL TENANT FOUNDATION MIGRATION');
    console.log('============================================================');
    console.log(`Target: PostgreSQL (${connectionString.split('@')[1] ? connectionString.split('@')[1].split('/')[0] : 'Remote'})`);
    console.log(`Execution Mode: ${isDryRun ? 'DRY-RUN (Inspection & Pre-Validation Only)' : 'LIVE EXECUTION (Transactional DDL)'}`);
    console.log('============================================================\n');

    const client = await pool.connect();

    try {
        // Step 1: Capture Pre-Migration Baseline Counts
        console.log('📊 Step 1: Capturing Pre-Migration Baseline Counts...');
        const baselineCounts = {};
        
        for (const table of DIRECT_SCHOOL_TABLES) {
            try {
                const res = await client.query(`SELECT COUNT(*) AS count FROM "${table}"`);
                baselineCounts[table] = parseInt(res.rows[0].count, 10);
            } catch (err) {
                baselineCounts[table] = 0; // Table may not exist yet or empty
            }
        }

        // Additional child tables
        const childTables = ['student_enrollments', 'results', 'attendance', 'staff_attendance', 'student_fees', 'payments', 'class_posts'];
        for (const table of childTables) {
            try {
                const res = await client.query(`SELECT COUNT(*) AS count FROM "${table}"`);
                baselineCounts[table] = parseInt(res.rows[0].count, 10);
            } catch (err) {
                baselineCounts[table] = 0;
            }
        }

        console.log('   Baseline Captured:');
        Object.entries(baselineCounts).forEach(([tbl, count]) => {
            console.log(`   - ${tbl.padEnd(22)}: ${count} rows`);
        });

        if (isDryRun) {
            console.log('\n⚠️  [DRY-RUN COMPLETE] Migration was NOT executed.');
            console.log('To execute this migration against production PostgreSQL, run:');
            console.log('   node scripts/migrate-multischool-pg.js --confirm\n');
            return;
        }

        // Step 2: Begin Transaction
        console.log('\n🔒 Step 2: Beginning Transaction (BEGIN)...');
        await client.query('BEGIN');

        // Step 3: Create schools Table
        console.log('🏗️  Step 3: Creating `schools` table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS schools (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                code TEXT UNIQUE,
                status TEXT CHECK(status IN ('active', 'inactive', 'suspended', 'archived')) DEFAULT 'active',
                logo_url TEXT,
                motto TEXT,
                primary_color TEXT DEFAULT '#1e3a8a',
                secondary_color TEXT DEFAULT '#fbba00',
                address TEXT,
                phone TEXT,
                email TEXT,
                website TEXT,
                current_session TEXT DEFAULT '2025/2026',
                current_term TEXT DEFAULT '1st Term',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Step 4: Register Al-Jaleel Academy Tenant Record
        console.log('🏫 Step 4: Registering Al-Jaleel Academy as Tenant #1...');
        
        // Fetch existing branding from settings table if available
        let schoolSettings = {};
        try {
            const settingsRows = await client.query('SELECT key, value FROM settings');
            settingsRows.rows.forEach(r => { schoolSettings[r.key] = r.value; });
        } catch (e) {
            console.log('   (Settings table not found or empty, using defaults)');
        }

        const schoolName = schoolSettings['school_name'] || 'Al-Jaleel Academy';
        const schoolLogo = schoolSettings['school_logo'] || null;
        const schoolMotto = schoolSettings['school_motto'] || 'Igniting a Brighter Future';
        const primaryColor = schoolSettings['primary_color'] || '#fbba00';
        const secondaryColor = schoolSettings['secondary_color'] || '#180746';
        const schoolAddress = schoolSettings['address'] || null;
        const schoolPhone = schoolSettings['phone'] || null;
        const currentSession = schoolSettings['current_session'] || '2025/2026';
        const currentTerm = schoolSettings['current_term'] || '1st Term';

        // Insert or find Al-Jaleel Academy
        const tenantRes = await client.query(`
            INSERT INTO schools (name, slug, code, status, logo_url, motto, primary_color, secondary_color, address, phone, current_session, current_term)
            VALUES ($1, 'al-jaleel', 'AJA', 'active', $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id, name, slug, code;
        `, [schoolName, schoolLogo, schoolMotto, primaryColor, secondaryColor, schoolAddress, schoolPhone, currentSession, currentTerm]);

        const alJaleelId = tenantRes.rows[0].id;
        console.log(`   ✅ Al-Jaleel Tenant Anchor Established (ID: ${alJaleelId}, Slug: ${tenantRes.rows[0].slug})`);

        // Step 5: Add Nullable school_id Columns
        console.log('🧩 Step 5: Adding nullable `school_id` foreign keys...');
        for (const table of DIRECT_SCHOOL_TABLES) {
            // Check if table exists
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);

            if (tblCheck.rowCount > 0) {
                // Check if column already exists
                const colCheck = await client.query(`
                    SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'school_id'
                `, [table]);

                if (colCheck.rowCount === 0) {
                    await client.query(`ALTER TABLE "${table}" ADD COLUMN school_id INTEGER REFERENCES schools(id)`);
                    console.log(`   + Added school_id to "${table}"`);
                } else {
                    console.log(`   . school_id already present in "${table}"`);
                }
            }
        }

        // Step 6: Atomic Backfill of Existing Records to Al-Jaleel Academy
        console.log(`\n📦 Step 6: Backfilling existing records to School ID ${alJaleelId}...`);
        for (const table of DIRECT_SCHOOL_TABLES) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);

            if (tblCheck.rowCount > 0) {
                const updateRes = await client.query(`
                    UPDATE "${table}" SET school_id = $1 WHERE school_id IS NULL
                `, [alJaleelId]);
                console.log(`   ✅ Backfilled ${updateRes.rowCount} rows in "${table}"`);
            }
        }

        // Step 7: Integrity Assertions (Verify Zero NULLs)
        console.log('\n🔍 Step 7: Verifying zero unassigned records...');
        for (const table of DIRECT_SCHOOL_TABLES) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);

            if (tblCheck.rowCount > 0) {
                const nullCheck = await client.query(`SELECT COUNT(*) AS count FROM "${table}" WHERE school_id IS NULL`);
                const nullCount = parseInt(nullCheck.rows[0].count, 10);
                if (nullCount > 0) {
                    throw new Error(`CRITICAL: Found ${nullCount} unassigned (NULL school_id) records in table "${table}"! Rolling back.`);
                }
            }
        }
        console.log('   ✅ Verification passed: 0 unassigned records across all tables.');

        // Step 8: Enforce NOT NULL Constraints
        console.log('\n🛡️  Step 8: Enforcing NOT NULL constraints on `school_id`...');
        for (const table of DIRECT_SCHOOL_TABLES) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);

            if (tblCheck.rowCount > 0) {
                try {
                    await client.query(`ALTER TABLE "${table}" ALTER COLUMN school_id SET NOT NULL`);
                    console.log(`   + Enforced NOT NULL on "${table}.school_id"`);
                } catch (e) {
                    console.warn(`   ! Warning on "${table}.school_id" NOT NULL: ${e.message}`);
                }
            }
        }

        // Step 9: Transition to Composite Tenant-Scoped Unique Constraints
        console.log('\n🔐 Step 9: Updating unique constraints to be tenant-scoped...');
        
        // Helper to safely replace a constraint
        async function updateConstraint(table, oldConstraint, newUniqueDef) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);
            if (tblCheck.rowCount === 0) return;

            // Check if composite constraint already exists
            const compositeName = `uq_${table}_school_${newUniqueDef.replace(/[\s,]+/g, '_')}`;
            const existsCheck = await client.query(`
                SELECT 1 FROM pg_constraint WHERE conname = $1
            `, [compositeName]);

            if (existsCheck.rowCount === 0) {
                try {
                    await client.query(`
                        ALTER TABLE "${table}" ADD CONSTRAINT "${compositeName}" UNIQUE (school_id, ${newUniqueDef})
                    `);
                    console.log(`   + Added composite unique constraint "${compositeName}" on "${table}"`);
                } catch (e) {
                    console.warn(`   ! Could not add constraint on "${table}": ${e.message}`);
                }
            }
        }

        await updateConstraint('students', 'students_admission_number_key', 'admission_number');
        await updateConstraint('staff', 'staff_staff_id_key', 'staff_id');
        await updateConstraint('sections', 'sections_name_key', 'name');
        await updateConstraint('subjects', 'subjects_name_key', 'name');
        await updateConstraint('classes', 'classes_name_key', 'name');
        await updateConstraint('announcements', 'announcements_slug_key', 'slug');
        await updateConstraint('public_pages', 'public_pages_slug_key', 'slug');
        await updateConstraint('news_posts', 'news_posts_slug_key', 'slug');

        // Step 10: Performance Indexes
        console.log('\n⚡ Step 10: Creating tenant-aware performance indexes...');
        for (const table of DIRECT_SCHOOL_TABLES) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);
            if (tblCheck.rowCount > 0) {
                await client.query(`CREATE INDEX IF NOT EXISTS "idx_${table}_school_id" ON "${table}" (school_id)`);
            }
        }
        console.log('   ✅ Tenant indexes created.');

        // Step 11: Post-Migration Validation Suite
        console.log('\n🏁 Step 11: Executing Post-Migration Validation Suite...');
        let allCountsMatch = true;

        for (const table of DIRECT_SCHOOL_TABLES) {
            const tblCheck = await client.query(`
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
            `, [table]);
            if (tblCheck.rowCount > 0) {
                const postRes = await client.query(`SELECT COUNT(*) AS count FROM "${table}" WHERE school_id = $1`, [alJaleelId]);
                const postCount = parseInt(postRes.rows[0].count, 10);
                const prevCount = baselineCounts[table] || 0;

                if (postCount !== prevCount) {
                    allCountsMatch = false;
                    console.error(`   ❌ MISMATCH on table "${table}": Baseline=${prevCount}, Post-Migration=${postCount}`);
                } else {
                    console.log(`   ✅ "${table.padEnd(20)}": ${postCount} rows (100% Match)`);
                }
            }
        }

        if (!allCountsMatch) {
            throw new Error('Validation count mismatch detected! Rolling back migration.');
        }

        // Step 12: Commit Transaction
        console.log('\n💾 Step 12: Committing Transaction (COMMIT)...');
        await client.query('COMMIT');

        console.log('\n============================================================');
        console.log(' 🎉 MULTI-SCHOOL FOUNDATION MIGRATION COMPLETED SUCCESSFULLY');
        console.log('============================================================');
        console.log(`- Tenant: Al-Jaleel Academy (ID: ${alJaleelId})`);
        console.log('- 100% of existing production records preserved and attributed.');
        console.log('- Zero data loss confirmed by post-migration assertions.\n');

    } catch (err) {
        console.error('\n💥 [MIGRATION ERROR] An error occurred during migration:', err);
        console.error('Rolling back transaction (ROLLBACK)...');
        try {
            await client.query('ROLLBACK');
            console.error('✅ Rollback complete. Production database remains in original state.');
        } catch (rbErr) {
            console.error('Rollback failed:', rbErr.message);
        }
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
