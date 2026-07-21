const { Pool } = require('pg');
<<<<<<< HEAD
=======
const Database = require('better-sqlite3');
>>>>>>> local-master
const path = require('path');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
<<<<<<< HEAD
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION;

let pool = null;
let sqliteDb = null;

console.log(`[Database] Initializing with type: ${DB_TYPE}`);

if (DB_TYPE === 'postgres') {
    if (!process.env.DATABASE_URL) {
        console.error('[Database] ERROR: DATABASE_URL is required for postgres mode.');
    } else {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
                rejectUnauthorized: false
            }
        });
        console.log('[Database] PostgreSQL pool initialized.');
    }
} else if (DB_TYPE === 'sqlite') {
    if (isVercel) {
        console.warn('[Database] WARNING: SQLite is not recommended on Vercel. Attempting to open read-only.');
    }
    
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(__dirname, '../', process.env.DB_PATH || 'database.sqlite');
        sqliteDb = new Database(dbPath, { 
            readonly: isVercel, // Try read-only on Vercel
            fileMustExist: isVercel // On Vercel, don't try to create it
        });
        console.log(`[Database] SQLite initialized at: ${dbPath}`);
    } catch (err) {
        console.error('[Database] Failed to initialize SQLite:', err.message);
        if (isVercel) {
            console.error('[Database] CRITICAL: Database file missing or inaccessible on Vercel. Please set DB_TYPE=postgres and provide DATABASE_URL.');
        }
    }
=======
let pool = null;
let sqliteDb = null;

console.log(`[DB] Using ${DB_TYPE} mode`);

if (DB_TYPE === 'postgres') {
    const connectionString = process.env.DB_POOL_URL || process.env.DATABASE_URL;
    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 200, // Supabase paid tier supports up to 200 connections
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
} else {
    sqliteDb = new Database(path.join(__dirname, '../', process.env.DB_PATH || 'database.sqlite'));
>>>>>>> local-master
}

/**
 * Executes a query and returns all rows.
 * @param {string} sql 
 * @param {Array} params 
 */
async function all(sql, params = []) {
    if (DB_TYPE === 'postgres') {
<<<<<<< HEAD
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
=======
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        // Handle boolean 1/0 for Postgres
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            if (typeof p === 'boolean') return p;
            if (p === 1 || p === 0) {
                // If it's a numeric boolean (common in this app), keep it as is if the column is INTEGER, 
                // but usually Postgres columns in this app are defined as INTEGER for booleans.
                // However, some might be true/false. Let's be safe.
                return p;
            }
            return p;
        });
        const result = await pool.query(pgSql, pgParams);
>>>>>>> local-master
        return result.rows;
    } else {
        return sqliteDb.prepare(sql).all(params);
    }
}

/**
 * Executes a query and returns the first row.
 * @param {string} sql 
 * @param {Array} params 
 */
async function get(sql, params = []) {
    if (DB_TYPE === 'postgres') {
<<<<<<< HEAD
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
=======
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            if (typeof p === 'boolean') return p;
            if (p === 1 || p === 0) {
                // If it's a numeric boolean (common in this app), keep it as is if the column is INTEGER, 
                // but usually Postgres columns in this app are defined as INTEGER for booleans.
                // However, some might be true/false. Let's be safe.
                return p;
            }
            return p;
        });
        const result = await pool.query(pgSql, pgParams);
>>>>>>> local-master
        return result.rows[0];
    } else {
        return sqliteDb.prepare(sql).get(params);
    }
}

/**
 * Executes a query (INSERT, UPDATE, DELETE).
 * @param {string} sql 
 * @param {Array} params 
 */
async function run(sql, params = []) {
    if (DB_TYPE === 'postgres') {
<<<<<<< HEAD
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
        return { changes: result.rowCount, lastInsertRowid: null }; 
=======
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            // We need to know which columns are unique to use ON CONFLICT properly if it's not a generic IGNORE
            // But usually for simple INSERT OR IGNORE, we can't easily guess the constraint name.
            // However, Postgres 9.5+ supports ON CONFLICT DO NOTHING without specifying the column if we use it on a specific constraint.
            // Actually, ON CONFLICT DO NOTHING without target is NOT supported in all cases.
            // But for simple "IGNORE" it often works.
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            if (typeof p === 'boolean') return p;
            if (p === 1 || p === 0) return p;
            return p;
        });
        const result = await pool.query(pgSql, pgParams);
        return { changes: result.rowCount, lastInsertRowid: null };
>>>>>>> local-master
    } else {
        const info = sqliteDb.prepare(sql).run(params);
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }
}

/**
 * Executes a transaction.
 * For SQLite, it uses the built-in transaction method.
 * For PostgreSQL, it uses BEGIN/COMMIT.
 */
async function transaction(callback) {
    if (DB_TYPE === 'postgres') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } else {
<<<<<<< HEAD
        const tx = sqliteDb.transaction(callback);
        return tx();
=======
        // For SQLite, if the callback is async, we cannot use sqliteDb.transaction(callback)
        // because better-sqlite3 transactions must be synchronous.
        // Instead, we manually run BEGIN/COMMIT/ROLLBACK.
        sqliteDb.prepare('BEGIN').run();
        try {
            const result = await callback();
            sqliteDb.prepare('COMMIT').run();
            return result;
        } catch (e) {
            sqliteDb.prepare('ROLLBACK').run();
            throw e;
        }
>>>>>>> local-master
    }
}

module.exports = {
    all,
    get,
    run,
    transaction,
    DB_TYPE
};
