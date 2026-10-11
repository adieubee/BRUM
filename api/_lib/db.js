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

    await addColumnIfMissing('staff', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER specialization');

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
            staff_user_id INT NULL,
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
            KEY idx_finance_staff (staff_user_id),
            CONSTRAINT fk_finance_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id) ON DELETE SET NULL,
            CONSTRAINT fk_finance_branch FOREIGN KEY (branch_id) REFERENCES branches (branch_id) ON DELETE SET NULL,
            CONSTRAINT fk_finance_staff_user FOREIGN KEY (staff_user_id) REFERENCES users (user_id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Support users who already have an older finance table.
    await addColumnIfMissing('finance', 'branch_id', 'INT NULL AFTER appointment_id');
    const finColumns = await getColumns('finance');
    if (finColumns.some(col => col.Field === 'staff_id') && !finColumns.some(col => col.Field === 'staff_user_id')) {
        await db.query('ALTER TABLE finance CHANGE COLUMN staff_id staff_user_id INT NULL');
    }
    await addColumnIfMissing('finance', 'staff_user_id', 'INT NULL AFTER branch_id');
    await addColumnIfMissing('finance', 'amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER staff_user_id');
    await addColumnIfMissing('finance', 'amount_due', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER amount');
    await addColumnIfMissing('finance', 'cash_received', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER amount_due');
    await addColumnIfMissing('finance', 'change_due', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER cash_received');
    await addColumnIfMissing('finance', 'products_bought', 'LONGTEXT NULL AFTER change_due');
    await addColumnIfMissing('finance', 'payment_method', "VARCHAR(50) NOT NULL DEFAULT 'Cash' AFTER products_bought");
    await addColumnIfMissing('finance', 'created_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER payment_method');
    // Normalize the three account types while keeping users as the shared authentication identity.
    // Existing 'owner' values are migrated without losing the original account IDs.
    const roleColumn = (await getColumns('users')).find(c => c.Field === 'role');
    if (roleColumn && roleColumn.Type !== "enum('admin','staff','client')") {
        await db.query("ALTER TABLE users MODIFY COLUMN role ENUM('owner','admin','staff','client') NOT NULL DEFAULT 'client'");
        await db.query("UPDATE users SET role = 'admin' WHERE role = 'owner'");
        await db.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin','staff','client') NOT NULL DEFAULT 'client'");
    }
    await db.query(`CREATE TABLE IF NOT EXISTS clients (
        user_id INT PRIMARY KEY, preferred_branch_id INT NULL,
        CONSTRAINT fk_clients_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        CONSTRAINT fk_clients_branch FOREIGN KEY (preferred_branch_id) REFERENCES branches(branch_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS admins (
        user_id INT PRIMARY KEY,
        CONSTRAINT fk_admins_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query("INSERT IGNORE INTO clients (user_id) SELECT user_id FROM users WHERE role='client'");
    await db.query("INSERT IGNORE INTO admins (user_id) SELECT user_id FROM users WHERE role='admin'");
    await db.query("DELETE c FROM clients c JOIN users u ON c.user_id=u.user_id WHERE u.role <> 'client'");
    await db.query("DELETE a FROM admins a JOIN users u ON a.user_id=u.user_id WHERE u.role <> 'admin'");

    // Explicit many-to-many links: services available at branches, resources used by services,
    // and the selected services for each appointment (legacy service_ids stays for compatibility).
    await db.query(`CREATE TABLE IF NOT EXISTS branch_services (
        branch_id INT NOT NULL, service_id INT NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY(branch_id,service_id),
        FOREIGN KEY(branch_id) REFERENCES branches(branch_id) ON DELETE CASCADE,
        FOREIGN KEY(service_id) REFERENCES services(service_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS service_inventory (
        service_id INT NOT NULL, inventory_id INT NOT NULL, quantity_used DECIMAL(10,3) NOT NULL DEFAULT 1.000,
        PRIMARY KEY(service_id,inventory_id),
        FOREIGN KEY(service_id) REFERENCES services(service_id) ON DELETE CASCADE,
        FOREIGN KEY(inventory_id) REFERENCES inventory(inventory_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    const [[branchServiceCount]] = await db.query('SELECT COUNT(*) AS n FROM branch_services');
    if (Number(branchServiceCount.n) === 0) {
        await db.query('INSERT IGNORE INTO branch_services(branch_id,service_id,is_active) SELECT b.branch_id,s.service_id,1 FROM branches b CROSS JOIN services s');
    }
    await db.query(`CREATE TABLE IF NOT EXISTS appointment_services (
        appointment_id INT NOT NULL, service_id INT NOT NULL,
        PRIMARY KEY(appointment_id,service_id),
        FOREIGN KEY(appointment_id) REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        FOREIGN KEY(service_id) REFERENCES services(service_id)
    ) ENGINE=InnoDB`);
    await addColumnIfMissing('appointment_services','quantity','INT NOT NULL DEFAULT 1 AFTER service_id');
    await db.query('INSERT IGNORE INTO appointment_services (appointment_id,service_id) SELECT appointment_id,service_id FROM appointments');
    await db.query(`CREATE TABLE IF NOT EXISTS staff_availability (
        availability_id INT AUTO_INCREMENT PRIMARY KEY, staff_id INT NOT NULL, weekday TINYINT NOT NULL,
        start_time TIME NOT NULL, end_time TIME NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_staff_day_times (staff_id,weekday,start_time,end_time),
        FOREIGN KEY(staff_id) REFERENCES staff(staff_id) ON DELETE CASCADE,
        CONSTRAINT chk_staff_day CHECK (weekday BETWEEN 0 AND 6),
        CONSTRAINT chk_staff_times CHECK (start_time < end_time)
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS api_sessions (
        session_id CHAR(32) PRIMARY KEY, user_id INT NOT NULL, token_hash CHAR(64) NOT NULL,
        role_at_login VARCHAR(15) NOT NULL, expires_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL, revoked_at DATETIME NULL, ip_hash CHAR(64) NULL,
        KEY idx_sessions_user (user_id), KEY idx_sessions_expiry (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS login_attempts (
        identifier VARCHAR(255) PRIMARY KEY, failed_count INT NOT NULL DEFAULT 0,
        locked_until DATETIME NULL, last_failed DATETIME NULL
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS audit_log (
        audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_user_id INT NULL, event VARCHAR(70) NOT NULL, entity_type VARCHAR(50) NULL,
        entity_id VARCHAR(70) NULL, details JSON NULL, ip_hash CHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_audit_created(created_at), KEY idx_audit_actor(actor_user_id),
        FOREIGN KEY(actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
    // Explicit qualifications: do not infer skills from unstructured specialization labels.
    await db.query(`CREATE TABLE IF NOT EXISTS staff_services (
        staff_id INT NOT NULL, service_id INT NOT NULL,
        PRIMARY KEY (staff_id,service_id),
        FOREIGN KEY (staff_id) REFERENCES staff(staff_id) ON DELETE CASCADE,
        FOREIGN KEY (service_id) REFERENCES services(service_id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    // In-person attendance is separate from anonymous website page-view tracking.
    await db.query(`CREATE TABLE IF NOT EXISTS appointment_visits (
        appointment_id INT PRIMARY KEY,
        checked_in_at DATETIME NULL, checked_in_by INT NULL,
        checked_out_at DATETIME NULL, checked_out_by INT NULL,
        FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id) ON DELETE CASCADE,
        FOREIGN KEY (checked_in_by) REFERENCES users(user_id) ON DELETE SET NULL,
        FOREIGN KEY (checked_out_by) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS visitor_log (
        visit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL, path VARCHAR(180) NOT NULL, ip_hash CHAR(64) NOT NULL,
        user_agent VARCHAR(240) NULL, visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_visit_date(visited_at), KEY idx_visit_user(user_id),
        FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE SET NULL
    ) ENGINE=InnoDB`);

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
