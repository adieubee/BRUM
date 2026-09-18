const mysql = require('mysql2/promise');

let pool;
let emailColumnReady;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'root',
            database: 'brums',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
    return pool;
}

async function ensureEmailColumn() {
    if (!emailColumnReady) {
        emailColumnReady = getPool().query(
            'ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL AFTER username'
        );
    }

    await emailColumnReady;
}

module.exports = { getPool, ensureEmailColumn };
