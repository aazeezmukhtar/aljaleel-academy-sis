const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
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
}

/**
 * Executes a query and returns all rows.
 * @param {string} sql 
 * @param {Array} params 
 */
async function all(sql, params = []) {
    if (DB_TYPE === 'postgres') {
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
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
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
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
        let count = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++count}`);
        const result = await pool.query(pgSql, params);
        return { changes: result.rowCount, lastInsertRowid: null }; 
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
        const tx = sqliteDb.transaction(callback);
        return tx();
    }
}

module.exports = {
    all,
    get,
    run,
    transaction,
    DB_TYPE
};
