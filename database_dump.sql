SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `appointments`;
DROP TABLE IF EXISTS `inventory`;
DROP TABLE IF EXISTS `staff`;
DROP TABLE IF EXISTS `services`;
DROP TABLE IF EXISTS `branches`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- 1. Users Table
CREATE TABLE `users` (
                         `user_id` int NOT NULL AUTO_INCREMENT,
                         `username` varchar(50) NOT NULL,
                         `password_hash` varchar(255) NOT NULL,
                         `role` enum('owner','staff','client') NOT NULL DEFAULT 'client',
                         `name` varchar(100) NOT NULL,
                         `phone` varchar(20) DEFAULT NULL,
                         `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                         PRIMARY KEY (`user_id`),
                         UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `users` (`user_id`, `username`, `password_hash`, `role`, `name`, `phone`) VALUES
                                                                                          (1, 'admin', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'owner', 'Shop Owner', '09170000000'),
                                                                                          (2, 'staff_malolos', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'staff', 'Barber Marco (Malolos)', '09171111111'),
                                                                                          (3, 'staff_pulilan', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'staff', 'Barber Lucas (Pulilan)', '09172222222'),
                                                                                          (4, 'client1', '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi', 'client', 'Juan Dela Cruz', '09171234567');

-- 2. Branches Table
CREATE TABLE `branches` (
                            `branch_id` int NOT NULL AUTO_INCREMENT,
                            `name` varchar(100) NOT NULL,
                            `address` varchar(255) NOT NULL,
                            PRIMARY KEY (`branch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `branches` (`branch_id`, `name`, `address`) VALUES
                                                            (1, 'Malolos Branch', 'Mac Arthur Hi-Way, Malolos, Bulacan'),
                                                            (2, 'Pulilan Branch', 'Regional Rd., Pulilan, Bulacan'),
                                                            (3, 'Malabon Branch', 'Manapat St., Tanong, Malabon');

-- 3. Staff Table
CREATE TABLE `staff` (
                         `staff_id` int NOT NULL AUTO_INCREMENT,
                         `user_id` int NOT NULL,
                         `branch_id` int NOT NULL,
                         `specialization` varchar(100) DEFAULT 'General Barber',
                         PRIMARY KEY (`staff_id`),
                         KEY `user_id_idx` (`user_id`),
                         KEY `branch_id_idx` (`branch_id`),
                         CONSTRAINT `fk_staff_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE CASCADE,
                         CONSTRAINT `fk_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `staff` (`staff_id`, `user_id`, `branch_id`, `specialization`) VALUES
                                                                               (1, 2, 1, 'Classic Fade & Beard Trim'),
                                                                               (2, 3, 2, 'Modern Styling & Hot Towel Shave');

-- 4. Services Table
CREATE TABLE `services` (
                            `service_id` int NOT NULL AUTO_INCREMENT,
                            `name` varchar(100) NOT NULL,
                            `category` varchar(100) DEFAULT 'Haircuts & Styling',
                            `price` decimal(10,2) NOT NULL,
                            `duration_minutes` int NOT NULL,
                            `icon` varchar(50) DEFAULT 'fa-cut',
                            PRIMARY KEY (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `services` (`service_id`, `name`, `category`, `price`, `duration_minutes`, `icon`) VALUES
                                                                                                   (1, 'Classic Gentleman Cut', 'Haircuts & Styling', 350.00, 30, 'fa-cut'),
                                                                                                   (2, 'Skin Fade with Styling', 'Haircuts & Styling', 400.00, 45, 'fa-cut'),
                                                                                                   (3, 'Beard Trim & Shape-up', 'Beard Grooming & Shave', 250.00, 20, 'fa-moustaches'),
                                                                                                   (4, 'Haircut + Beard Combo', 'Combos/Packages', 650.00, 60, 'fa-box');

-- 5. Inventory Table
CREATE TABLE `inventory` (
                             `inventory_id` int NOT NULL AUTO_INCREMENT,
                             `branch_id` int NOT NULL,
                             `item_name` varchar(100) NOT NULL,
                             `unit` varchar(50) DEFAULT 'pcs',
                             `price` decimal(10,2) DEFAULT '0.00',
                             `quantitiy` int NOT NULL DEFAULT '0',
                             `status` varchar(45) DEFAULT 'Good',
                             PRIMARY KEY (`inventory_id`),
                             KEY `branch_id_idx` (`branch_id`),
                             CONSTRAINT `fk_inv_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `inventory` (`inventory_id`, `branch_id`, `item_name`, `unit`, `price`, `quantitiy`, `status`) VALUES
                                                                                                               (1, 1, 'Strong Hold Pomade', 'pcs', 450.00, 25, 'Good'),
                                                                                                               (2, 2, 'Strong Hold Pomade', 'pcs', 450.00, 5, 'Low Stock');

-- 6. Appointments Table
CREATE TABLE `appointments` (
                                `appointment_id` int NOT NULL AUTO_INCREMENT,
                                `client_id` int NOT NULL,
                                `branch_id` int NOT NULL,
                                `service_id` int NOT NULL,
                                `staff_id` int DEFAULT NULL,
                                `service_ids` varchar(255) DEFAULT NULL,
                                `appointment_date` date NOT NULL,
                                `appointment_time` time NOT NULL,
                                `status` varchar(45) NOT NULL DEFAULT 'Pending',
                                `pax` int DEFAULT '1',
                                `message` text,
                                `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
                                PRIMARY KEY (`appointment_id`),
                                KEY `client_id_idx` (`client_id`),
                                KEY `branch_id_idx` (`branch_id`),
                                KEY `service_id_idx` (`service_id`),
                                KEY `staff_id_idx` (`staff_id`),
                                CONSTRAINT `fk_appt_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`branch_id`),
                                CONSTRAINT `fk_appt_client` FOREIGN KEY (`client_id`) REFERENCES `users` (`user_id`),
                                CONSTRAINT `fk_appt_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`),
                                CONSTRAINT `fk_appt_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `appointments` (`appointment_id`, `client_id`, `branch_id`, `service_id`, `staff_id`, `service_ids`, `appointment_date`, `appointment_time`, `status`, `pax`, `message`) VALUES
    (1, 4, 1, 1, 1, '1', CURDATE(), '10:00:00', 'Confirmed', 1, 'First-time customer cut');