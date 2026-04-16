-- V2 admin adjustment immutable audit trail
-- Apply after 001_v2_finance_core.sql

CREATE TABLE IF NOT EXISTS v2_admin_adjustment_audit (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  audit_uuid CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  approver_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NOT NULL,
  wallet_type ENUM('fund','income','royalty') NOT NULL,
  direction ENUM('credit','debit') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(40) NOT NULL,
  ticket_id VARCHAR(80) NOT NULL,
  note VARCHAR(500) NOT NULL,
  payload_json JSON NOT NULL,
  ledger_tx_uuid CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_admin_adjustment_audit_uuid (audit_uuid),
  KEY idx_v2_admin_adjustment_idem (idempotency_key),
  KEY idx_v2_admin_adjustment_target_time (target_user_id, created_at),
  KEY idx_v2_admin_adjustment_actor_time (actor_user_id, created_at),
  CONSTRAINT fk_v2_admin_adjustment_actor FOREIGN KEY (actor_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_admin_adjustment_approver FOREIGN KEY (approver_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_admin_adjustment_target FOREIGN KEY (target_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_admin_adjustment_idem FOREIGN KEY (idempotency_key) REFERENCES v2_idempotency_keys(idempotency_key)
) ENGINE=InnoDB;
