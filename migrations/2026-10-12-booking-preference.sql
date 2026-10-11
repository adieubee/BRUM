-- BRUM v1.2.3 -- run ONCE on an existing pre-v1.2.3 database IF this column is absent.
-- Back up first. Do not import the DROP TABLE demo database_dump.sql into an existing database.
-- Normally api/_lib/db.js creates this column and FK automatically via ensureSchema().
-- Confirm that requested_staff_id is absent before running the statements below:
-- SHOW COLUMNS FROM appointments LIKE 'requested_staff_id';
ALTER TABLE appointments ADD COLUMN requested_staff_id INT NULL AFTER staff_id;
ALTER TABLE appointments ADD CONSTRAINT fk_appointment_requested_staff
  FOREIGN KEY (requested_staff_id) REFERENCES staff(staff_id) ON DELETE SET NULL;
