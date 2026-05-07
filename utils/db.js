const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
let pool = null;
let sqliteDb = null;

if (DB_TYPE === 'postgres') {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
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
        const result = await pool.query(sql.replace(/\?/g, (val, i) => `$${i + 1}`), params);
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
        const result = await pool.query(sql.replace(/\?/g, (val, i) => `$${i + 1}`), params);
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
        const result = await pool.query(sql.replace(/\?/g, (val, i) => `$${i + 1}`), params);
        return { changes: result.rowCount, lastInsertRowid: null }; // rowCount is equivalent to changes
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
