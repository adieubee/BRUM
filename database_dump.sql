SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `appointment_visits`;
DROP TABLE IF EXISTS `staff_services`;
DROP TABLE IF EXISTS `visitor_log`;
DROP TABLE IF EXISTS `audit_log`;
DROP TABLE IF EXISTS `login_attempts`;
DROP TABLE IF EXISTS `api_sessions`;
DROP TABLE IF EXISTS `staff_availability`;
DROP TABLE IF EXISTS `appointment_services`;
DROP TABLE IF EXISTS `service_inventory`;
DROP TABLE IF EXISTS `branch_services`;
DROP TABLE IF EXISTS `admins`;
DROP TABLE IF EXISTS `clients`;
DROP TABLE IF EXISTS `booking_history`;
DROP TABLE IF EXISTS `finance`;
DROP TABLE IF EXISTS `appointments`;
DROP TABLE IF EXISTS `inventory`;
DROP TABLE IF EXISTS `staff`;
DROP TABLE IF EXISTS `services`;
DROP TABLE IF EXISTS `branches`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. Users
CREATE TABLE `users` (
    `user_id` INT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(255) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin','staff','client') NOT NULL DEFAULT 'client',
    `name` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`),
    UNIQUE KEY `uq_users_username` (`username`),
    UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (`user_id`, `username`, `email`, `password_hash`, `role`, `name`) VALUES
(1, 'admin', 'admin@example.com', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'admin', 'Shop Owner'),
(2, 'staff_malolos', 'staff.malolos@example.com', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'staff', 'Barber Marco (Malolos)'),
(3, 'staff_pulilan', 'staff.pulilan@example.com', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'staff', 'Barber Lucas (Pulilan)'),
(4, 'client1', 'client1@example.com', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'client', 'Juan Dela Cruz');

-- 2. Branches
CREATE TABLE `branches` (
    `branch_id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `address` VARCHAR(255) NOT NULL,
    PRIMARY KEY (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `branches` (`branch_id`, `name`, `address`) VALUES
(1, 'Malolos Branch', 'Mac Arthur Hi-Way, Malolos, Bulacan'),
(2, 'Pulilan Branch', 'Regional Rd., Pulilan, Bulacan'),
(3, 'Malabon Branch', 'Manapat St., Tanong, Malabon');

-- 3. Staff
CREATE TABLE `staff` (
    `staff_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `branch_id` INT NOT NULL,
    `specialization` VARCHAR(100) DEFAULT 'General Dermatechnician',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (`staff_id`),
    UNIQUE KEY `uq_staff_user` (`user_id`),
    KEY `idx_staff_branch` (`branch_id`),
    CONSTRAINT `fk_staff_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `staff` (`staff_id`, `user_id`, `branch_id`, `specialization`) VALUES
(1, 2, 1, 'Classic Fade & Beard Trim'),
(2, 3, 2, 'Modern Styling & Hot Towel Shave');

-- 4. Services
CREATE TABLE `services` (
    `service_id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `category` VARCHAR(100) DEFAULT 'Haircuts & Styling',
    `price` DECIMAL(10,2) NOT NULL,
    `duration_minutes` INT NOT NULL,
    `icon` VARCHAR(50) DEFAULT 'fa-cut',
    PRIMARY KEY (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `services` (`service_id`, `name`, `category`, `price`, `duration_minutes`, `icon`) VALUES
(1, 'Classic Gentleman Cut', 'Haircuts & Styling', 350.00, 30, 'fa-cut'),
(2, 'Skin Fade with Styling', 'Haircuts & Styling', 400.00, 45, 'fa-cut'),
(3, 'Beard Trim & Shape-up', 'Beard Grooming & Shave', 250.00, 20, 'fa-moustaches'),
(4, 'Haircut + Beard Combo', 'Combos/Packages', 650.00, 60, 'fa-box');

-- 5. Inventory
CREATE TABLE `inventory` (
    `inventory_id` INT NOT NULL AUTO_INCREMENT,
    `branch_id` INT NOT NULL,
    `item_name` VARCHAR(100) NOT NULL,
    `unit` VARCHAR(50) DEFAULT 'pcs',
    `price` DECIMAL(10,2) DEFAULT 0.00,
    `quantity` INT NOT NULL DEFAULT 0,
    `status` VARCHAR(45) DEFAULT 'Good',
    PRIMARY KEY (`inventory_id`),
    KEY `idx_inventory_branch` (`branch_id`),
    CONSTRAINT `fk_inv_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `inventory` (`inventory_id`, `branch_id`, `item_name`, `unit`, `price`, `quantity`, `status`) VALUES
(1, 1, 'Strong Hold Pomade', 'pcs', 450.00, 25, 'Good'),
(2, 2, 'Strong Hold Pomade', 'pcs', 450.00, 5, 'Low Stock');

-- 6. Appointments
CREATE TABLE `appointments` (
    `appointment_id` INT NOT NULL AUTO_INCREMENT,
    `client_id` INT NOT NULL,
    `branch_id` INT NOT NULL,
    `service_id` INT NOT NULL,
    `staff_id` INT DEFAULT NULL,
    `service_ids` VARCHAR(255) DEFAULT NULL,
    `appointment_date` DATE NOT NULL,
    `appointment_time` TIME NOT NULL,
    `status` VARCHAR(45) NOT NULL DEFAULT 'Pending Payment',
    `pax` INT DEFAULT 1,
    `message` TEXT,
    `dp_paid` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `warts_dp` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `non_warts_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `reschedule_requested_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`appointment_id`),
    KEY `idx_appt_client` (`client_id`),
    KEY `idx_appt_branch` (`branch_id`),
    KEY `idx_appt_service` (`service_id`),
    KEY `idx_appt_staff` (`staff_id`),
    CONSTRAINT `fk_appt_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`),
    CONSTRAINT `fk_appt_client` FOREIGN KEY (`client_id`) REFERENCES `users` (`user_id`),
    CONSTRAINT `fk_appt_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`),
    CONSTRAINT `fk_appt_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `appointments` (
    `appointment_id`, `client_id`, `branch_id`, `service_id`, `staff_id`, `service_ids`,
    `appointment_date`, `appointment_time`, `status`, `pax`, `message`, `dp_paid`, `warts_dp`, `non_warts_price`
) VALUES
(1, 4, 1, 1, 1, '1', CURDATE(), '10:00:00', 'Confirmed', 1, 'First-time customer cut', 70.00, 0.00, 350.00);

-- 7. Booking history
CREATE TABLE `booking_history` (
    `history_id` INT NOT NULL AUTO_INCREMENT,
    `appointment_id` INT NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `previous_status` VARCHAR(45) NULL,
    `new_status` VARCHAR(45) NULL,
    `changed_by` INT NULL,
    `details` TEXT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`history_id`),
    KEY `idx_booking_history_appointment` (`appointment_id`),
    KEY `idx_booking_history_changed_by` (`changed_by`),
    KEY `idx_booking_history_created_at` (`created_at`),
    CONSTRAINT `fk_booking_history_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`appointment_id`) ON DELETE CASCADE,
    CONSTRAINT `fk_booking_history_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `booking_history` (`appointment_id`, `action`, `previous_status`, `new_status`, `changed_by`, `details`) VALUES
(1, 'created', NULL, 'Pending Payment', 4, 'Booking created for first-time customer cut');

-- 8. Finance / POS transactions
CREATE TABLE `finance` (
    `transaction_id` INT NOT NULL AUTO_INCREMENT,
    `appointment_id` INT NULL,
    `branch_id` INT NULL,
    `staff_user_id` INT NULL COMMENT 'References users.user_id for the staff member credited with the sale',
    `amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Gross sale value including services and products',
    `amount_due` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Balance collected at POS after any recorded down payment',
    `cash_received` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `change_due` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `products_bought` LONGTEXT NULL,
    `payment_method` VARCHAR(50) NOT NULL DEFAULT 'Cash',
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`transaction_id`),
    KEY `idx_finance_appointment` (`appointment_id`),
    KEY `idx_finance_branch` (`branch_id`),
    KEY `idx_finance_staff` (`staff_user_id`),
    CONSTRAINT `fk_finance_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`appointment_id`) ON DELETE SET NULL,
    CONSTRAINT `fk_finance_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE SET NULL,
    CONSTRAINT `fk_finance_staff_user` FOREIGN KEY (`staff_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Use this destructive DROP/CREATE script for a NEW local database only.
-- Existing databases are upgraded in place by api/_lib/db.js; back up data first.


-- Security, role-profile, scheduling, and normalized association tables.
-- Also created automatically on existing installations by api/_lib/db.js.
CREATE TABLE `admins` (`user_id` INT PRIMARY KEY,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE) ENGINE=InnoDB;
CREATE TABLE `clients` (`user_id` INT PRIMARY KEY, `preferred_branch_id` INT NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    FOREIGN KEY (`preferred_branch_id`) REFERENCES `branches`(`branch_id`) ON DELETE SET NULL) ENGINE=InnoDB;
INSERT INTO `admins` (`user_id`) SELECT `user_id` FROM `users` WHERE `role`='admin';
INSERT INTO `clients` (`user_id`) SELECT `user_id` FROM `users` WHERE `role`='client';
CREATE TABLE `branch_services` (`branch_id` INT NOT NULL, `service_id` INT NOT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY(`branch_id`,`service_id`),
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`branch_id`) ON DELETE CASCADE,
    FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`) ON DELETE CASCADE) ENGINE=InnoDB;
INSERT INTO `branch_services` (`branch_id`,`service_id`,`is_active`)
SELECT b.branch_id,s.service_id,1 FROM branches b CROSS JOIN services s;
CREATE TABLE `service_inventory` (`service_id` INT NOT NULL, `inventory_id` INT NOT NULL,
    `quantity_used` DECIMAL(10,3) NOT NULL DEFAULT 1,
    PRIMARY KEY(`service_id`,`inventory_id`),
    FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`) ON DELETE CASCADE,
    FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`inventory_id`) ON DELETE CASCADE) ENGINE=InnoDB;
CREATE TABLE `appointment_services` (`appointment_id` INT NOT NULL, `service_id` INT NOT NULL,
    `quantity` INT NOT NULL DEFAULT 1,
    PRIMARY KEY(`appointment_id`,`service_id`),
    FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`appointment_id`) ON DELETE CASCADE,
    FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`)) ENGINE=InnoDB;
INSERT IGNORE INTO `appointment_services` (`appointment_id`,`service_id`)
SELECT `appointment_id`,`service_id` FROM `appointments`;
CREATE TABLE `staff_availability` (`availability_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `staff_id` INT NOT NULL, `weekday` TINYINT NOT NULL,
    `start_time` TIME NOT NULL, `end_time` TIME NOT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY `uq_staff_day_times`(`staff_id`,`weekday`,`start_time`,`end_time`),
    FOREIGN KEY (`staff_id`) REFERENCES `staff`(`staff_id`) ON DELETE CASCADE,
    CONSTRAINT `chk_staff_day` CHECK (`weekday` BETWEEN 0 AND 6),
    CONSTRAINT `chk_staff_times` CHECK (`start_time` < `end_time`)) ENGINE=InnoDB;
CREATE TABLE `api_sessions` (`session_id` CHAR(32) PRIMARY KEY,
    `user_id` INT NOT NULL, `token_hash` CHAR(64) NOT NULL, `role_at_login` VARCHAR(15) NOT NULL,
    `expires_at` DATETIME NOT NULL, `last_seen_at` DATETIME NOT NULL,
    `revoked_at` DATETIME NULL, `ip_hash` CHAR(64) NULL,
    KEY `idx_sessions_user`(`user_id`), KEY `idx_sessions_expiry`(`expires_at`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE) ENGINE=InnoDB;
CREATE TABLE `login_attempts` (`identifier` VARCHAR(255) PRIMARY KEY,
    `failed_count` INT NOT NULL DEFAULT 0, `locked_until` DATETIME NULL, `last_failed` DATETIME NULL) ENGINE=InnoDB;
CREATE TABLE `audit_log` (`audit_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `actor_user_id` INT NULL, `event` VARCHAR(70) NOT NULL,
    `entity_type` VARCHAR(50) NULL, `entity_id` VARCHAR(70) NULL,
    `details` JSON NULL, `ip_hash` CHAR(64) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_audit_created`(`created_at`),KEY `idx_audit_actor`(`actor_user_id`),
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL) ENGINE=InnoDB;
CREATE TABLE `staff_services` (
    `staff_id` INT NOT NULL, `service_id` INT NOT NULL,
    PRIMARY KEY (`staff_id`, `service_id`),
    FOREIGN KEY (`staff_id`) REFERENCES `staff`(`staff_id`) ON DELETE CASCADE,
    FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO `staff_services` (`staff_id`,`service_id`) VALUES (1,1),(1,2),(1,3),(1,4),(2,1),(2,2),(2,3),(2,4);

CREATE TABLE `appointment_visits` (
    `appointment_id` INT PRIMARY KEY,
    `checked_in_at` DATETIME NULL, `checked_in_by` INT NULL,
    `checked_out_at` DATETIME NULL, `checked_out_by` INT NULL,
    FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`appointment_id`) ON DELETE CASCADE,
    FOREIGN KEY (`checked_in_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
    FOREIGN KEY (`checked_out_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `visitor_log` (`visit_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NULL, `path` VARCHAR(180) NOT NULL, `ip_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(240) NULL, `visited_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_visit_date`(`visited_at`),KEY `idx_visit_user`(`user_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL) ENGINE=InnoDB;
