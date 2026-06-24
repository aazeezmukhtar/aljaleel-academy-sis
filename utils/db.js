const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite');
let pool = null;
let sqliteDb = null;

console.log(`[DB] Using ${DB_TYPE} mode`);

if (DB_TYPE === 'postgres') {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        },
        max: 4,              // reduced to 4 to handle Supabase limits (15) across multiple Vercel instances
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000
    });
} else {
    sqliteDb = new Database(path.join(__dirname, '../', process.env.DB_PATH || 'database.sqlite'));
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
