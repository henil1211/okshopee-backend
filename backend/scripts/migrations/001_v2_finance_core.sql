-- V2 finance core schema migration
-- Apply on MySQL 8+ (InnoDB)

CREATE TABLE IF NOT EXISTS v2_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  legacy_user_id VARCHAR(64) NULL,
  user_code VARCHAR(20) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NULL,
  status ENUM('active','blocked','closed') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_users_user_code (user_code),
  UNIQUE KEY uq_v2_users_legacy_user_id (legacy_user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_gl_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_code VARCHAR(80) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_type ENUM('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY') NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  wallet_type ENUM('fund','income','royalty') NULL,
  is_system_account TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_gl_accounts_code (account_code),
  KEY idx_v2_gl_accounts_owner_wallet (owner_user_id, wallet_type),
  CONSTRAINT fk_v2_gl_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_baseline_balances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_type ENUM('fund','income','royalty') NOT NULL,
  baseline_amount_cents BIGINT NOT NULL,
  baseline_version INT NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  captured_by VARCHAR(80) NOT NULL,
  snapshot_hash CHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_baseline_user_wallet_version (user_id, wallet_type, baseline_version),
  KEY idx_v2_baseline_active (is_active, baseline_version),
  CONSTRAINT fk_v2_baseline_user FOREIGN KEY (user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_wallet_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_type ENUM('fund','income','royalty') NOT NULL,
  gl_account_id BIGINT UNSIGNED NOT NULL,
  baseline_amount_cents BIGINT NOT NULL,
  current_amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_wallet_user_wallet (user_id, wallet_type),
  UNIQUE KEY uq_v2_wallet_gl_account (gl_account_id),
  CONSTRAINT chk_v2_wallet_non_negative CHECK (current_amount_cents >= 0),
  CONSTRAINT fk_v2_wallet_user FOREIGN KEY (user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_wallet_gl FOREIGN KEY (gl_account_id) REFERENCES v2_gl_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_help_progress_state (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  current_stage_code VARCHAR(40) NOT NULL,
  receive_count_in_stage INT UNSIGNED NOT NULL DEFAULT 0,
  receive_total_cents_in_stage BIGINT UNSIGNED NOT NULL DEFAULT 0,
  next_required_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pending_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_progress_event_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  baseline_snapshot_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_v2_help_progress_user FOREIGN KEY (user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_idempotency_keys (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  endpoint_name VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('processing','completed','failed') NOT NULL,
  response_code INT NULL,
  response_body JSON NULL,
  error_code VARCHAR(80) NULL,
  locked_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_v2_idem_actor (actor_user_id),
  KEY idx_v2_idem_status_lock (status, locked_until),
  CONSTRAINT fk_v2_idem_actor FOREIGN KEY (actor_user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_ledger_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tx_uuid CHAR(36) NOT NULL,
  system_version VARCHAR(12) NOT NULL DEFAULT 'v2',
  tx_type ENUM('fund_transfer','pin_purchase','referral_credit','withdrawal_debit','admin_adjustment') NOT NULL,
  status ENUM('posted','reversed','void') NOT NULL DEFAULT 'posted',
  idempotency_key VARCHAR(128) NOT NULL,
  initiator_user_id BIGINT UNSIGNED NULL,
  reference_type VARCHAR(40) NULL,
  reference_id VARCHAR(80) NULL,
  description VARCHAR(255) NULL,
  total_debit_cents BIGINT UNSIGNED NOT NULL,
  total_credit_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_ledger_tx_uuid (tx_uuid),
  UNIQUE KEY uq_v2_ledger_idem (idempotency_key),
  KEY idx_v2_ledger_type_time (tx_type, created_at),
  KEY idx_v2_ledger_initiator (initiator_user_id),
  CONSTRAINT fk_v2_ledger_initiator FOREIGN KEY (initiator_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ledger_idem FOREIGN KEY (idempotency_key) REFERENCES v2_idempotency_keys(idempotency_key),
  CONSTRAINT chk_v2_ledger_balanced CHECK (total_debit_cents = total_credit_cents)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_ledger_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ledger_txn_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  gl_account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  wallet_type ENUM('fund','income','royalty') NULL,
  entry_side ENUM('debit','credit') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_entries_txn_line (ledger_txn_id, line_no),
  KEY idx_v2_entries_account (gl_account_id),
  KEY idx_v2_entries_user_wallet (user_id, wallet_type),
  CONSTRAINT fk_v2_entries_txn FOREIGN KEY (ledger_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_entries_gl FOREIGN KEY (gl_account_id) REFERENCES v2_gl_accounts(id),
  CONSTRAINT fk_v2_entries_user FOREIGN KEY (user_id) REFERENCES v2_users(id),
  CONSTRAINT chk_v2_entries_amount_positive CHECK (amount_cents > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_pins (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  pin_code CHAR(16) NOT NULL,
  buyer_user_id BIGINT UNSIGNED NOT NULL,
  price_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('generated','used','expired','cancelled') NOT NULL DEFAULT 'generated',
  purchased_txn_id BIGINT UNSIGNED NOT NULL,
  used_by_user_id BIGINT UNSIGNED NULL,
  used_txn_id BIGINT UNSIGNED NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  used_at DATETIME(3) NULL,
  UNIQUE KEY uq_v2_pins_code (pin_code),
  KEY idx_v2_pins_buyer_status (buyer_user_id, status),
  KEY idx_v2_pins_used_by (used_by_user_id),
  CONSTRAINT fk_v2_pins_buyer FOREIGN KEY (buyer_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_pins_purchase_txn FOREIGN KEY (purchased_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_pins_used_by FOREIGN KEY (used_by_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_pins_used_txn FOREIGN KEY (used_txn_id) REFERENCES v2_ledger_transactions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS v2_referral_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  event_key VARCHAR(140) NOT NULL,
  event_type ENUM('direct_referral','level_referral') NOT NULL,
  source_user_id BIGINT UNSIGNED NOT NULL,
  beneficiary_user_id BIGINT UNSIGNED NOT NULL,
  source_txn_id BIGINT UNSIGNED NULL,
  level_no SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  amount_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','posted','skipped') NOT NULL DEFAULT 'pending',
  credit_txn_id BIGINT UNSIGNED NULL,
  reason VARCHAR(190) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at DATETIME(3) NULL,
  UNIQUE KEY uq_v2_ref_event_key (event_key),
  UNIQUE KEY uq_v2_ref_dedupe (source_txn_id, beneficiary_user_id, event_type, level_no),
  KEY idx_v2_ref_status (status, created_at),
  CONSTRAINT fk_v2_ref_source_user FOREIGN KEY (source_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ref_beneficiary_user FOREIGN KEY (beneficiary_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ref_source_txn FOREIGN KEY (source_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_ref_credit_txn FOREIGN KEY (credit_txn_id) REFERENCES v2_ledger_transactions(id)
) ENGINE=InnoDB;

-- Seed required system GL accounts.
INSERT INTO v2_gl_accounts
  (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
VALUES
  ('SYS_CASH_OR_SETTLEMENT', 'System cash or settlement', 'ASSET', NULL, NULL, 1, 1),
  ('SYS_PIN_REVENUE', 'System pin revenue', 'REVENUE', NULL, NULL, 1, 1),
  ('SYS_REFERRAL_EXPENSE', 'System referral expense', 'EXPENSE', NULL, NULL, 1, 1),
  ('SYS_ADJUSTMENT_SUSPENSE', 'System adjustment suspense', 'EQUITY', NULL, NULL, 1, 1)
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_type = VALUES(account_type),
  is_system_account = VALUES(is_system_account),
  is_active = VALUES(is_active);
