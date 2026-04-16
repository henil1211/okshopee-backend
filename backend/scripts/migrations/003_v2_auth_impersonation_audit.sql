-- V2 auth + impersonation audit trail
-- Safe to apply after 001_v2_finance_core.sql

CREATE TABLE IF NOT EXISTS v2_auth_impersonation_audit (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  audit_uuid CHAR(36) NOT NULL,
  endpoint_name VARCHAR(80) NOT NULL,
  request_id VARCHAR(100) NULL,
  idempotency_key VARCHAR(128) NULL,
  auth_mode ENUM('signed_token','legacy_user_code') NOT NULL,
  auth_subject_user_code VARCHAR(20) NULL,
  auth_subject_user_id BIGINT UNSIGNED NULL,
  auth_subject_is_admin TINYINT(1) NOT NULL DEFAULT 0,
  effective_actor_user_code VARCHAR(20) NULL,
  effective_actor_user_id BIGINT UNSIGNED NULL,
  is_impersonated TINYINT(1) NOT NULL DEFAULT 0,
  impersonator_user_id BIGINT UNSIGNED NULL,
  impersonated_user_id BIGINT UNSIGNED NULL,
  impersonation_reason VARCHAR(255) NULL,
  result ENUM('allowed','rejected') NOT NULL,
  failure_code VARCHAR(80) NULL,
  remote_ip VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_auth_imp_audit_uuid (audit_uuid),
  KEY idx_v2_auth_imp_ep_time (endpoint_name, created_at),
  KEY idx_v2_auth_imp_result_time (result, created_at),
  KEY idx_v2_auth_imp_request (request_id),
  KEY idx_v2_auth_imp_idem (idempotency_key)
) ENGINE=InnoDB;
