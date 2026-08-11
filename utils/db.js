const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION;

let pool = null;
let sqliteDb = null;

console.log(`[Database] Initializing with type: ${DB_TYPE}`);

if (DB_TYPE === 'postgres') {
    const connectionString = process.env.DB_POOL_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('[Database] ERROR: DATABASE_URL is required for postgres mode.');
    } else {
        const poolMax = parseInt(process.env.DB_POOL_MAX || (isVercel ? '5' : '10'), 10);
        pool = new Pool({
            connectionString,
            ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
            max: poolMax,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 10000
        });
        pool.on('error', (err) => {
            console.error('[Database] Unexpected error on idle client:', err);
        });
        console.log(`[Database] PostgreSQL pool initialized (max: ${poolMax}).`);
    }
} else if (DB_TYPE === 'sqlite') {
    if (isVercel) {
        console.warn('[Database] WARNING: SQLite is not recommended on Vercel. Attempting to open read-only.');
    }
    
    try {
        const dbPath = path.join(__dirname, '../', process.env.DB_PATH || 'database.sqlite');
        sqliteDb = new Database(dbPath, { 
            readonly: !!isVercel,
            fileMustExist: !!isVercel
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
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            return p;
        });
        const result = await pool.query(pgSql, pgParams);
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
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            return p;
        });
        const result = await pool.query(pgSql, pgParams);
        return result.rows[0];
    } else {
        return sqliteDb.prepare(sql).get(params);
    }
}

/**
 * Executes a query (INSERT, UPDATE, DELETE).
 * @param {string} sql 
 * @param {Array} params 
 * @param {Object} [client] Optional pg client (for transactions)
 */
async function run(sql, params = [], client = null) {
    if (DB_TYPE === 'postgres') {
        let counter = 1;
        let pgSql = sql.replace(/\?/g, () => `$${counter++}`);
        pgSql = pgSql.replace(/INSERT OR IGNORE/gi, 'INSERT');
        if (sql.match(/INSERT OR IGNORE/gi)) {
            pgSql += ' ON CONFLICT DO NOTHING';
        }
        const pgParams = params.map(p => {
            if (p === undefined) return null;
            return p;
        });
        const queryExecutor = client || pool;
        const result = await queryExecutor.query(pgSql, pgParams);
        return { changes: result.rowCount, lastInsertRowid: null };
    } else {
        const info = sqliteDb.prepare(sql).run(params);
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
    }
}

/**
 * Executes a transaction.
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
        sqliteDb.prepare('BEGIN').run();
        try {
            const result = await callback();
            sqliteDb.prepare('COMMIT').run();
            return result;
        } catch (e) {
            sqliteDb.prepare('ROLLBACK').run();
            throw e;
        }
    }
}

module.exports = {
    all,
    get,
    run,
    transaction,
    DB_TYPE,
    pool
};

