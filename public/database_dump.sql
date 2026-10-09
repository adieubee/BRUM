SET FOREIGN_KEY_CHECKS = 0;
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
    `role` ENUM('owner','staff','client') NOT NULL DEFAULT 'client',
    `name` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`user_id`),
    UNIQUE KEY `uq_users_username` (`username`),
    UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (`user_id`, `username`, `email`, `password_hash`, `role`, `name`) VALUES
(1, 'admin', 'admin@example.com', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'owner', 'Shop Owner'),
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
    `staff_id` INT NULL COMMENT 'References users.user_id for the staff member credited with the sale',
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
    KEY `idx_finance_staff` (`staff_id`),
    CONSTRAINT `fk_finance_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`appointment_id`) ON DELETE SET NULL,
    CONSTRAINT `fk_finance_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE SET NULL,
    CONSTRAINT `fk_finance_staff_user` FOREIGN KEY (`staff_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
