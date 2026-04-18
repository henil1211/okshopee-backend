-- Ensure v2 pin storage enforces the 7-character runtime policy.
-- Run the pin format repair script before this migration if any historical rows are not 7 chars.

ALTER TABLE v2_pins
  MODIFY COLUMN pin_code CHAR(7) NOT NULL;

SET @has_pin_len_check := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'v2_pins'
    AND constraint_name = 'chk_v2_pins_code_len_7'
    AND constraint_type = 'CHECK'
);

SET @pin_len_check_sql := IF(
  @has_pin_len_check = 0,
  'ALTER TABLE v2_pins ADD CONSTRAINT chk_v2_pins_code_len_7 CHECK (CHAR_LENGTH(TRIM(pin_code)) = 7)',
  'SELECT 1'
);

PREPARE pin_len_check_stmt FROM @pin_len_check_sql;
EXECUTE pin_len_check_stmt;
DEALLOCATE PREPARE pin_len_check_stmt;
