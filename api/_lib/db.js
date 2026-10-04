const mysql = require('mysql2/promise');

let pool;
let schemaPromise;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.MYSQL_HOST || 'localhost',
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || 'root',
            database: process.env.MYSQL_DATABASE || 'brums',
            port: parseInt(process.env.MYSQL_PORT || '3306', 10),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined
        });
    }
    return pool;
}

async function getColumns(tableName) {
    const db = getPool();
    const [rows] = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return rows;
}

async function addColumnIfMissing(tableName, columnName, definition) {
    const db = getPool();
    const columns = await getColumns(tableName);
    if (!columns.some(col => col.Field === columnName)) {
        await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    }
}

async function runSchemaChecks() {
    const db = getPool();

    // users.email is optional for staff/walk-in records, but required by client registration.
    const userColumns = await getColumns('users');
    const emailColumn = userColumns.find(col => col.Field === 'email');
    if (!emailColumn) {
        await db.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username');
        await db.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
    } else if (String(emailColumn.Null).toUpperCase() === 'NO') {
        await db.query('ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL');
    }

    // Repair the original inventory typo (`quantitiy`) without requiring a fresh import.
    const inventoryColumns = await getColumns('inventory');
    const hasQuantity = inventoryColumns.some(col => col.Field === 'quantity');
    const hasTypoQuantity = inventoryColumns.some(col => col.Field === 'quantitiy');
    if (!hasQuantity && hasTypoQuantity) {
        await db.query('ALTER TABLE inventory CHANGE COLUMN quantitiy quantity INT NOT NULL DEFAULT 0');
    } else if (!hasQuantity && !hasTypoQuantity) {
        await db.query('ALTER TABLE inventory ADD COLUMN quantity INT NOT NULL DEFAULT 0 AFTER price');
    }

    // Fields used by booking/POS flows.
    await addColumnIfMissing('appointments', 'dp_paid', "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER message");
    await addColumnIfMissing('appointments', 'warts_dp', "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER dp_paid");
    await addColumnIfMissing('appointments', 'non_warts_price', "DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER warts_dp");
    await addColumnIfMissing('appointments', 'reschedule_requested_at', 'TIMESTAMP NULL DEFAULT NULL AFTER non_warts_price');

    // Booking history keeps a chronological log for appointment lifecycle events.
    await db.query(`
        CREATE TABLE IF NOT EXISTS booking_history (
            history_id INT NOT NULL AUTO_INCREMENT,
            appointment_id INT NOT NULL,
            action VARCHAR(50) NOT NULL,
            previous_status VARCHAR(45) NULL,
            new_status VARCHAR(45) NULL,
            changed_by INT NULL,
            details TEXT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (history_id),
            KEY idx_booking_history_appointment (appointment_id),
            KEY idx_booking_history_changed_by (changed_by),
            KEY idx_booking_history_created_at (created_at),
            CONSTRAINT fk_booking_history_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id) ON DELETE CASCADE,
            CONSTRAINT fk_booking_history_user FOREIGN KEY (changed_by) REFERENCES users (user_id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumnIfMissing('booking_history', 'action', "VARCHAR(50) NOT NULL DEFAULT 'updated' AFTER appointment_id");
    await addColumnIfMissing('booking_history', 'previous_status', 'VARCHAR(45) NULL AFTER action');
    await addColumnIfMissing('booking_history', 'new_status', 'VARCHAR(45) NULL AFTER previous_status');
    await addColumnIfMissing('booking_history', 'changed_by', 'INT NULL AFTER new_status');
    await addColumnIfMissing('booking_history', 'details', 'TEXT NULL AFTER changed_by');
    await addColumnIfMissing('booking_history', 'created_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER details');

    // Finance is required by POS, Reports, and Commissions.
    await db.query(`
        CREATE TABLE IF NOT EXISTS finance (
            transaction_id INT NOT NULL AUTO_INCREMENT,
            appointment_id INT NULL,
            branch_id INT NULL,
            staff_id INT NULL,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            amount_due DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            cash_received DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            change_due DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            products_bought LONGTEXT NULL,
            payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash',
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (transaction_id),
            KEY idx_finance_appointment (appointment_id),
            KEY idx_finance_branch (branch_id),
            KEY idx_finance_staff (staff_id),
            CONSTRAINT fk_finance_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id) ON DELETE SET NULL,
            CONSTRAINT fk_finance_branch FOREIGN KEY (branch_id) REFERENCES branches (branch_id) ON DELETE SET NULL,
            CONSTRAINT fk_finance_staff_user FOREIGN KEY (staff_id) REFERENCES users (user_id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Support users who already have an older finance table.
    await addColumnIfMissing('finance', 'branch_id', 'INT NULL AFTER appointment_id');
    await addColumnIfMissing('finance', 'staff_id', 'INT NULL AFTER branch_id');
    await addColumnIfMissing('finance', 'amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER staff_id');
    await addColumnIfMissing('finance', 'amount_due', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER amount');
    await addColumnIfMissing('finance', 'cash_received', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER amount_due');
    await addColumnIfMissing('finance', 'change_due', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER cash_received');
    await addColumnIfMissing('finance', 'products_bought', 'LONGTEXT NULL AFTER change_due');
    await addColumnIfMissing('finance', 'payment_method', "VARCHAR(50) NOT NULL DEFAULT 'Cash' AFTER products_bought");
    await addColumnIfMissing('finance', 'created_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER payment_method');
}

async function ensureSchema() {
    if (!schemaPromise) {
        schemaPromise = runSchemaChecks().catch(err => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
}

// Backward-compatible name used by earlier code.
async function ensureEmailColumn() {
    return ensureSchema();
}

module.exports = { getPool, ensureSchema, ensureEmailColumn };
