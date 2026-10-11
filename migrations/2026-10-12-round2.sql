-- BRUM v1.2.0: non-destructive schema extension (MySQL 8+).
-- Back up the database before running; do not import database_dump.sql on existing data.
-- These additions are also applied by api/_lib/db.js:ensureSchema() on first API request.
-- Requires the audited v1.1 schema with appointments, staff, services and users.

CREATE TABLE IF NOT EXISTS `staff_services` (
  `staff_id` INT NOT NULL,
  `service_id` INT NOT NULL,
  PRIMARY KEY (`staff_id`, `service_id`),
  CONSTRAINT `fk_skill_staff` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`staff_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_skill_service` FOREIGN KEY (`service_id`) REFERENCES `services`(`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `appointment_visits` (
  `appointment_id` INT NOT NULL,
  `checked_in_at` DATETIME NULL,
  `checked_in_by` INT NULL,
  `checked_out_at` DATETIME NULL,
  `checked_out_by` INT NULL,
  PRIMARY KEY (`appointment_id`),
  CONSTRAINT `fk_attendance_appt` FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`appointment_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attendance_in_user` FOREIGN KEY (`checked_in_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_attendance_out_user` FOREIGN KEY (`checked_out_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- No INSERT INTO staff_services on existing sites: administrators must explicitly
-- approve employee service competencies. The sample database_dump.sql seeds demos.
