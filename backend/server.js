import { createServer } from 'node:http';
import { gzip as zlibGzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import {
  buildLegacyDirectCountMap,
  claimPendingContributionForProcessing,
  computeV2HelpSettlementDecision,
  extractIncrementalDirectRequirementsFromLegacySettings,
  isV2UserQualifiedForLevel
} from './help-cascade-rules.js';

const gzipAsync = promisify(zlibGzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load exactly one env file to avoid silent overrides between environments.
const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const EXPLICIT_ENV_FILE = String(process.env.ENV_FILE || process.env.ENV_FILE_PATH || '').trim();
const RESOLVED_EXPLICIT_ENV_FILE = EXPLICIT_ENV_FILE
  ? (path.isAbsolute(EXPLICIT_ENV_FILE) ? EXPLICIT_ENV_FILE : path.join(__dirname, EXPLICIT_ENV_FILE))
  : '';
const ENV_FILE_CANDIDATES = RESOLVED_EXPLICIT_ENV_FILE
  ? [RESOLVED_EXPLICIT_ENV_FILE]
  : NODE_ENV === 'production'
    ? [path.join(__dirname, '.env')]
    : NODE_ENV === 'test'
      ? [path.join(__dirname, '.env.test'), path.join(__dirname, '.env')]
      : [path.join(__dirname, '.env'), path.join(__dirname, '.env.local')];
const ENV_FILE_PATH = ENV_FILE_CANDIDATES.find((candidate) => existsSync(candidate));

if (ENV_FILE_PATH) {
  dotenv.config({ path: ENV_FILE_PATH });
} else {
  dotenv.config();
}

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';
const STORAGE_MODE = String(process.env.STORAGE_MODE || 'mysql').toLowerCase();
const STATE_FILE_PATH_RAW = process.env.STATE_FILE_PATH || path.join('data', 'app-state.local.json');
const STATE_FILE_PATH = path.isAbsolute(STATE_FILE_PATH_RAW)
  ? STATE_FILE_PATH_RAW
  : path.join(__dirname, STATE_FILE_PATH_RAW);

// MySQL config
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'okshopee24';
const FINANCE_ENGINE_MODE = String(process.env.FINANCE_ENGINE_MODE || 'legacy').toLowerCase();
const LEGACY_FINANCIAL_WRITES_ENABLED = process.env.LEGACY_FINANCIAL_WRITES_ENABLED
  ? process.env.LEGACY_FINANCIAL_WRITES_ENABLED === 'true'
  : FINANCE_ENGINE_MODE !== 'v2';
const REQUIRE_IDEMPOTENCY_FOR_MUTATIONS = process.env.REQUIRE_IDEMPOTENCY_FOR_MUTATIONS
  ? process.env.REQUIRE_IDEMPOTENCY_FOR_MUTATIONS === 'true'
  : FINANCE_ENGINE_MODE === 'v2';
const REQUIRE_SYSTEM_VERSION_HEADER = process.env.REQUIRE_SYSTEM_VERSION_HEADER
  ? process.env.REQUIRE_SYSTEM_VERSION_HEADER === 'true'
  : FINANCE_ENGINE_MODE === 'v2';
const V2_AUTH_TOKEN_SECRET = process.env.V2_AUTH_TOKEN_SECRET || '';
const V2_AUTH_TOKEN_ISSUER = process.env.V2_AUTH_TOKEN_ISSUER || 'matrixmlm-backend';
const V2_AUTH_TOKEN_TTL_SECONDS_RAW = Number(process.env.V2_AUTH_TOKEN_TTL_SECONDS || 3600);
const V2_AUTH_TOKEN_TTL_SECONDS = Number.isFinite(V2_AUTH_TOKEN_TTL_SECONDS_RAW)
  && V2_AUTH_TOKEN_TTL_SECONDS_RAW >= 300
  && V2_AUTH_TOKEN_TTL_SECONDS_RAW <= 86400
  ? Math.trunc(V2_AUTH_TOKEN_TTL_SECONDS_RAW)
  : 3600;
const V2_ALLOW_LEGACY_BEARER_USER_CODE = process.env.V2_ALLOW_LEGACY_BEARER_USER_CODE
  ? process.env.V2_ALLOW_LEGACY_BEARER_USER_CODE === 'true'
  : true;
const V2_AUTH_AUDIT_ENABLED = process.env.V2_AUTH_AUDIT_ENABLED !== 'false';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_TIMEOUT_MS_RAW = Number(process.env.SMTP_TIMEOUT_MS || 8000);
const SMTP_TIMEOUT_MS = Number.isFinite(SMTP_TIMEOUT_MS_RAW) && SMTP_TIMEOUT_MS_RAW > 0 ? SMTP_TIMEOUT_MS_RAW : 8000;
const STATE_PAYLOAD_LIMIT_MB_RAW = Number(process.env.STATE_PAYLOAD_LIMIT_MB || 250);
const STATE_PAYLOAD_LIMIT_MB = Number.isFinite(STATE_PAYLOAD_LIMIT_MB_RAW) && STATE_PAYLOAD_LIMIT_MB_RAW > 0
  ? STATE_PAYLOAD_LIMIT_MB_RAW
  : 25;
const STATE_PAYLOAD_LIMIT_BYTES = Math.floor(STATE_PAYLOAD_LIMIT_MB * 1024 * 1024);
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
const SMTP_IGNORE_TLS = process.env.SMTP_IGNORE_TLS === 'true';
const SMTP_REQUIRE_TLS = process.env.SMTP_REQUIRE_TLS === 'true';
const SMTP_TLS_REJECT_UNAUTHORIZED =
  process.env.SMTP_TLS_REJECT_UNAUTHORIZED
    ? process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'true'
    : true;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';
const LEDGER_MISMATCH_ALERT_ENABLED = process.env.LEDGER_MISMATCH_ALERT_ENABLED !== 'false';
const LEDGER_MISMATCH_ALERT_TO = normalizeEmailRecipients(process.env.LEDGER_MISMATCH_ALERT_TO || process.env.ALERT_EMAIL_TO || '');
const LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES_RAW = Number(process.env.LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES || 15);
const LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES = Number.isFinite(LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES_RAW)
  && LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES_RAW >= 1
  ? Math.floor(LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES_RAW)
  : 15;
const LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES_RAW = Number(process.env.LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES || 60);
const LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES = Number.isFinite(LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES_RAW)
  && LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES_RAW >= 1
  ? Math.floor(LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES_RAW)
  : 60;
const STATE_BACKUP_DIR = path.join(__dirname, 'data', 'backups');
const UPLOADS_BASE_DIR = path.join(__dirname, 'data', 'uploads');
const ALLOWED_UPLOAD_SCOPES = new Set([
  'marketplace-retailers',
  'marketplace-banners',
  'marketplace-deals',
  'marketplace-invoices',
  'support-attachments',
  'invoice-queries',
  'deposit-proofs',
  'pin-request-proofs',
  'withdrawal-receipts',
  'payment-methods',
  'announcements'
]);
let smtpTransporter;
let ledgerMismatchAlertLastSignature = '';
let ledgerMismatchAlertLastAt = 0;
let ledgerMismatchAuditRunning = false;

// All known state keys (same as before — frontend sends/receives these)
const DB_KEYS = [
  'mlm_users', 'mlm_wallets', 'mlm_transactions', 'mlm_matrix',
  'mlm_safety_pool', 'mlm_grace_periods', 'mlm_reentries',
  'mlm_notifications', 'mlm_announcements', 'mlm_settings', 'mlm_payment_methods',
  'mlm_payments', 'mlm_pins', 'mlm_pin_transfers',
  'mlm_pin_purchase_requests', 'mlm_support_tickets', 'mlm_otp_records',
  'mlm_email_logs', 'mlm_impersonation', 'mlm_help_trackers',
  'mlm_matrix_pending_contributions', 'mlm_ghost_help_repair_log',
  'mlm_marketplace_categories', 'mlm_marketplace_retailers',
  'mlm_marketplace_banners', 'mlm_marketplace_deals',
  'mlm_marketplace_invoices', 'mlm_marketplace_redemptions'
];

const DB_KEYS_SET = new Set(DB_KEYS);
const LEGACY_FINANCIAL_STATE_KEYS = new Set([
  'mlm_wallets',
  'mlm_transactions',
  'mlm_payments',
  'mlm_pins',
  'mlm_pin_transfers',
  'mlm_pin_purchase_requests',
  'mlm_help_trackers',
  'mlm_matrix_pending_contributions'
]);
const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const V2_FUND_TRANSFER_ENDPOINT_NAME = 'v2_fund_transfer';
const V2_WITHDRAWAL_ENDPOINT_NAME = 'v2_withdrawal';
const V2_PIN_PURCHASE_ENDPOINT_NAME = 'v2_pin_purchase';
const V2_REFERRAL_CREDIT_ENDPOINT_NAME = 'v2_referral_credit';
const V2_HELP_EVENT_ENDPOINT_NAME = 'v2_help_event';
const V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME = 'v2_admin_adjustment';
const V2_WALLET_READ_ENDPOINT_NAME = 'v2_wallet_read';
const V2_TRANSACTIONS_READ_ENDPOINT_NAME = 'v2_transactions_read';
const V2_PINS_READ_ENDPOINT_NAME = 'v2_pins_read';
const V2_STATE_SYNC_ENDPOINT_NAME = 'v2_state_sync';
const V2_ATOMIC_REGISTRATION_ENDPOINT_NAME = 'v2_atomic_registration';
const V2_IDEMPOTENCY_LOCK_SECONDS = 30;
const V2_REFERRAL_MAX_LEVEL = 100;
const V2_REFERRAL_SOURCE_REF_MAX_LENGTH = 120;
const V2_HELP_EVENT_SOURCE_REF_MAX_LENGTH = 120;
const V2_HELP_EVENT_TYPE_ACTIVATION_JOIN = 'activation_join';
const V2_HELP_STAGE_CODE_MAX_LENGTH = 40;
const V2_HELP_LEVEL1_AMOUNT_CENTS_RAW = Number(process.env.V2_HELP_LEVEL1_AMOUNT_CENTS || 500);
const V2_HELP_LEVEL1_AMOUNT_CENTS = Number.isFinite(V2_HELP_LEVEL1_AMOUNT_CENTS_RAW) && V2_HELP_LEVEL1_AMOUNT_CENTS_RAW > 0
  ? Math.trunc(V2_HELP_LEVEL1_AMOUNT_CENTS_RAW)
  : 500;
const V2_HELP_EXPENSE_ACCOUNT_CODE = 'SYS_HELP_EXPENSE';
const V2_HELP_SETTLEMENT_ACCOUNT_CODE = 'SYS_CASH_OR_SETTLEMENT';
const V2_HELP_SAFETY_POOL_ACCOUNT_CODE = 'SYS_HELP_SAFETY_POOL';
const V2_FUND_TRANSFER_MAX_PROGRESS_UPDATES = 2;
const V2_ADMIN_ADJUSTMENT_ENABLED = process.env.V2_ADMIN_ADJUSTMENT_ENABLED !== 'false';
const V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS = new Set(
  String(process.env.V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS || '')
    .split(',')
    .map((value) => normalizeV2UserCode(value))
    .filter((value) => isValidV2UserCode(value))
);
const V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS_RAW = Number(process.env.V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS || 500000);
const V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS = Number.isFinite(V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS_RAW)
  && V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS_RAW >= 0
  ? Math.trunc(V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS_RAW)
  : 500000;
const V2_ADMIN_ADJUSTMENT_MAX_NOTE_LENGTH = 500;
const V2_ADMIN_ADJUSTMENT_MAX_TICKET_ID_LENGTH = 80;
const V2_TX_RETRY_MAX_ATTEMPTS_RAW = Number(process.env.V2_TX_RETRY_MAX_ATTEMPTS || 3);
const V2_TX_RETRY_MAX_ATTEMPTS = Number.isFinite(V2_TX_RETRY_MAX_ATTEMPTS_RAW)
  && V2_TX_RETRY_MAX_ATTEMPTS_RAW >= 1
  && V2_TX_RETRY_MAX_ATTEMPTS_RAW <= 5
  ? Math.trunc(V2_TX_RETRY_MAX_ATTEMPTS_RAW)
  : 3;
const V2_TX_RETRY_BASE_DELAY_MS_RAW = Number(process.env.V2_TX_RETRY_BASE_DELAY_MS || 40);
const V2_TX_RETRY_BASE_DELAY_MS = Number.isFinite(V2_TX_RETRY_BASE_DELAY_MS_RAW)
  && V2_TX_RETRY_BASE_DELAY_MS_RAW >= 0
  ? Math.trunc(V2_TX_RETRY_BASE_DELAY_MS_RAW)
  : 40;
const V2_TX_RETRY_JITTER_MS_RAW = Number(process.env.V2_TX_RETRY_JITTER_MS || 60);
const V2_TX_RETRY_JITTER_MS = Number.isFinite(V2_TX_RETRY_JITTER_MS_RAW)
  && V2_TX_RETRY_JITTER_MS_RAW >= 0
  ? Math.trunc(V2_TX_RETRY_JITTER_MS_RAW)
  : 60;
const V2_DEFAULT_PIN_PRICE_CENTS_RAW = Number(process.env.V2_DEFAULT_PIN_PRICE_CENTS || 1100);
const V2_DEFAULT_PIN_PRICE_CENTS = Number.isFinite(V2_DEFAULT_PIN_PRICE_CENTS_RAW) && V2_DEFAULT_PIN_PRICE_CENTS_RAW > 0
  ? Math.trunc(V2_DEFAULT_PIN_PRICE_CENTS_RAW)
  : 1100;
const V2_PIN_PURCHASE_MAX_QUANTITY_RAW = Number(process.env.V2_PIN_PURCHASE_MAX_QUANTITY || 100);
const V2_PIN_PURCHASE_MAX_QUANTITY = Number.isFinite(V2_PIN_PURCHASE_MAX_QUANTITY_RAW) && V2_PIN_PURCHASE_MAX_QUANTITY_RAW >= 1
  ? Math.trunc(V2_PIN_PURCHASE_MAX_QUANTITY_RAW)
  : 100;
const V2_PIN_CODE_MAX_RETRIES_PER_PIN_RAW = Number(process.env.V2_PIN_CODE_MAX_RETRIES_PER_PIN || 12);
const V2_PIN_CODE_MAX_RETRIES_PER_PIN = Number.isFinite(V2_PIN_CODE_MAX_RETRIES_PER_PIN_RAW) && V2_PIN_CODE_MAX_RETRIES_PER_PIN_RAW >= 1
  ? Math.trunc(V2_PIN_CODE_MAX_RETRIES_PER_PIN_RAW)
  : 12;
const V2_REQUEST_ID_MAX_LENGTH = 100;
const V2_IMPERSONATION_REASON_MAX_LENGTH = 255;
const V2_STATE_WRITE_ALLOWLIST_USER = new Set([
  'mlm_notifications',
  'mlm_pin_purchase_requests',
  'mlm_support_tickets',
  'mlm_otp_records',
  'mlm_email_logs',
  'mlm_marketplace_invoices',
  'mlm_marketplace_redemptions'
]);
const V2_STATE_WRITE_ALLOWLIST_ADMIN = new Set([
  'mlm_users',
  'mlm_safety_pool',
  'mlm_matrix',
  'mlm_grace_periods',
  'mlm_reentries',
  'mlm_pins',
  'mlm_pin_transfers',
  'mlm_pin_purchase_requests',
  'mlm_notifications',
  'mlm_announcements',
  'mlm_settings',
  'mlm_payment_methods',
  'mlm_support_tickets',
  'mlm_otp_records',
  'mlm_email_logs',
  'mlm_impersonation',
  'mlm_ghost_help_repair_log',
  'mlm_marketplace_categories',
  'mlm_marketplace_retailers',
  'mlm_marketplace_banners',
  'mlm_marketplace_deals',
  'mlm_marketplace_invoices',
  'mlm_marketplace_redemptions'
]);
const V2_ADMIN_PIN_STATE_WRITE_KEYS = new Set([
  'mlm_pins',
  'mlm_pin_transfers',
  'mlm_pin_purchase_requests'
]);
const QUALIFICATION_LOCKED_USER_FIELDS = Object.freeze([
  'sponsorId',
  'parentId',
  'directCount',
  'isActive',
  'accountStatus',
  'deactivationReason',
  'activatedAt',
  'reactivatedAt',
  'blockedAt',
  'blockedUntil',
  'blockedReason',
  'isAdmin'
]);

// ─── MySQL connection pool ───────────────────────────────────────────
let pool;

async function ensureStateStoreUpdatedAtColumn() {
  // Older databases may have state_store without updated_at; add it if missing to avoid SELECT errors.
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS column_exists
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = 'state_store' AND column_name = 'updated_at'`,
      [MYSQL_DATABASE]
    );

    if (!rows[0]?.column_exists) {
      await pool.execute(`
        ALTER TABLE state_store
          ADD COLUMN updated_at DATETIME(3)
          DEFAULT CURRENT_TIMESTAMP(3)
          ON UPDATE CURRENT_TIMESTAMP(3)
      `);
      console.log('Added missing state_store.updated_at column');
    }
  } catch (err) {
    console.error('ensureStateStoreUpdatedAtColumn failed:', getErrorMessage(err));
  }
}

async function ensureV2AuthAuditTable() {
  if (!V2_AUTH_AUDIT_ENABLED) return;

  try {
    await pool.execute(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    console.error('ensureV2AuthAuditTable failed:', getErrorMessage(err));
  }
}

async function connectMySQL() {
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });

  // Create the state_store table if it doesn't exist
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS state_store (
      state_key VARCHAR(100) PRIMARY KEY,
      state_value LONGTEXT,
      updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Ensure existing deployments that predate updated_at have the column.
  await ensureStateStoreUpdatedAtColumn();
  await ensureV2AuthAuditTable();

  // Debug: print current DB and columns to confirm schema matches expectations
  try {
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const [colRows] = await pool.execute(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = ? AND table_name = 'state_store'`,
      [MYSQL_DATABASE]
    );
    console.log(`Connected DB: ${dbRow?.db}; state_store columns: ${colRows.map((c) => c.column_name).join(', ')}`);
  } catch (schemaError) {
    console.error('Schema inspection failed:', getErrorMessage(schemaError));
  }

  // Verify connection
  const [rows] = await pool.execute('SELECT 1');
  console.log('MySQL connected; state_store (app sync key-value) ready; V2 finance uses v2_* ledger tables when FINANCE_ENGINE_MODE=v2');
}

async function ensureFileStorageReady() {
  await fs.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true });
  if (!existsSync(STATE_FILE_PATH)) {
    await fs.writeFile(STATE_FILE_PATH, JSON.stringify({ state: {}, updatedAt: null }, null, 2), 'utf-8');
  }
}

async function ensureUploadsDirReady() {
  await fs.mkdir(UPLOADS_BASE_DIR, { recursive: true });
}

async function connectStorage() {
  await ensureUploadsDirReady();

  if (STORAGE_MODE === 'file') {
    await ensureFileStorageReady();
    console.log(`File storage ready: ${STATE_FILE_PATH}`);
    return;
  }

  await connectMySQL();
}

async function getMySQLHealth() {
  if (STORAGE_MODE === 'file') {
    try {
      await ensureFileStorageReady();
      const stat = await fs.stat(STATE_FILE_PATH);
      return { ok: true, error: null, mode: 'file', path: STATE_FILE_PATH, updatedAt: stat.mtime.toISOString() };
    } catch (error) {
      return { ok: false, error: getErrorMessage(error), mode: 'file', path: STATE_FILE_PATH };
    }
  }

  try {
    if (!pool) return { ok: false, error: 'MySQL pool not initialized' };
    await pool.execute('SELECT 1');
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

// Convert ISO datetime to MySQL-compatible format: '2026-03-12 14:30:00.000'
function toMySQLDatetime(isoString) {
  if (!isoString) return null;
  return isoString.replace('T', ' ').replace('Z', '');
}

// ─── In-memory snapshot cache ────────────────────────────────────────
let stateSnapshotCache = null;
let activeStateBackupPromise = null;
let paymentMethodsSnapshotCache = null;

function clonePaymentMethodsSnapshot(methods) {
  if (!Array.isArray(methods)) return [];
  try {
    return JSON.parse(JSON.stringify(methods));
  } catch {
    return methods.map((method) => ({ ...method }));
  }
}

function getErrorMessage(error, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

function isMySQLConnectivityError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || '').toUpperCase();
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EPIPE' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    message.includes('connection') ||
    message.includes('econnreset') ||
    message.includes('socket') ||
    message.includes('timed out') ||
    message.includes('econnrefused')
  );
}

function getHttpStatusForRequestError(error) {
  if (getErrorMessage(error) === 'Payload too large') return 413;
  if (error instanceof SyntaxError) return 400;
  if (isMySQLConnectivityError(error)) return 503;
  return 500;
}

function getPublicRequestBaseUrl(req) {
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const proto = typeof forwardedProto === 'string' && forwardedProto.trim()
    ? forwardedProto.split(',')[0].trim()
    : 'http';
  const host = typeof forwardedHost === 'string' && forwardedHost.trim()
    ? forwardedHost.split(',')[0].trim()
    : (req?.headers?.host || `localhost:${PORT}`);
  return `${proto}://${host}`;
}

function getMimeTypeForExtension(extension) {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

function getExtensionForMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf'
  };
  return map[normalized] || '';
}

function parseDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Uploaded file is empty');
  }

  return { mimeType, buffer };
}

function sanitizeUploadScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (!normalized || !ALLOWED_UPLOAD_SCOPES.has(normalized)) {
    throw new Error('Invalid upload scope');
  }
  return normalized;
}

function sanitizeUploadBaseName(fileName) {
  const raw = path.basename(String(fileName || '').trim() || 'file');
  const withoutExtension = raw.replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || 'file';
}

function getSafeUploadExtension(fileName, mimeType) {
  const providedExt = path.extname(String(fileName || '')).replace(/^\./, '').toLowerCase();
  const safeProvided = /^[a-z0-9]+$/i.test(providedExt) ? providedExt : '';
  const mimeExt = getExtensionForMimeType(mimeType);
  return safeProvided || mimeExt || 'bin';
}

async function saveUploadedDataUrl({ scope, fileName, dataUrl }) {
  const safeScope = sanitizeUploadScope(scope);
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const safeBaseName = sanitizeUploadBaseName(fileName);
  const extension = getSafeUploadExtension(fileName, mimeType);
  const scopeDir = path.join(UPLOADS_BASE_DIR, safeScope);
  await fs.mkdir(scopeDir, { recursive: true });

  const storedFileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeBaseName}.${extension}`;
  const absolutePath = path.join(scopeDir, storedFileName);
  await fs.writeFile(absolutePath, buffer);

  return {
    relativePath: `/uploads/${encodeURIComponent(safeScope)}/${encodeURIComponent(storedFileName)}`,
    mimeType,
    fileName: path.basename(String(fileName || storedFileName)),
    storedFileName,
    sizeBytes: buffer.length
  };
}

function cloneStateSnapshot(snapshot) {
  return {
    state: { ...(snapshot?.state || {}) },
    updatedAt: typeof snapshot?.updatedAt === 'string' ? snapshot.updatedAt : null
  };
}

async function setStateSnapshotCache(snapshot) {
  const cloned = cloneStateSnapshot(snapshot);
  const jsonBody = JSON.stringify(cloned);
  let gzipBody = null;
  if (jsonBody.length > 1024) {
    try {
      gzipBody = await gzipAsync(Buffer.from(jsonBody));
    } catch {
      gzipBody = null;
    }
  }
  stateSnapshotCache = { snapshot: cloned, jsonBody, gzipBody };
  return cloneStateSnapshot(cloned);
}

function invalidateStateSnapshotCache() {
  stateSnapshotCache = null;
}

// ─── HTTP helpers ────────────────────────────────────────────────────
function sendJson(res, statusCode, payload, req) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-System-Version, X-Request-Id, X-Impersonate-User-Code, X-Impersonation-Reason',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  const acceptEncoding = (req && req.headers && req.headers['accept-encoding']) || '';
  const supportsGzip = typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip');

  if (supportsGzip && body.length > 1024) {
    gzipAsync(Buffer.from(body)).then((compressed) => {
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = compressed.length;
      res.writeHead(statusCode, headers);
      res.end(compressed);
    }).catch(() => {
      headers['Content-Length'] = Buffer.byteLength(body);
      res.writeHead(statusCode, headers);
      res.end(body);
    });
    return;
  }

  headers['Content-Length'] = Buffer.byteLength(body);
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendStateSnapshot(res, snapshot, req) {
  const cached = stateSnapshotCache;
  if (!cached || cached.snapshot.updatedAt !== (snapshot?.updatedAt || null)) {
    sendJson(res, 200, snapshot, req);
    return;
  }

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-System-Version, X-Request-Id, X-Impersonate-User-Code, X-Impersonation-Reason',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  const acceptEncoding = (req && req.headers && req.headers['accept-encoding']) || '';
  const supportsGzip = typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip');
  if (supportsGzip && cached.gzipBody) {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = cached.gzipBody.length;
    res.writeHead(200, headers);
    res.end(cached.gzipBody);
    return;
  }

  headers['Content-Length'] = Buffer.byteLength(cached.jsonBody);
  res.writeHead(200, headers);
  res.end(cached.jsonBody);
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeEmailRecipients(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter((item) => item.length > 0).join(', ');
}

function getSmtpConfigErrors() {
  const errors = [];
  if (!SMTP_HOST) errors.push('SMTP_HOST');
  if (!Number.isFinite(SMTP_PORT) || SMTP_PORT <= 0) errors.push('SMTP_PORT');
  if (!SMTP_FROM) errors.push('SMTP_FROM');
  if ((SMTP_USER && !SMTP_PASS) || (!SMTP_USER && SMTP_PASS)) {
    errors.push('SMTP_USER and SMTP_PASS must both be set together');
  }
  return errors;
}

function getSmtpTransporter() {
  if (!smtpTransporter) {
    const transportConfig = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      ignoreTLS: SMTP_IGNORE_TLS,
      requireTLS: SMTP_REQUIRE_TLS,
      tls: { rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED }
    };
    if (SMTP_USER && SMTP_PASS) {
      transportConfig.auth = { user: SMTP_USER, pass: SMTP_PASS };
    }
    smtpTransporter = nodemailer.createTransport(transportConfig);
  }
  return smtpTransporter;
}

async function sendRegistrationWelcomeEmailBestEffort(params) {
  const to = normalizeEmailRecipients(params?.to);
  const fullName = String(params?.fullName || '').trim() || 'Member';
  const userId = String(params?.userId || '').trim();
  const email = String(params?.email || '').trim();
  const phone = String(params?.phone || '').trim();
  const loginPassword = String(params?.loginPassword || '');
  const transactionPassword = String(params?.transactionPassword || '');

  if (!to || !userId) {
    return { sent: false, error: 'Missing required recipient data for welcome email' };
  }

  const smtpErrors = getSmtpConfigErrors();
  if (smtpErrors.length > 0) {
    return {
      sent: false,
      error: `SMTP is not configured. Missing/invalid env values: ${smtpErrors.join(', ')}`
    };
  }

  const subject = 'Welcome To ReferNex';
  const body = [
    `Hello ${fullName},`,
    '',
    'Welcome to ReferNex. Your account is now active.',
    '',
    `Name: ${fullName}`,
    `User ID: ${userId}`,
    `Email: ${email}`,
    `Phone: ${phone}`,
    '',
    `Login Password: ${loginPassword}`,
    `Transaction Password: ${transactionPassword}`,
    '',
    'This email is for the User ID shown above. Keep these credentials secure.'
  ].join('\n');

  const maxAttempts = 2;
  let lastError = 'Unknown SMTP error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await getSmtpTransporter().sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text: body
      });
      return { sent: true, error: null };
    } catch (error) {
      lastError = getErrorMessage(error, 'Failed to send welcome email');
    }
  }

  return { sent: false, error: lastError };
}

async function sendOtpEmailBestEffort(params) {
  const to = normalizeEmailRecipients(params?.to);
  const otp = normalizeOtpCode(params?.otp);
  const purpose = String(params?.purpose || '').trim();
  const fullName = String(params?.fullName || '').trim();
  const userId = String(params?.userId || '').trim();

  if (!to || otp.length !== 6) {
    return { sent: false, error: 'Missing required recipient data for OTP email' };
  }

  const smtpErrors = getSmtpConfigErrors();
  if (smtpErrors.length > 0) {
    return {
      sent: false,
      error: `SMTP is not configured. Missing/invalid env values: ${smtpErrors.join(', ')}`
    };
  }

  const purposeLabel = purpose === 'withdrawal'
    ? 'withdrawal'
    : purpose === 'transaction'
      ? 'transaction'
      : purpose === 'profile_update'
        ? 'profile update'
        : 'registration';
  const userIdLine = userId
    ? `User ID: ${userId}`
    : purpose === 'registration'
      ? 'User ID: Pending (assigned after registration)'
      : 'User ID: N/A';
  const nameLine = fullName ? `Name: ${fullName}` : 'Name: N/A';
  const subject = 'Your ReferNex OTP Code';
  const body = [
    `Your OTP for ${purposeLabel} is ${otp}.`,
    'This OTP will expire in 10 minutes.',
    '',
    'This OTP is for your ReferNex account:',
    userIdLine,
    nameLine,
    `Email: ${to}`
  ].join('\n');

  const maxAttempts = 2;
  let lastError = 'Unknown SMTP error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await getSmtpTransporter().sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text: body
      });
      return { sent: true, error: null };
    } catch (error) {
      lastError = getErrorMessage(error, 'Failed to send OTP email');
    }
  }

  return { sent: false, error: lastError };
}

function sanitizeIncomingState(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const key of DB_KEYS) {
    const value = input[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function getIncomingFinancialStateKeys(incomingState) {
  if (!incomingState || typeof incomingState !== 'object') return [];
  const keys = [];
  for (const key of Object.keys(incomingState)) {
    if (!LEGACY_FINANCIAL_STATE_KEYS.has(key)) continue;
    if (typeof incomingState[key] === 'string') {
      keys.push(key);
    }
  }
  return keys;
}

function getV2StateWriteAllowlistForActor(isAdmin) {
  return isAdmin ? V2_STATE_WRITE_ALLOWLIST_ADMIN : V2_STATE_WRITE_ALLOWLIST_USER;
}

function getIncomingDisallowedStateKeys(incomingState, allowlist) {
  if (!incomingState || typeof incomingState !== 'object') return [];
  const disallowed = [];
  for (const key of Object.keys(incomingState)) {
    if (typeof incomingState[key] !== 'string') continue;
    if (!allowlist.has(key)) {
      disallowed.push(key);
    }
  }
  return disallowed;
}

function parseStateJsonObject(raw, fallback = null) {
  if (typeof raw !== 'string') return fallback;
  const parsed = safeParseJSON(raw);
  if (!parsed || typeof parsed !== 'object') return fallback;
  return parsed;
}

function normalizeQualificationDerivedStateForWrite(incomingState, currentState) {
  if (!incomingState || typeof incomingState !== 'object') {
    return incomingState;
  }

  const normalizedState = { ...incomingState };

  if (typeof incomingState.mlm_users === 'string') {
    const incomingUsers = safeParseJSON(incomingState.mlm_users);
    const currentUsers = safeParseJSON(currentState?.mlm_users);

    if (Array.isArray(incomingUsers)) {
      const currentByPublicUserId = new Map();
      const currentByInternalId = new Map();
      if (Array.isArray(currentUsers)) {
        for (const user of currentUsers) {
          const publicUserId = normalizeV2UserCode(user?.userId);
          const internalId = String(user?.id || '').trim();
          if (publicUserId) currentByPublicUserId.set(publicUserId, user);
          if (internalId) currentByInternalId.set(internalId, user);
        }
      }

      const lockedUsers = incomingUsers.map((incomingUser) => {
        if (!incomingUser || typeof incomingUser !== 'object') return incomingUser;

        const publicUserId = normalizeV2UserCode(incomingUser?.userId);
        const internalId = String(incomingUser?.id || '').trim();
        const existingUser = (
          (publicUserId && currentByPublicUserId.get(publicUserId))
          || (internalId && currentByInternalId.get(internalId))
          || null
        );

        if (!existingUser) {
          const nextUser = { ...incomingUser };
          const directCount = Number(nextUser.directCount);
          nextUser.directCount = Number.isFinite(directCount) && directCount > 0
            ? Math.trunc(directCount)
            : 0;
          nextUser.isAdmin = false;
          return nextUser;
        }

        const nextUser = { ...incomingUser };
        for (const field of QUALIFICATION_LOCKED_USER_FIELDS) {
          nextUser[field] = existingUser[field];
        }
        return nextUser;
      });

      normalizedState.mlm_users = JSON.stringify(lockedUsers);
    }
  }

  if (typeof incomingState.mlm_settings === 'string') {
    const incomingSettings = parseStateJsonObject(incomingState.mlm_settings, null);
    const currentSettings = parseStateJsonObject(currentState?.mlm_settings, null);
    if (incomingSettings && currentSettings) {
      const incomingTable = Array.isArray(incomingSettings.helpDistributionTable)
        ? incomingSettings.helpDistributionTable
        : null;
      const currentTable = Array.isArray(currentSettings.helpDistributionTable)
        ? currentSettings.helpDistributionTable
        : null;

      if (incomingTable && currentTable) {
        const mergedTable = incomingTable.map((row, index) => {
          const sourceRow = currentTable[index];
          if (!row || typeof row !== 'object') return row;
          if (!sourceRow || typeof sourceRow !== 'object') return row;
          return {
            ...row,
            directRequired: sourceRow.directRequired
          };
        });
        normalizedState.mlm_settings = JSON.stringify({
          ...incomingSettings,
          helpDistributionTable: mergedTable
        });
      }
    }
  }

  return normalizedState;
}

function getSingleHeaderValue(req, headerName) {
  const value = req?.headers?.[headerName];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function validateV2MutationHeaders(req, url) {
  const method = String(req?.method || '').toUpperCase();
  if (!MUTATING_HTTP_METHODS.has(method)) return null;
  if (!String(url?.pathname || '').startsWith('/api/v2/')) return null;

  if (REQUIRE_SYSTEM_VERSION_HEADER) {
    const systemVersion = getSingleHeaderValue(req, 'x-system-version').toLowerCase();
    if (systemVersion !== 'v2') {
      return {
        status: 400,
        error: 'Missing or invalid X-System-Version header. Expected: v2',
        code: 'INVALID_SYSTEM_VERSION'
      };
    }
  }

  if (REQUIRE_IDEMPOTENCY_FOR_MUTATIONS) {
    const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
    if (!idempotencyKey) {
      return {
        status: 400,
        error: 'Missing required Idempotency-Key header',
        code: 'MISSING_IDEMPOTENCY_KEY'
      };
    }
  }

  return null;
}

function isValidV2UserCode(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,20}$/.test(normalized);
}

function normalizeV2UserCode(value) {
  return String(value || '').trim();
}

function isValidLegacyBearerUserCode(value) {
  return /^\d{7}$/.test(String(value || '').trim());
}

function isValidV2WithdrawalDestinationType(value) {
  return value === 'bank' || value === 'upi' || value === 'wallet';
}

function isValidV2ReferralEventType(value) {
  return value === 'direct_referral' || value === 'level_referral';
}

function isValidV2HelpEventType(value) {
  return value === V2_HELP_EVENT_TYPE_ACTIVATION_JOIN;
}

function isValidV2ReferralSourceRef(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.length > V2_REFERRAL_SOURCE_REF_MAX_LENGTH) return false;
  return /^[a-zA-Z0-9:_-]+$/.test(normalized);
}

function isValidV2HelpEventSourceRef(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (normalized.length > V2_HELP_EVENT_SOURCE_REF_MAX_LENGTH) return false;
  return /^[a-zA-Z0-9:_-]+$/.test(normalized);
}

function isValidV2WalletType(value) {
  return value === 'fund' || value === 'income' || value === 'royalty';
}

function isValidV2AdminAdjustmentDirection(value) {
  return value === 'credit' || value === 'debit';
}

function isValidV2AdminAdjustmentReasonCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_]{3,40}$/.test(normalized);
}

function normalizeOtpCode(value) {
  return String(value || '').trim().replace(/\D/g, '');
}

function findLatestValidOtpRecord(records, params) {
  if (!Array.isArray(records)) return { record: null, index: -1 };

  const normalizedOtp = normalizeOtpCode(params?.otp);
  if (normalizedOtp.length !== 6) {
    return { record: null, index: -1 };
  }

  const normalizedPurpose = String(params?.purpose || '').trim();
  const normalizedEmail = String(params?.email || '').trim().toLowerCase();
  const identityKeys = new Set(
    Array.from(params?.identityKeys || [])
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0)
  );
  const nowMs = Date.now();

  const candidates = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const recordUserKey = String(record?.userId || '').trim();
      const recordEmail = String(record?.email || '').trim().toLowerCase();
      const expiresAtMs = new Date(record?.expiresAt).getTime();
      const matchesIdentity = identityKeys.has(recordUserKey)
        || (!!normalizedEmail && recordEmail === normalizedEmail);
      return matchesIdentity
        && String(record?.otp || '').trim() === normalizedOtp
        && String(record?.purpose || '').trim() === normalizedPurpose
        && !record?.isUsed
        && Number.isFinite(expiresAtMs)
        && expiresAtMs > nowMs;
    })
    .sort((a, b) => {
      const aCreated = new Date(a.record?.createdAt).getTime();
      const bCreated = new Date(b.record?.createdAt).getTime();
      return (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
    });

  const selected = candidates[0] || null;
  return {
    record: selected?.record || null,
    index: selected ? selected.index : -1
  };
}

function markOtpRecordUsed(records, indexToConsume) {
  if (!Array.isArray(records) || indexToConsume < 0) return records;
  return records.map((record, index) => {
    if (index !== indexToConsume) return record;
    return { ...record, isUsed: true };
  });
}

async function loadLockedSensitiveActionState(connection) {
  const [stateRows] = await connection.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_otp_records')
     FOR UPDATE`
  );

  const stateByKey = new Map();
  for (const row of Array.isArray(stateRows) ? stateRows : []) {
    stateByKey.set(String(row?.state_key || ''), String(row?.state_value || ''));
  }

  const usersParsed = safeParseJSON(stateByKey.get('mlm_users'));
  const otpParsed = safeParseJSON(stateByKey.get('mlm_otp_records'));
  return {
    users: Array.isArray(usersParsed) ? usersParsed : [],
    otpRecords: Array.isArray(otpParsed) ? otpParsed : []
  };
}

async function validateAndConsumeSensitiveActionCredentials(connection, params) {
  const actorUserCode = String(params?.actorUserCode || '').trim();
  const transactionPassword = String(params?.transactionPassword || '');
  const otp = normalizeOtpCode(params?.otp);
  const otpPurpose = String(params?.otpPurpose || 'transaction').trim();
  const skipValidation = !!params?.skipValidation;

  if (skipValidation) {
    return { validated: true };
  }

  if (!actorUserCode) {
    throw createApiError(400, 'Actor user code is required for credential validation', 'ACTOR_USER_CODE_REQUIRED');
  }
  if (!transactionPassword) {
    throw createApiError(400, 'Transaction password is required', 'TRANSACTION_PASSWORD_REQUIRED');
  }
  if (otp.length !== 6) {
    throw createApiError(400, 'OTP must be a valid 6-digit code', 'INVALID_OTP');
  }

  const { users, otpRecords } = await loadLockedSensitiveActionState(connection);
  const actorUser = Array.isArray(users)
    ? users.find((candidate) => String(candidate?.userId || '').trim() === actorUserCode)
    : null;
  if (!actorUser) {
    throw createApiError(404, 'Actor user not found in legacy state', 'ACTOR_NOT_FOUND_IN_STATE');
  }
  if (String(actorUser?.transactionPassword || '') !== transactionPassword) {
    throw createApiError(403, 'Invalid transaction password', 'INVALID_TRANSACTION_PASSWORD');
  }

  const otpMatch = findLatestValidOtpRecord(otpRecords, {
    identityKeys: [actorUserCode, actorUser?.id, actorUser?.userId],
    email: actorUser?.email,
    otp,
    purpose: otpPurpose
  });
  if (!otpMatch.record || otpMatch.index < 0) {
    throw createApiError(400, 'Invalid or expired OTP', 'INVALID_OTP');
  }

  const updatedOtpRecords = markOtpRecordUsed(otpRecords, otpMatch.index);
  const nowDb = toMySQLDatetime(new Date().toISOString());
  await connection.execute(
    `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
    ['mlm_otp_records', JSON.stringify(updatedOtpRecords), nowDb]
  );

  return { validated: true, actorUser };
}

function buildV2ReferralEventKey({ sourceTxnId, beneficiaryUserCode, levelNo, eventType }) {
  return `REF:${sourceTxnId}:${beneficiaryUserCode}:${levelNo}:${eventType}`;
}

function buildV2ReferralEventKeyFromRef({ sourceRef, beneficiaryUserCode, levelNo, eventType }) {
  return `REFKEY:${sourceRef}:${beneficiaryUserCode}:${levelNo}:${eventType}`;
}

function buildV2HelpEventKey({ sourceRef, sourceUserCode, newMemberUserCode, eventType }) {
  return `HELP:${sourceRef}:${sourceUserCode}:${newMemberUserCode}:${eventType}`;
}

function buildV2HelpReceiveStageCode(levelNo) {
  return `L${Math.max(1, Math.trunc(levelNo || 1))}_RECEIVE`.slice(0, V2_HELP_STAGE_CODE_MAX_LENGTH);
}

function buildV2HelpPendingGiveStageCode(levelNo) {
  return `L${Math.max(1, Math.trunc(levelNo || 1))}_PENDING_GIVE`.slice(0, V2_HELP_STAGE_CODE_MAX_LENGTH);
}

function generateV2PinCode() {
  // 16 hex chars == 64 bits entropy from CSPRNG.
  return randomBytes(8).toString('hex').toUpperCase();
}

function parseBearerToken(req) {
  const authHeader = getSingleHeaderValue(req, 'authorization');
  if (!authHeader) return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return '';
  return String(match[1] || '').trim();
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signV2AccessTokenSegments(encodedHeader, encodedPayload) {
  if (!V2_AUTH_TOKEN_SECRET) return '';
  return createHmac('sha256', V2_AUTH_TOKEN_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function issueV2AccessTokenForUser(user) {
  if (!V2_AUTH_TOKEN_SECRET || !user?.userId) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: V2_AUTH_TOKEN_ISSUER,
    sub: String(user.userId).trim(),
    uid: String(user.id || '').trim() || null,
    adm: !!user.isAdmin,
    iat: nowSeconds,
    exp: nowSeconds + V2_AUTH_TOKEN_TTL_SECONDS,
    jti: randomUUID()
  };
  const encodedHeader = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signV2AccessTokenSegments(encodedHeader, encodedPayload);

  return {
    tokenType: 'Bearer',
    accessToken: `${encodedHeader}.${encodedPayload}.${signature}`,
    issuer: V2_AUTH_TOKEN_ISSUER,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

function parseSignedV2AccessToken(token) {
  if (!V2_AUTH_TOKEN_SECRET) {
    throw createApiError(401, 'Signed V2 access tokens are not enabled on this backend', 'SIGNED_TOKEN_NOT_ENABLED');
  }

  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw createApiError(401, 'Bearer token is not a valid signed V2 access token', 'INVALID_BEARER_TOKEN');
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const expectedSignature = signV2AccessTokenSegments(encodedHeader, encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw createApiError(401, 'Bearer token signature is invalid', 'INVALID_BEARER_TOKEN');
  }

  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(encodedHeader));
    payload = JSON.parse(decodeBase64Url(encodedPayload));
  } catch {
    throw createApiError(401, 'Bearer token could not be decoded', 'INVALID_BEARER_TOKEN');
  }

  if (header?.alg !== 'HS256' || header?.typ !== 'JWT') {
    throw createApiError(401, 'Bearer token header is invalid', 'INVALID_BEARER_TOKEN');
  }
  if (payload?.iss !== V2_AUTH_TOKEN_ISSUER) {
    throw createApiError(401, 'Bearer token issuer is invalid', 'INVALID_TOKEN_ISSUER');
  }

  const subjectUserCode = normalizeV2UserCode(payload?.sub);
  if (!isValidV2UserCode(subjectUserCode)) {
    throw createApiError(401, 'Bearer token subject is invalid', 'INVALID_TOKEN_SUBJECT');
  }

  const issuedAtSeconds = Number(payload?.iat || 0);
  const expiresAtSeconds = Number(payload?.exp || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(issuedAtSeconds) || !Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) {
    throw createApiError(401, 'Bearer token is expired', 'TOKEN_EXPIRED');
  }

  return {
    authMode: 'signed_token',
    subjectUserCode,
    subjectLegacyUserId: typeof payload?.uid === 'string' ? payload.uid.trim() || null : null,
    subjectIsAdminFromToken: !!payload?.adm
  };
}

async function loadLegacyUsersForAuth() {
  const cachedUsersRaw = stateSnapshotCache?.snapshot?.state?.mlm_users;
  if (typeof cachedUsersRaw === 'string') {
    const parsed = safeParseJSON(cachedUsersRaw);
    if (Array.isArray(parsed)) return parsed;
  }

  const usersRaw = await readStateKeyValue('mlm_users');
  const parsed = typeof usersRaw === 'string' ? safeParseJSON(usersRaw) : [];
  return Array.isArray(parsed) ? parsed : [];
}

async function findLegacyUserByPublicUserId(userId) {
  const normalizedUserId = normalizeV2UserCode(userId);
  if (!normalizedUserId) return null;
  const users = await loadLegacyUsersForAuth();
  return users.find((candidate) => normalizeV2UserCode(candidate?.userId) === normalizedUserId) || null;
}

function isLegacyAncestorUserCode(usersByCode, ancestorUserCode, descendantUserCode) {
  if (!usersByCode || !(usersByCode instanceof Map)) return false;
  const normalizedAncestor = normalizeV2UserCode(ancestorUserCode);
  const normalizedDescendant = normalizeV2UserCode(descendantUserCode);
  if (!normalizedAncestor || !normalizedDescendant || normalizedAncestor === normalizedDescendant) {
    return false;
  }

  let currentUserCode = normalizedDescendant;
  let hops = 0;
  const maxHops = Math.max(1000, usersByCode.size + 5);
  while (currentUserCode && hops < maxHops) {
    const current = usersByCode.get(currentUserCode);
    const sponsorUserCode = normalizeV2UserCode(current?.sponsorId);
    if (!sponsorUserCode) return false;
    if (sponsorUserCode === normalizedAncestor) return true;
    currentUserCode = sponsorUserCode;
    hops += 1;
  }

  return false;
}

async function areUsersInSameLegacyChain(userCodeA, userCodeB) {
  const normalizedA = normalizeV2UserCode(userCodeA);
  const normalizedB = normalizeV2UserCode(userCodeB);
  if (!normalizedA || !normalizedB || normalizedA === normalizedB) return false;

  const users = await loadLegacyUsersForAuth();
  if (!Array.isArray(users) || users.length === 0) return false;

  const usersByCode = new Map();
  for (const user of users) {
    const code = normalizeV2UserCode(user?.userId);
    if (code) {
      usersByCode.set(code, user);
    }
  }

  if (!usersByCode.has(normalizedA) || !usersByCode.has(normalizedB)) {
    return false;
  }

  return isLegacyAncestorUserCode(usersByCode, normalizedA, normalizedB)
    || isLegacyAncestorUserCode(usersByCode, normalizedB, normalizedA);
}

function isLegacyUserEligibleForV2Access(user) {
  if (!user || !user.isActive) return false;
  if (user.accountStatus === 'permanent_blocked') return false;
  if (user.accountStatus === 'temp_blocked') {
    const blockedUntil = user.blockedUntil ? new Date(user.blockedUntil) : null;
    if (blockedUntil && !Number.isNaN(blockedUntil.getTime()) && blockedUntil.getTime() > Date.now()) {
      return false;
    }
  }
  return true;
}

async function findActiveImpersonationSessionForAdmin(adminId) {
  if (!adminId) return null;

  const cachedSessionsRaw = stateSnapshotCache?.snapshot?.state?.mlm_impersonation;
  if (typeof cachedSessionsRaw === 'string') {
    const parsed = safeParseJSON(cachedSessionsRaw);
    if (Array.isArray(parsed)) {
      return parsed.find((session) => String(session?.adminId || '') === String(adminId) && !!session?.isActive) || null;
    }
  }

  const sessionsRaw = await readStateKeyValue('mlm_impersonation');
  const parsed = typeof sessionsRaw === 'string' ? safeParseJSON(sessionsRaw) : [];
  if (!Array.isArray(parsed)) return null;
  return parsed.find((session) => String(session?.adminId || '') === String(adminId) && !!session?.isActive) || null;
}

async function loadV2UsersByCodes(userCodes) {
  if (!pool || !Array.isArray(userCodes) || userCodes.length === 0) return new Map();

  const normalizedCodes = [...new Set(userCodes.map((value) => normalizeV2UserCode(value)).filter((value) => isValidV2UserCode(value)))];
  if (normalizedCodes.length === 0) return new Map();

  const placeholders = normalizedCodes.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT id, user_code
     FROM v2_users
     WHERE user_code IN (${placeholders})`,
    normalizedCodes
  );

  const usersByCode = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    usersByCode.set(String(row.user_code), row);
  }
  return usersByCode;
}

function getRequestRemoteIp(req) {
  const forwardedFor = getSingleHeaderValue(req, 'x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',').map((item) => item.trim()).filter(Boolean)[0] || null;
  }
  return req?.socket?.remoteAddress || null;
}

async function writeV2AuthAuditEvent(event) {
  if (!V2_AUTH_AUDIT_ENABLED || STORAGE_MODE !== 'mysql' || !pool) return;

  try {
    await pool.execute(
      `INSERT INTO v2_auth_impersonation_audit
        (audit_uuid, endpoint_name, request_id, idempotency_key, auth_mode,
         auth_subject_user_code, auth_subject_user_id, auth_subject_is_admin,
         effective_actor_user_code, effective_actor_user_id, is_impersonated,
         impersonator_user_id, impersonated_user_id, impersonation_reason,
         result, failure_code, remote_ip)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        String(event?.endpointName || '').slice(0, 80) || 'unknown_v2_endpoint',
        event?.requestId ? String(event.requestId).slice(0, V2_REQUEST_ID_MAX_LENGTH) : null,
        event?.idempotencyKey ? String(event.idempotencyKey).slice(0, 128) : null,
        event?.authMode === 'signed_token' ? 'signed_token' : 'legacy_user_code',
        event?.authSubjectUserCode ? String(event.authSubjectUserCode).slice(0, 20) : null,
        Number.isFinite(Number(event?.authSubjectV2UserId)) ? Number(event.authSubjectV2UserId) : null,
        event?.authSubjectIsAdmin ? 1 : 0,
        event?.effectiveActorUserCode ? String(event.effectiveActorUserCode).slice(0, 20) : null,
        Number.isFinite(Number(event?.effectiveActorV2UserId)) ? Number(event.effectiveActorV2UserId) : null,
        event?.isImpersonated ? 1 : 0,
        Number.isFinite(Number(event?.impersonatorV2UserId)) ? Number(event.impersonatorV2UserId) : null,
        Number.isFinite(Number(event?.impersonatedV2UserId)) ? Number(event.impersonatedV2UserId) : null,
        event?.impersonationReason ? String(event.impersonationReason).slice(0, V2_IMPERSONATION_REASON_MAX_LENGTH) : null,
        event?.result === 'allowed' ? 'allowed' : 'rejected',
        event?.failureCode ? String(event.failureCode).slice(0, 80) : null,
        event?.remoteIp ? String(event.remoteIp).slice(0, 64) : null
      ]
    );
  } catch (error) {
    console.warn(`[v2-auth-audit] failed: ${getErrorMessage(error, 'Unknown error')}`);
  }
}

async function resolveV2RequestAuthContext({
  req,
  endpointName,
  requiredRole = 'user',
  allowImpersonation = true
}) {
  const rawBearerToken = parseBearerToken(req);
  const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key') || null;
  const requestId = getSingleHeaderValue(req, 'x-request-id') || null;
  const impersonateUserCode = normalizeV2UserCode(getSingleHeaderValue(req, 'x-impersonate-user-code'));
  const impersonationReason = getSingleHeaderValue(req, 'x-impersonation-reason') || null;
  const remoteIp = getRequestRemoteIp(req);

  const rejectWithAudit = async (status, message, code, auditContext = {}) => {
    await writeV2AuthAuditEvent({
      endpointName,
      requestId,
      idempotencyKey,
      remoteIp,
      result: 'rejected',
      failureCode: code,
      ...auditContext
    });
    throw createApiError(status, message, code);
  };

  if (!rawBearerToken) {
    await rejectWithAudit(401, 'Missing or invalid Bearer token', 'INVALID_BEARER_TOKEN');
  }

  let parsedAuth;
  if (rawBearerToken.includes('.')) {
    parsedAuth = parseSignedV2AccessToken(rawBearerToken);
  } else if (V2_ALLOW_LEGACY_BEARER_USER_CODE && isValidLegacyBearerUserCode(rawBearerToken)) {
    parsedAuth = {
      authMode: 'legacy_user_code',
      subjectUserCode: normalizeV2UserCode(rawBearerToken),
      subjectLegacyUserId: null,
      subjectIsAdminFromToken: false
    };
  } else {
    await rejectWithAudit(401, 'Missing or invalid Bearer token', 'INVALID_BEARER_TOKEN');
  }

  const subjectLegacyUser = await findLegacyUserByPublicUserId(parsedAuth.subjectUserCode);
  if (!subjectLegacyUser) {
    await rejectWithAudit(401, 'Bearer token subject user was not found', 'AUTH_SUBJECT_NOT_FOUND', {
      authMode: parsedAuth.authMode,
      authSubjectUserCode: parsedAuth.subjectUserCode
    });
  }

  const subjectIsAdmin = !!subjectLegacyUser?.isAdmin;
  if (!isLegacyUserEligibleForV2Access(subjectLegacyUser)) {
    await rejectWithAudit(403, 'Bearer token subject user is not active', 'AUTH_SUBJECT_NOT_ACTIVE', {
      authMode: parsedAuth.authMode,
      authSubjectUserCode: parsedAuth.subjectUserCode
    });
  }

  if (requiredRole === 'admin' && !subjectIsAdmin) {
    await rejectWithAudit(403, 'Admin role is required for this endpoint', 'ADMIN_ROLE_REQUIRED', {
      authMode: parsedAuth.authMode,
      authSubjectUserCode: parsedAuth.subjectUserCode
    });
  }

  let effectiveActorUserCode = parsedAuth.subjectUserCode;
  let impersonatedLegacyUser = null;

  if (impersonateUserCode) {
    if (!allowImpersonation) {
      await rejectWithAudit(403, 'Impersonation is not allowed on this endpoint', 'IMPERSONATION_NOT_ALLOWED', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }
    if (!subjectIsAdmin) {
      await rejectWithAudit(403, 'Only admin users may impersonate', 'IMPERSONATION_ADMIN_REQUIRED', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }
    if (!requestId || requestId.length > V2_REQUEST_ID_MAX_LENGTH) {
      await rejectWithAudit(400, `X-Request-Id is required and must be 1-${V2_REQUEST_ID_MAX_LENGTH} chars for impersonation`, 'IMPERSONATION_REQUEST_ID_REQUIRED', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }
    if (!impersonationReason || impersonationReason.length > V2_IMPERSONATION_REASON_MAX_LENGTH) {
      await rejectWithAudit(400, `X-Impersonation-Reason is required and must be 1-${V2_IMPERSONATION_REASON_MAX_LENGTH} chars`, 'IMPERSONATION_REASON_REQUIRED', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }

    const activeSession = await findActiveImpersonationSessionForAdmin(subjectLegacyUser.id);
    if (!activeSession) {
      await rejectWithAudit(403, 'No active impersonation session found for admin user', 'IMPERSONATION_SESSION_NOT_ACTIVE', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }

    impersonatedLegacyUser = await findLegacyUserByPublicUserId(impersonateUserCode);
    if (!impersonatedLegacyUser) {
      await rejectWithAudit(404, 'Impersonated user was not found', 'IMPERSONATED_USER_NOT_FOUND', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }

    if (
      String(activeSession.targetUserId || '') !== String(impersonatedLegacyUser.id)
      || String(activeSession.adminId || '') !== String(subjectLegacyUser.id)
    ) {
      await rejectWithAudit(403, 'Active impersonation session does not match requested impersonated user', 'IMPERSONATION_TARGET_MISMATCH', {
        authMode: parsedAuth.authMode,
        authSubjectUserCode: parsedAuth.subjectUserCode
      });
    }

    effectiveActorUserCode = impersonateUserCode;
  }

  const v2UsersByCode = await loadV2UsersByCodes(
    impersonatedLegacyUser
      ? [parsedAuth.subjectUserCode, effectiveActorUserCode]
      : [parsedAuth.subjectUserCode]
  );

  const subjectV2User = v2UsersByCode.get(parsedAuth.subjectUserCode) || null;
  const effectiveActorV2User = v2UsersByCode.get(effectiveActorUserCode) || subjectV2User;

  await writeV2AuthAuditEvent({
    endpointName,
    requestId,
    idempotencyKey,
    remoteIp,
    authMode: parsedAuth.authMode,
    authSubjectUserCode: parsedAuth.subjectUserCode,
    authSubjectV2UserId: subjectV2User?.id || null,
    authSubjectIsAdmin: subjectIsAdmin,
    effectiveActorUserCode,
    effectiveActorV2UserId: effectiveActorV2User?.id || null,
    isImpersonated: !!impersonatedLegacyUser,
    impersonatorV2UserId: subjectV2User?.id || null,
    impersonatedV2UserId: impersonatedLegacyUser ? (effectiveActorV2User?.id || null) : null,
    impersonationReason,
    result: 'allowed'
  });

  return {
    actorUserCode: effectiveActorUserCode,
    authMode: parsedAuth.authMode,
    authSubjectUserCode: parsedAuth.subjectUserCode,
    authSubjectIsAdmin: subjectIsAdmin,
    isImpersonated: !!impersonatedLegacyUser,
    requestId,
    impersonationReason
  };
}

function normalizeLegacyWalletAmountToCents(amount) {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount)) return 0;
  return Math.max(0, Math.trunc(Math.round(numericAmount * 100)));
}

async function readLegacyWalletForV2Provision(legacyUser, normalizedUserCode) {
  const cachedWalletsRaw = stateSnapshotCache?.snapshot?.state?.mlm_wallets;
  let wallets = [];

  if (typeof cachedWalletsRaw === 'string') {
    const parsed = safeParseJSON(cachedWalletsRaw);
    if (Array.isArray(parsed)) {
      wallets = parsed;
    }
  }

  if (!Array.isArray(wallets) || wallets.length === 0) {
    const walletsRaw = await readStateKeyValue('mlm_wallets');
    const parsed = typeof walletsRaw === 'string' ? safeParseJSON(walletsRaw) : [];
    wallets = Array.isArray(parsed) ? parsed : [];
  }

  const legacyInternalId = String(legacyUser?.id || '').trim();
  return wallets.find((wallet) => String(wallet?.userId || '').trim() === legacyInternalId)
    || wallets.find((wallet) => String(wallet?.userId || '').trim() === normalizedUserCode)
    || null;
}

async function ensureV2ReadUserProvisioned(userCode) {
  if (STORAGE_MODE !== 'mysql' || !pool) return null;

  const normalizedUserCode = normalizeV2UserCode(userCode);
  if (!isValidV2UserCode(normalizedUserCode)) return null;

  const existingUsers = await loadV2UsersByCodes([normalizedUserCode]);
  const existingUser = existingUsers.get(normalizedUserCode) || null;
  if (existingUser) {
    return {
      userId: Number(existingUser.id),
      userCode: normalizedUserCode,
      provisioned: false
    };
  }

  const legacyUser = await findLegacyUserByPublicUserId(normalizedUserCode);
  if (!legacyUser) {
    return null;
  }

  const legacyWallet = await readLegacyWalletForV2Provision(legacyUser, normalizedUserCode);
  const provisionStatus = isLegacyUserEligibleForV2Access(legacyUser) ? 'active' : 'blocked';
  const fullName = String(legacyUser?.fullName || normalizedUserCode).trim().slice(0, 150) || normalizedUserCode;
  const email = String(legacyUser?.email || '').trim().slice(0, 190) || null;
  const legacyUserId = String(legacyUser?.id || '').trim() || null;

  const walletSpecs = [
    { walletType: 'fund', openingCents: normalizeLegacyWalletAmountToCents(legacyWallet?.depositWallet) },
    { walletType: 'income', openingCents: normalizeLegacyWalletAmountToCents(legacyWallet?.incomeWallet) },
    { walletType: 'royalty', openingCents: normalizeLegacyWalletAmountToCents(legacyWallet?.royaltyWallet) }
  ];

  let connection;
  let transactionOpen = false;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const [lockedRows] = await connection.execute(
      `SELECT id, user_code
         FROM v2_users
        WHERE user_code = ?
        LIMIT 1
        FOR UPDATE`,
      [normalizedUserCode]
    );

    let v2User = Array.isArray(lockedRows) && lockedRows.length > 0 ? lockedRows[0] : null;
    if (!v2User) {
      await connection.execute(
        `INSERT INTO v2_users
          (legacy_user_id, user_code, full_name, email, status)
         VALUES
          (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          email = VALUES(email),
          status = VALUES(status),
          updated_at = NOW(3)`,
        [legacyUserId, normalizedUserCode, fullName, email, provisionStatus]
      );

      const [reloadedRows] = await connection.execute(
        `SELECT id, user_code
           FROM v2_users
          WHERE user_code = ?
          LIMIT 1
          FOR UPDATE`,
        [normalizedUserCode]
      );
      v2User = Array.isArray(reloadedRows) && reloadedRows.length > 0 ? reloadedRows[0] : null;
    }

    if (!v2User) {
      throw createApiError(500, 'Failed to provision v2 user for read model recovery', 'V2_PROVISION_USER_LOAD_FAILED');
    }

    const v2UserId = Number(v2User.id);
    for (const walletSpec of walletSpecs) {
      const accountCode = `USR_${normalizedUserCode}_${String(walletSpec.walletType).toUpperCase()}`.slice(0, 80);
      const accountName = `${normalizedUserCode} ${walletSpec.walletType} wallet`.slice(0, 160);

      await connection.execute(
        `INSERT INTO v2_gl_accounts
          (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
         VALUES
          (?, ?, 'LIABILITY', ?, ?, 0, 1)
         ON DUPLICATE KEY UPDATE
          account_name = VALUES(account_name),
          account_type = VALUES(account_type),
          owner_user_id = VALUES(owner_user_id),
          wallet_type = VALUES(wallet_type),
          is_system_account = 0,
          is_active = 1`,
        [accountCode, accountName, v2UserId, walletSpec.walletType]
      );

      const [glRows] = await connection.execute(
        `SELECT id
           FROM v2_gl_accounts
          WHERE account_code = ?
          LIMIT 1
          FOR UPDATE`,
        [accountCode]
      );
      const glAccount = Array.isArray(glRows) && glRows.length > 0 ? glRows[0] : null;
      if (!glAccount) {
        throw createApiError(500, 'Failed to provision user GL account for v2 read model recovery', 'V2_PROVISION_GL_LOAD_FAILED');
      }

      await connection.execute(
        `INSERT INTO v2_wallet_accounts
          (user_id, wallet_type, gl_account_id, baseline_amount_cents, current_amount_cents, currency, version)
         VALUES
          (?, ?, ?, ?, ?, 'INR', 0)
         ON DUPLICATE KEY UPDATE
          gl_account_id = VALUES(gl_account_id),
          updated_at = NOW(3)`,
        [
          v2UserId,
          walletSpec.walletType,
          Number(glAccount.id),
          walletSpec.openingCents,
          walletSpec.openingCents
        ]
      );
    }

    await connection.execute(
      `INSERT INTO v2_help_progress_state
        (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
         next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
       VALUES
        (?, 'BASELINE', 0, 0, 0, 0, 0, NOW(3))
       ON DUPLICATE KEY UPDATE
        user_id = user_id`,
      [v2UserId]
    );

    await connection.commit();
    transactionOpen = false;

    return {
      userId: v2UserId,
      userCode: normalizedUserCode,
      provisioned: true
    };
  } catch (error) {
    if (transactionOpen && connection) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback failures for read-model recovery
      }
    }
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildV2RequestHash(payload) {
  const canonical = stableSerialize(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function createApiError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function parseIdempotencyResponseBody(responseBody) {
  if (!responseBody) return null;
  if (typeof responseBody === 'object') return responseBody;
  if (typeof responseBody !== 'string') return null;
  try {
    return JSON.parse(responseBody);
  } catch {
    return null;
  }
}

function isRetryableV2TransactionError(error) {
  const code = String(error?.code || '').toUpperCase();
  const errno = Number(error?.errno || 0);
  return code === 'ER_LOCK_DEADLOCK'
    || code === 'ER_LOCK_WAIT_TIMEOUT'
    || errno === 1213
    || errno === 1205
    || isMySQLConnectivityError(error);
}

function computeV2TxRetryDelayMs(attemptNo) {
  const exponentialPart = V2_TX_RETRY_BASE_DELAY_MS * Math.max(1, attemptNo);
  const jitterPart = V2_TX_RETRY_JITTER_MS > 0
    ? Math.floor(Math.random() * (V2_TX_RETRY_JITTER_MS + 1))
    : 0;
  return exponentialPart + jitterPart;
}

function waitMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(durationMs)));
  });
}

const V2_READ_RETRY_MAX_ATTEMPTS = 2;
const V2_READ_RETRY_BASE_DELAY_MS = 100;

async function executeV2ReadWithRetry(executor, operationName) {
  let attempt = 0;
  let lastError = null;

  while (attempt < V2_READ_RETRY_MAX_ATTEMPTS) {
    attempt += 1;
    try {
      return await executor();
    } catch (error) {
      lastError = error;
      const shouldRetry = isMySQLConnectivityError(error);
      if (!shouldRetry || attempt >= V2_READ_RETRY_MAX_ATTEMPTS) {
        throw error;
      }

      const waitDurationMs = V2_READ_RETRY_BASE_DELAY_MS * attempt;
      console.warn(`[v2-read-retry] ${operationName} attempt ${attempt}/${V2_READ_RETRY_MAX_ATTEMPTS} failed with ${error?.code || error?.message || 'unknown'}; retrying in ${waitDurationMs}ms`);
      await waitMs(waitDurationMs);
    }
  }

  throw lastError || new Error(`Unexpected retry wrapper exit for ${operationName}`);
}

async function executeV2TransactionWithRetry(executor, operationName) {
  let attempt = 0;
  let lastError = null;
  let retryReason = 'db_lock_contention';

  while (attempt < V2_TX_RETRY_MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const result = await executor();
      if (result && typeof result === 'object' && result.payload && attempt > 1) {
        result.payload.retryAttemptsUsed = attempt - 1;
        result.payload.retryReason = retryReason;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (isMySQLConnectivityError(error)) {
        retryReason = 'db_connectivity';
      }

      if (!isRetryableV2TransactionError(error)) {
        throw error;
      }

      if (attempt >= V2_TX_RETRY_MAX_ATTEMPTS) {
        const exhaustedError = createApiError(
          503,
          `Transaction retry limit exceeded for ${operationName}`,
          'TX_RETRY_EXHAUSTED'
        );
        exhaustedError.causeCode = error?.code || null;
        exhaustedError.causeErrno = Number(error?.errno || 0) || null;
        exhaustedError.retryReason = retryReason;
        throw exhaustedError;
      }

      const waitDurationMs = computeV2TxRetryDelayMs(attempt);
      console.warn(`[v2-retry] ${operationName} attempt ${attempt}/${V2_TX_RETRY_MAX_ATTEMPTS} failed with ${error?.code || error?.message || 'unknown'}; retrying in ${waitDurationMs}ms`);
      await waitMs(waitDurationMs);
    }
  }

  throw lastError || createApiError(500, `Unexpected retry wrapper exit for ${operationName}`, 'TX_RETRY_WRAPPER_ERROR');
}

async function settleRegistrationSideEffects(params) {
  const createdUser = params?.createdUser || null;
  const sponsorUser = params?.sponsorUser || null;
  const pinCode = String(params?.pinCode || '').trim().toUpperCase();
  const sideEffectWarnings = [];
  let referralResult = null;
  let helpEventResult = null;

  if (createdUser?.userId && sponsorUser?.userId) {
    const referralSourceRef = `reg_pin_${createdUser.userId}_${sponsorUser.userId}`;
    const referralIdempotencyKey = `reg_ref_${createdUser.userId}_${sponsorUser.userId}_${pinCode}`.slice(0, 128);
    try {
      const referralOutcome = await executeV2TransactionWithRetry(
        () => processV2ReferralCredit({
          idempotencyKey: referralIdempotencyKey,
          actorUserCode: createdUser.userId,
          sourceUserCode: createdUser.userId,
          beneficiaryUserCode: sponsorUser.userId,
          allowInactiveActor: false,
          sourceRef: referralSourceRef,
          eventType: 'direct_referral',
          levelNo: 1,
          amountCents: 500,
          description: `Referral income from ${createdUser.fullName} (${createdUser.userId})`
        }),
        V2_REFERRAL_CREDIT_ENDPOINT_NAME
      );
      referralResult = referralOutcome?.payload || null;
    } catch (sideEffectError) {
      const warningMessage = getErrorMessage(sideEffectError, 'Failed to settle referral income');
      sideEffectWarnings.push(`Referral settlement pending: ${warningMessage}`);
    }
  }

  if (createdUser?.userId) {
    const helpSourceRef = `reg_help_${createdUser.userId}_${createdUser.userId}`;
    const helpIdempotencyKey = `reg_help_${createdUser.userId}_${pinCode}`.slice(0, 128);
    try {
      const helpOutcome = await executeV2TransactionWithRetry(
        () => processV2HelpEvent({
          idempotencyKey: helpIdempotencyKey,
          actorUserCode: createdUser.userId,
          sourceUserCode: createdUser.userId,
          newMemberUserCode: createdUser.userId,
          sourceRef: helpSourceRef,
          eventType: 'activation_join',
          allowInactiveActor: false,
          description: `Activation help event for ${createdUser.fullName} (${createdUser.userId})`
        }),
        V2_HELP_EVENT_ENDPOINT_NAME
      );
      helpEventResult = helpOutcome?.payload || null;
    } catch (sideEffectError) {
      const warningMessage = getErrorMessage(sideEffectError, 'Failed to settle help event');
      sideEffectWarnings.push(`Help settlement pending: ${warningMessage}`);
    }
  }

  return {
    referralResult,
    helpEventResult,
    sideEffectWarnings
  };
}

function normalizeV2FundTransferProgressUpdates(rawProgressUpdates, senderUserCode, receiverUserCode) {
  if (rawProgressUpdates == null) return { updates: [] };

  if (!Array.isArray(rawProgressUpdates)) {
    return {
      error: 'progressUpdates must be an array when provided',
      code: 'INVALID_PROGRESS_UPDATES'
    };
  }

  if (rawProgressUpdates.length > V2_FUND_TRANSFER_MAX_PROGRESS_UPDATES) {
    return {
      error: `progressUpdates supports at most ${V2_FUND_TRANSFER_MAX_PROGRESS_UPDATES} users per request`,
      code: 'INVALID_PROGRESS_UPDATES'
    };
  }

  const allowedUserCodes = new Set([senderUserCode, receiverUserCode]);
  const seenUserCodes = new Set();
  const normalizedUpdates = [];

  for (const entry of rawProgressUpdates) {
    if (!entry || typeof entry !== 'object') {
      return {
        error: 'Each progressUpdates entry must be an object',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const userCode = normalizeV2UserCode(entry.userCode);
    if (!isValidV2UserCode(userCode)) {
      return {
        error: 'progressUpdates.userCode must be a valid 3-20 chars [a-zA-Z0-9_-]',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }
    if (!allowedUserCodes.has(userCode)) {
      return {
        error: 'progressUpdates.userCode must be one of senderUserCode or receiverUserCode',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }
    if (seenUserCodes.has(userCode)) {
      return {
        error: 'progressUpdates cannot contain duplicate userCode entries',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const eventSeqRaw = Number(entry.eventSeq);
    const eventSeq = Number.isFinite(eventSeqRaw) ? Math.trunc(eventSeqRaw) : NaN;
    if (!Number.isSafeInteger(eventSeq) || eventSeq <= 0) {
      return {
        error: 'progressUpdates.eventSeq must be a positive integer',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const currentStageCode = String(entry.currentStageCode || '').trim();
    if (!currentStageCode || currentStageCode.length > V2_HELP_STAGE_CODE_MAX_LENGTH) {
      return {
        error: `progressUpdates.currentStageCode is required and must be 1-${V2_HELP_STAGE_CODE_MAX_LENGTH} chars`,
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const receiveCountRaw = Number(entry.receiveCountInStage);
    const receiveCountInStage = Number.isFinite(receiveCountRaw) ? Math.trunc(receiveCountRaw) : NaN;
    if (!Number.isSafeInteger(receiveCountInStage) || receiveCountInStage < 0) {
      return {
        error: 'progressUpdates.receiveCountInStage must be an integer >= 0',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const receiveTotalRaw = Number(entry.receiveTotalCentsInStage);
    const receiveTotalCentsInStage = Number.isFinite(receiveTotalRaw) ? Math.trunc(receiveTotalRaw) : NaN;
    if (!Number.isSafeInteger(receiveTotalCentsInStage) || receiveTotalCentsInStage < 0) {
      return {
        error: 'progressUpdates.receiveTotalCentsInStage must be an integer >= 0',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const nextRequiredRaw = Number(entry.nextRequiredGiveCents);
    const nextRequiredGiveCents = Number.isFinite(nextRequiredRaw) ? Math.trunc(nextRequiredRaw) : NaN;
    if (!Number.isSafeInteger(nextRequiredGiveCents) || nextRequiredGiveCents < 0) {
      return {
        error: 'progressUpdates.nextRequiredGiveCents must be an integer >= 0',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    const pendingGiveRaw = Number(entry.pendingGiveCents);
    const pendingGiveCents = Number.isFinite(pendingGiveRaw) ? Math.trunc(pendingGiveRaw) : NaN;
    if (!Number.isSafeInteger(pendingGiveCents) || pendingGiveCents < 0) {
      return {
        error: 'progressUpdates.pendingGiveCents must be an integer >= 0',
        code: 'INVALID_PROGRESS_UPDATES'
      };
    }

    seenUserCodes.add(userCode);
    normalizedUpdates.push({
      userCode,
      eventSeq,
      currentStageCode,
      receiveCountInStage,
      receiveTotalCentsInStage,
      nextRequiredGiveCents,
      pendingGiveCents
    });
  }

  return { updates: normalizedUpdates };
}

async function applyV2HelpProgressUpdates({ connection, helpProgressUpdates, allowedUsersByCode }) {
  if (!Array.isArray(helpProgressUpdates) || helpProgressUpdates.length === 0) {
    return [];
  }

  const orderedUpdates = [...helpProgressUpdates].sort((a, b) => a.userCode.localeCompare(b.userCode));
  const appliedUpdates = [];

  for (const update of orderedUpdates) {
    const allowedUser = allowedUsersByCode.get(update.userCode);
    if (!allowedUser) {
      throw createApiError(400, 'progressUpdates contains userCode outside fund transfer participants', 'INVALID_PROGRESS_USER');
    }

    const [progressRows] = await connection.execute(
      `SELECT user_id, last_progress_event_seq
       FROM v2_help_progress_state
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [allowedUser.userId]
    );

    const existingState = Array.isArray(progressRows) ? progressRows[0] : null;
    if (existingState && Number(existingState.last_progress_event_seq) >= Number(update.eventSeq)) {
      throw createApiError(409, 'progressUpdates.eventSeq must be strictly greater than last_progress_event_seq', 'STALE_PROGRESS_EVENT_SEQ');
    }

    if (existingState) {
      await connection.execute(
        `UPDATE v2_help_progress_state
         SET current_stage_code = ?,
             receive_count_in_stage = ?,
             receive_total_cents_in_stage = ?,
             next_required_give_cents = ?,
             pending_give_cents = ?,
             last_progress_event_seq = ?,
             updated_at = NOW(3)
         WHERE user_id = ?`,
        [
          update.currentStageCode,
          update.receiveCountInStage,
          update.receiveTotalCentsInStage,
          update.nextRequiredGiveCents,
          update.pendingGiveCents,
          update.eventSeq,
          allowedUser.userId
        ]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_help_progress_state
          (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
           next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
        [
          allowedUser.userId,
          update.currentStageCode,
          update.receiveCountInStage,
          update.receiveTotalCentsInStage,
          update.nextRequiredGiveCents,
          update.pendingGiveCents,
          update.eventSeq
        ]
      );
    }

    appliedUpdates.push({ userCode: update.userCode, eventSeq: update.eventSeq });
  }

  return appliedUpdates;
}

function normalizeV2ReadLimit(value, fallback = 100, max = 300) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < 1) return fallback;
  return Math.min(max, normalized);
}

function normalizeV2LedgerEntrySignedAmountCents(entrySide, amountCents) {
  const normalizedAmount = Number.isFinite(Number(amountCents)) ? Math.trunc(Number(amountCents)) : 0;
  if (String(entrySide || '').toLowerCase() === 'debit') {
    return -Math.abs(normalizedAmount);
  }
  return Math.abs(normalizedAmount);
}

function normalizeV2LedgerEntryStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'posted') return 'completed';
  if (normalized === 'reversed') return 'reversed';
  if (normalized === 'void') return 'cancelled';
  return 'pending';
}

async function resolveV2UserForReadByCode(userCode) {
  const normalizedUserCode = normalizeV2UserCode(userCode);
  if (!isValidV2UserCode(normalizedUserCode)) {
    throw createApiError(400, 'userCode is required and must be 3-20 chars [a-zA-Z0-9_-]', 'INVALID_USER_CODE');
  }

  let usersByCode = await loadV2UsersByCodes([normalizedUserCode]);
  let user = usersByCode.get(normalizedUserCode) || null;
  if (!user) {
    const provisionedUser = await ensureV2ReadUserProvisioned(normalizedUserCode);
    if (provisionedUser?.userId) {
      return {
        userId: Number(provisionedUser.userId),
        userCode: normalizedUserCode
      };
    }

    usersByCode = await loadV2UsersByCodes([normalizedUserCode]);
    user = usersByCode.get(normalizedUserCode) || null;
  }

  if (!user) {
    throw createApiError(404, 'Requested user was not found in v2_users', 'V2_USER_NOT_FOUND');
  }

  return {
    userId: Number(user.id),
    userCode: normalizedUserCode
  };
}

async function readV2WalletSnapshotByUserId(userId, userCode = null) {
  const [walletRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT wallet_type, current_amount_cents, updated_at
         FROM v2_wallet_accounts
        WHERE user_id = ?`,
      [userId]
    ),
    'read_v2_wallet_snapshot'
  );

  const [lockRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         COALESCE(SUM(locked_first_two_cents), 0) AS locked_first_two_cents,
         COALESCE(SUM(locked_qualification_cents), 0) AS locked_qualification_cents,
         COALESCE(SUM(pending_give_cents), 0) AS pending_give_cents,
         COALESCE(SUM(CASE WHEN level_no = 1 THEN pending_give_cents ELSE 0 END), 0) AS level1_pending_give_cents,
         COALESCE(SUM(CASE WHEN level_no = 1 THEN given_cents ELSE 0 END), 0) AS level1_given_cents,
         COALESCE(SUM(CASE WHEN level_no <> 1 THEN pending_give_cents ELSE 0 END), 0) AS non_level1_pending_give_cents
       FROM v2_help_level_state
       WHERE user_id = ?`,
      [userId]
    ),
    'read_v2_help_lock_snapshot'
  );

  const [level1DedupedLockedRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT COALESCE(SUM(t.amount_cents), 0) AS level1_deduped_locked_cents
       FROM (
         SELECT source_user_id, MAX(amount_cents) AS amount_cents
         FROM v2_help_pending_contributions
         WHERE beneficiary_user_id = ?
           AND level_no = 1
           AND status = 'processed'
           AND reason = 'locked_for_give'
         GROUP BY source_user_id
       ) t`,
      [userId]
    ),
    'read_v2_help_level1_deduped_locked'
  );

  const [lifetimeRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN le.entry_side = 'credit'
              AND lt.status = 'posted'
              AND (
                (
                  lt.tx_type = 'referral_credit'
                  AND le.wallet_type IN ('income', 'locked_income')
                  AND LOWER(COALESCE(lt.description, '')) NOT LIKE 'released locked receive help%'
                )
                OR (
                  lt.tx_type = 'fund_transfer'
                  AND le.wallet_type = 'income'
                  AND LOWER(COALESCE(lt.description, '')) LIKE '%help%'
                )
                OR (
                  lt.tx_type = 'admin_adjustment'
                  AND le.wallet_type = 'royalty'
                )
              )
             THEN le.amount_cents
             ELSE 0
           END
         ), 0) AS total_received_cents,
         COALESCE(SUM(
           CASE
             WHEN le.entry_side = 'debit'
              AND lt.status = 'posted'
              AND (
                (lt.tx_type = 'referral_credit' AND le.wallet_type IN ('income', 'locked_income'))
                OR (lt.tx_type IN ('fund_transfer', 'withdrawal', 'admin_adjustment') AND le.wallet_type = 'income')
              )
             THEN le.amount_cents
             ELSE 0
           END
         ), 0) AS total_given_cents
       FROM v2_ledger_entries le
       INNER JOIN v2_ledger_transactions lt ON lt.id = le.ledger_txn_id
       WHERE le.user_id = ?`,
      [userId]
    ),
    'read_v2_wallet_lifetime_totals'
  );

  const [syntheticLockedReceiveRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         COALESCE(SUM(pc.amount_cents), 0) AS locked_receive_cents
       FROM v2_help_pending_contributions pc
       LEFT JOIN v2_ledger_entries income_le
         ON income_le.ledger_txn_id = pc.processed_txn_id
        AND income_le.user_id = pc.beneficiary_user_id
        AND income_le.wallet_type = 'income'
        AND income_le.entry_side = 'credit'
       WHERE pc.beneficiary_user_id = ?
         AND pc.status = 'processed'
         AND pc.processed_txn_id IS NOT NULL
         AND pc.reason = 'locked_for_qualification'
         AND income_le.id IS NULL`,
      [userId]
    ),
    'read_v2_wallet_synthetic_locked_receives'
  );

  const [syntheticEarningReceiveRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         COALESCE(SUM(pc.amount_cents), 0) AS synthetic_received_cents
       FROM v2_help_pending_contributions pc
       LEFT JOIN v2_ledger_entries income_le
         ON income_le.ledger_txn_id = pc.processed_txn_id
        AND income_le.user_id = pc.beneficiary_user_id
        AND income_le.wallet_type = 'income'
        AND income_le.entry_side = 'credit'
       WHERE pc.beneficiary_user_id = ?
         AND pc.status = 'processed'
         AND pc.processed_txn_id IS NOT NULL
         AND pc.reason IN ('locked_for_give', 'locked_for_qualification')
         AND income_le.id IS NULL`,
      [userId]
    ),
    'read_v2_wallet_synthetic_earnings'
  );

  const balancesCents = {
    fund: 0,
    income: 0,
    royalty: 0
  };
  let latestUpdatedAt = null;

  for (const row of Array.isArray(walletRows) ? walletRows : []) {
    const walletType = String(row?.wallet_type || '').toLowerCase();
    if (walletType === 'fund' || walletType === 'income' || walletType === 'royalty') {
      balancesCents[walletType] = Number.isFinite(Number(row?.current_amount_cents))
        ? Math.trunc(Number(row.current_amount_cents))
        : 0;
    }
    if (row?.updated_at) {
      const iso = new Date(row.updated_at).toISOString();
      if (!latestUpdatedAt || iso > latestUpdatedAt) latestUpdatedAt = iso;
    }
  }

  const lockRow = Array.isArray(lockRows) && lockRows.length > 0 ? lockRows[0] : null;
  const level1DedupedLockedRow = Array.isArray(level1DedupedLockedRows) && level1DedupedLockedRows.length > 0
    ? level1DedupedLockedRows[0]
    : null;
  const lifetimeRow = Array.isArray(lifetimeRows) && lifetimeRows.length > 0 ? lifetimeRows[0] : null;
  const syntheticLockedReceiveRow = Array.isArray(syntheticLockedReceiveRows) && syntheticLockedReceiveRows.length > 0
    ? syntheticLockedReceiveRows[0]
    : null;
  const syntheticEarningReceiveRow = Array.isArray(syntheticEarningReceiveRows) && syntheticEarningReceiveRows.length > 0
    ? syntheticEarningReceiveRows[0]
    : null;
  const lockedFirstTwoLifetimeCents = Number.isFinite(Number(lockRow?.locked_first_two_cents))
    ? Math.trunc(Number(lockRow.locked_first_two_cents))
    : 0;
  const lockedForQualificationCents = Number.isFinite(Number(lockRow?.locked_qualification_cents))
    ? Math.trunc(Number(lockRow.locked_qualification_cents))
    : 0;
  const pendingGiveCents = Number.isFinite(Number(lockRow?.pending_give_cents))
    ? Math.trunc(Number(lockRow.pending_give_cents))
    : 0;
  const level1PendingGiveCents = Number.isFinite(Number(lockRow?.level1_pending_give_cents))
    ? Math.trunc(Number(lockRow.level1_pending_give_cents))
    : 0;
  const level1GivenCents = Number.isFinite(Number(lockRow?.level1_given_cents))
    ? Math.trunc(Number(lockRow.level1_given_cents))
    : 0;
  const nonLevel1PendingGiveCents = Number.isFinite(Number(lockRow?.non_level1_pending_give_cents))
    ? Math.trunc(Number(lockRow.non_level1_pending_give_cents))
    : 0;
  const level1DedupedLockedCents = Number.isFinite(Number(level1DedupedLockedRow?.level1_deduped_locked_cents))
    ? Math.trunc(Number(level1DedupedLockedRow.level1_deduped_locked_cents))
    : 0;
  const level1SafePendingGiveCents = Math.max(0, level1DedupedLockedCents - level1GivenCents);
  const effectiveLevel1PendingGiveCents = Math.max(0, Math.min(level1PendingGiveCents, level1SafePendingGiveCents));
  const effectivePendingGiveCents = Math.max(0, nonLevel1PendingGiveCents + effectiveLevel1PendingGiveCents);
  const totalReceivedFromLedgerCents = Number.isFinite(Number(lifetimeRow?.total_received_cents))
    ? Math.trunc(Number(lifetimeRow.total_received_cents))
    : 0;
  const totalGivenFromLedgerCents = Number.isFinite(Number(lifetimeRow?.total_given_cents))
    ? Math.trunc(Number(lifetimeRow.total_given_cents))
    : 0;
  const syntheticLockedReceiveCents = Number.isFinite(Number(syntheticLockedReceiveRow?.locked_receive_cents))
    ? Math.trunc(Number(syntheticLockedReceiveRow.locked_receive_cents))
    : 0;
  const syntheticEarningReceiveCents = Number.isFinite(Number(syntheticEarningReceiveRow?.synthetic_received_cents))
    ? Math.trunc(Number(syntheticEarningReceiveRow.synthetic_received_cents))
    : 0;
  const legacyIncomeMetrics = await readLegacyIncomeMetricsByUserCodeWithPool(userCode);
  const legacyIncomeWalletCents = Number(legacyIncomeMetrics.incomeWalletCents || 0);
  const legacyLockedIncomeCents = Number(legacyIncomeMetrics.lockedIncomeCents || 0);
  const legacyTotalReceivedCents = Number(legacyIncomeMetrics.totalReceivedCents || 0);
  const legacyTotalGivenCents = Number(legacyIncomeMetrics.totalGivenCents || 0);
  const hasV2IncomeSignals = Math.max(0, totalReceivedFromLedgerCents) > 0
    || Math.max(0, totalGivenFromLedgerCents) > 0
    || Math.max(0, balancesCents.income) > 0;
  balancesCents.income = resolveEffectiveIncomeWalletCents({
    v2IncomeWalletCents: balancesCents.income,
    legacyIncomeWalletCents,
    hasV2IncomeSignals
  });
  const effectiveLockedForQualificationCents = Math.max(0, Math.max(lockedForQualificationCents, syntheticLockedReceiveCents));
  const lockedForGiveCents = Math.max(0, effectivePendingGiveCents);
  const v2LockedTotalCents = Math.max(0, lockedForGiveCents + effectiveLockedForQualificationCents);
  const hasV2LockSignals =
    lockedForGiveCents > 0
    || effectiveLockedForQualificationCents > 0
    || lockedFirstTwoLifetimeCents > 0;
  const effectiveLockedTotalCents = resolveEffectiveLockedIncomeCents({
    v2LockedIncomeCents: v2LockedTotalCents,
    legacyLockedIncomeCents,
    hasV2LockSignals
  });

  return {
    balancesCents,
    updatedAt: latestUpdatedAt,
    lockedBreakdownCents: {
      totalLockedIncome: effectiveLockedTotalCents,
      lockedForGive: Math.max(0, lockedForGiveCents),
      lockedForQualification: Math.max(0, effectiveLockedForQualificationCents),
      pendingGive: Math.max(0, effectivePendingGiveCents),
      lockedFirstTwoLifetime: Math.max(0, lockedFirstTwoLifetimeCents)
    },
    lifetimeTotalsCents: {
      totalReceived: Math.max(0, Math.max(totalReceivedFromLedgerCents + syntheticEarningReceiveCents, legacyTotalReceivedCents)),
      totalGiven: Math.max(0, Math.max(totalGivenFromLedgerCents, legacyTotalGivenCents))
    }
  };
}

async function readV2LedgerEntriesByUserId(userId, limit = 100) {
  const safeLimit = normalizeV2ReadLimit(limit, 100, 300);
  const [walletRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         le.id AS ledger_entry_id,
         le.wallet_type,
         le.entry_side,
         le.amount_cents,
         lt.id AS ledger_txn_id,
         lt.tx_uuid,
         lt.tx_type,
         lt.status AS ledger_status,
         lt.description,
         lt.reference_id,
         lt.created_at,
         lt.posted_at,
         cp.user_code AS counterparty_user_code
       FROM v2_ledger_entries le
       INNER JOIN v2_ledger_transactions lt ON lt.id = le.ledger_txn_id
       LEFT JOIN v2_ledger_entries cp_le
         ON cp_le.ledger_txn_id = le.ledger_txn_id
        AND cp_le.id <> le.id
        AND cp_le.user_id IS NOT NULL
       LEFT JOIN v2_users cp ON cp.id = cp_le.user_id
       WHERE le.user_id = ?
       ORDER BY lt.id DESC, le.id DESC
       LIMIT ?`,
      [userId, safeLimit]
    ),
    'read_v2_ledger_entries'
  );

  const [lockedReceiveRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         CONCAT('lock_recv_', pc.id) AS ledger_entry_id,
         'locked_income' AS wallet_type,
         'credit' AS entry_side,
         pc.amount_cents,
         lt.id AS ledger_txn_id,
         lt.tx_uuid,
         lt.tx_type,
         lt.status AS ledger_status,
         CASE
           WHEN pc.reason = 'locked_for_give'
             THEN CONCAT('Locked first-two help level ', pc.level_no, ' from ', src.user_code)
           WHEN pc.reason = 'locked_for_qualification'
             THEN CONCAT('Locked receive help level ', pc.level_no, ' from ', src.user_code)
           WHEN pc.reason = 'safety_pool_diversion'
             THEN CONCAT('Safety-pool diverted help level ', pc.level_no, ' from ', src.user_code)
           ELSE CONCAT('Received help level ', pc.level_no, ' from ', src.user_code)
         END AS description,
         lt.reference_id,
         lt.created_at,
         lt.posted_at,
         src.user_code AS counterparty_user_code
       FROM v2_help_pending_contributions pc
       INNER JOIN v2_ledger_transactions lt ON lt.id = pc.processed_txn_id
       INNER JOIN v2_users src ON src.id = pc.source_user_id
       LEFT JOIN v2_ledger_entries income_le
         ON income_le.ledger_txn_id = pc.processed_txn_id
        AND income_le.user_id = pc.beneficiary_user_id
        AND income_le.wallet_type = 'income'
        AND income_le.entry_side = 'credit'
       WHERE pc.beneficiary_user_id = ?
         AND pc.status = 'processed'
         AND pc.processed_txn_id IS NOT NULL
         AND income_le.id IS NULL
       ORDER BY lt.id DESC, pc.id DESC
       LIMIT ?`,
      [userId, safeLimit]
    ),
    'read_v2_locked_help_receives'
  );

  const [lockedGiveRows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         CONCAT('lock_give_', pc.id) AS ledger_entry_id,
         'locked_income' AS wallet_type,
         'debit' AS entry_side,
         pc.amount_cents,
         lt.id AS ledger_txn_id,
         lt.tx_uuid,
         lt.tx_type,
         lt.status AS ledger_status,
         CONCAT('Auto give help level ', pc.level_no, ' from locked income to ', ben.user_code) AS description,
         lt.reference_id,
         lt.created_at,
         lt.posted_at,
         ben.user_code AS counterparty_user_code
       FROM v2_help_pending_contributions pc
       INNER JOIN v2_ledger_transactions lt ON lt.id = pc.processed_txn_id
       INNER JOIN v2_users ben ON ben.id = pc.beneficiary_user_id
       LEFT JOIN v2_ledger_entries src_le
         ON src_le.ledger_txn_id = pc.processed_txn_id
        AND src_le.user_id = pc.source_user_id
        AND src_le.entry_side = 'debit'
       WHERE pc.source_user_id = ?
         AND pc.level_no > 1
         AND pc.status = 'processed'
         AND pc.processed_txn_id IS NOT NULL
         AND src_le.id IS NULL
       ORDER BY lt.id DESC, pc.id DESC
       LIMIT ?`,
      [userId, safeLimit]
    ),
    'read_v2_locked_help_gives'
  );

  const rows = [
    ...(Array.isArray(walletRows) ? walletRows : []),
    ...(Array.isArray(lockedReceiveRows) ? lockedReceiveRows : []),
    ...(Array.isArray(lockedGiveRows) ? lockedGiveRows : [])
  ]
    .sort((left, right) => {
      const rightTs = right?.posted_at ? new Date(right.posted_at).getTime() : new Date(right?.created_at || 0).getTime();
      const leftTs = left?.posted_at ? new Date(left.posted_at).getTime() : new Date(left?.created_at || 0).getTime();
      if (Number.isFinite(rightTs) && Number.isFinite(leftTs) && rightTs !== leftTs) {
        return rightTs - leftTs;
      }

      const rightTxnId = Number(right?.ledger_txn_id || 0);
      const leftTxnId = Number(left?.ledger_txn_id || 0);
      if (rightTxnId !== leftTxnId) {
        return rightTxnId - leftTxnId;
      }

      const rightId = Number(right?.ledger_entry_id || 0);
      const leftId = Number(left?.ledger_entry_id || 0);
      if (Number.isFinite(rightId) && Number.isFinite(leftId) && rightId !== leftId) {
        return rightId - leftId;
      }

      return String(right?.ledger_entry_id || '').localeCompare(String(left?.ledger_entry_id || ''));
    })
    .slice(0, safeLimit);

  return rows.map((row) => {
    const signedAmountCents = normalizeV2LedgerEntrySignedAmountCents(row?.entry_side, row?.amount_cents);
    const createdAt = row?.created_at ? new Date(row.created_at).toISOString() : null;
    const postedAt = row?.posted_at ? new Date(row.posted_at).toISOString() : createdAt;

    return {
      id: String(row?.ledger_entry_id || ''),
      ledgerTransactionId: Number(row?.ledger_txn_id || 0),
      txUuid: String(row?.tx_uuid || ''),
      txType: String(row?.tx_type || ''),
      walletType: String(row?.wallet_type || ''),
      entrySide: String(row?.entry_side || '').toLowerCase(),
      amountCents: Math.abs(Number(signedAmountCents || 0)),
      signedAmountCents,
      status: normalizeV2LedgerEntryStatus(row?.ledger_status),
      description: typeof row?.description === 'string' ? row.description : null,
      referenceId: typeof row?.reference_id === 'string' ? row.reference_id : null,
      counterpartyUserCode: typeof row?.counterparty_user_code === 'string' ? row.counterparty_user_code : null,
      createdAt,
      postedAt
    };
  });
}

async function readV2PinsByUserId(userId, limit = 300) {
  const safeLimit = normalizeV2ReadLimit(limit, 300, 1000);
  const [rows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT
         p.pin_code,
         p.price_cents,
         p.status,
         p.purchased_txn_id,
         p.expires_at,
         lt.created_at,
         lt.posted_at
       FROM v2_pins p
       LEFT JOIN v2_ledger_transactions lt ON lt.id = p.purchased_txn_id
       WHERE p.buyer_user_id = ?
       ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, p.pin_code DESC
       LIMIT ?`,
      [userId, safeLimit]
    ),
    'read_v2_pins'
  );

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const postedAt = row?.posted_at ? new Date(row.posted_at).toISOString() : null;
    const createdAt = row?.created_at ? new Date(row.created_at).toISOString() : null;

    return {
      pinCode: String(row?.pin_code || ''),
      priceCents: Number.isFinite(Number(row?.price_cents)) ? Math.trunc(Number(row.price_cents)) : 0,
      status: String(row?.status || '').toLowerCase(),
      purchasedTxnId: Number.isFinite(Number(row?.purchased_txn_id)) ? Math.trunc(Number(row.purchased_txn_id)) : null,
      purchasedAt: postedAt || createdAt,
      expiresAt: row?.expires_at ? new Date(row.expires_at).toISOString() : null
    };
  });
}

function computeLegacyIncomeMetricsFromStateRows(stateRows, normalizedUserCode) {
  if (!isValidV2UserCode(normalizedUserCode)) {
    return {
      incomeWalletCents: 0,
      lockedIncomeCents: 0,
      totalReceivedCents: 0,
      totalGivenCents: 0
    };
  }

  const stateMap = new Map();
  for (const row of Array.isArray(stateRows) ? stateRows : []) {
    stateMap.set(String(row?.state_key || ''), row?.state_value);
  }

  const usersParsed = safeParseJSON(stateMap.get('mlm_users'));
  const walletsParsed = safeParseJSON(stateMap.get('mlm_wallets'));
  const txParsed = safeParseJSON(stateMap.get('mlm_transactions'));
  const users = Array.isArray(usersParsed) ? usersParsed : [];
  const wallets = Array.isArray(walletsParsed) ? walletsParsed : [];
  const txs = Array.isArray(txParsed) ? txParsed : [];

  const matchingLegacyUserIds = new Set(
    users
      .filter((user) => normalizeV2UserCode(user?.userId) === normalizedUserCode)
      .map((user) => String(user?.id || '').trim())
      .filter(Boolean)
  );

  let lockedIncomeCents = 0;
  let totalReceivedCents = 0;
  let totalGivenCents = 0;
  let incomeWalletCents = 0;

  for (const wallet of wallets) {
    const walletUserId = String(wallet?.userId || '').trim();
    if (!walletUserId) continue;
    if (walletUserId !== normalizedUserCode && !matchingLegacyUserIds.has(walletUserId)) continue;

    const incomeWallet = Number(wallet?.incomeWallet ?? 0);
    const incomeWalletCentsCandidate = Number.isFinite(incomeWallet) ? Math.round(incomeWallet * 100) : 0;
    incomeWalletCents = Math.max(incomeWalletCents, Math.max(0, incomeWalletCentsCandidate));
  }

  for (const tx of txs) {
    const txUserId = String(tx?.userId || '').trim();
    if (!txUserId) continue;
    if (txUserId !== normalizedUserCode && !matchingLegacyUserIds.has(txUserId)) continue;

    const txType = String(tx?.type || '').toLowerCase();
    const txDesc = String(tx?.description || '').toLowerCase();
    const amount = Number(tx?.amount ?? 0);
    const displayAmount = Number(tx?.displayAmount ?? tx?.amount ?? 0);
    const amountCents = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    const displayAmountCents = Number.isFinite(displayAmount) ? Math.round(displayAmount * 100) : amountCents;

    if (txType === 'receive_help') {
      if (txDesc.startsWith('released locked receive help')) {
        lockedIncomeCents = Math.max(0, lockedIncomeCents - Math.abs(displayAmountCents));
      } else if (txDesc.includes('locked first-two help') || txDesc.includes('locked receive help')) {
        lockedIncomeCents += Math.abs(displayAmountCents);
      }
    } else if (txType === 'give_help' && txDesc.includes('from locked income')) {
      lockedIncomeCents = Math.max(0, lockedIncomeCents - Math.abs(amountCents));
    }

    const isNonEarningCreditType = txType === 'activation'
      || txType === 'income_transfer'
      || txType === 'royalty_transfer'
      || txType === 'pin_used'
      || txType === 'pin_purchase'
      || txType === 'pin_transfer'
      || txType === 'deposit'
      || txType === 'p2p_transfer'
      || txType === 'reentry';
    const isIncomeWalletAdminCredit = txType !== 'admin_credit' || txDesc.includes('income wallet');
    const lifetimeCreditCents = txType === 'receive_help' ? Math.abs(displayAmountCents) : amountCents;
    if (lifetimeCreditCents > 0 && !isNonEarningCreditType && isIncomeWalletAdminCredit) {
      totalReceivedCents += lifetimeCreditCents;
    }

    if (amountCents < 0) {
      totalGivenCents += Math.abs(amountCents);
    }
  }

  return {
    incomeWalletCents: Math.max(0, incomeWalletCents),
    lockedIncomeCents: Math.max(0, lockedIncomeCents),
    totalReceivedCents: Math.max(0, totalReceivedCents),
    totalGivenCents: Math.max(0, totalGivenCents)
  };
}

async function readLegacyIncomeMetricsByUserCodeWithPool(userCode) {
  const normalizedUserCode = normalizeV2UserCode(userCode);
  if (!isValidV2UserCode(normalizedUserCode)) {
    return {
      incomeWalletCents: 0,
      lockedIncomeCents: 0,
      totalReceivedCents: 0,
      totalGivenCents: 0
    };
  }

  const [rows] = await executeV2ReadWithRetry(
    () => pool.execute(
      `SELECT state_key, state_value
       FROM state_store
       WHERE state_key IN ('mlm_users', 'mlm_wallets', 'mlm_transactions')`
    ),
    'read_legacy_income_metrics_state'
  );

  return computeLegacyIncomeMetricsFromStateRows(rows, normalizedUserCode);
}

async function readLegacyIncomeMetricsByUserCodeWithConnection(connection, userCode) {
  const normalizedUserCode = normalizeV2UserCode(userCode);
  if (!isValidV2UserCode(normalizedUserCode)) {
    return {
      incomeWalletCents: 0,
      lockedIncomeCents: 0,
      totalReceivedCents: 0,
      totalGivenCents: 0
    };
  }

  const [rows] = await connection.execute(
    `SELECT state_key, state_value
     FROM state_store
      WHERE state_key IN ('mlm_users', 'mlm_wallets', 'mlm_transactions')`
  );

  return computeLegacyIncomeMetricsFromStateRows(rows, normalizedUserCode);
}

function resolveEffectiveLockedIncomeCents({
  v2LockedIncomeCents,
  legacyLockedIncomeCents,
  hasV2LockSignals
}) {
  const v2Locked = Math.max(0, Number(v2LockedIncomeCents || 0));
  const legacyLocked = Math.max(0, Number(legacyLockedIncomeCents || 0));

  // If V2 lock state exists, trust V2 as source-of-truth and avoid stale legacy overhang.
  if (hasV2LockSignals) {
    return v2Locked;
  }

  // Legacy fallback remains only for users not fully represented in V2 lock state yet.
  return Math.max(v2Locked, legacyLocked);
}

function resolveEffectiveIncomeWalletCents({
  v2IncomeWalletCents,
  legacyIncomeWalletCents,
  hasV2IncomeSignals
}) {
  const v2Income = Math.max(0, Number(v2IncomeWalletCents || 0));
  const legacyIncome = Math.max(0, Number(legacyIncomeWalletCents || 0));

  // Once V2 has income activity/signals, treat V2 as source-of-truth.
  // This prevents stale legacy snapshots from making income appear undecremented
  // after valid income->fund transfers.
  if (hasV2IncomeSignals) {
    return v2Income;
  }

  // Legacy fallback remains only for users not represented in V2 income state yet.
  return Math.max(v2Income, legacyIncome);
}

async function readV2LockedIncomeSnapshotForMutation(connection, userId, userCode = null) {
  const [lockRows] = await connection.execute(
    `SELECT
       COALESCE(SUM(locked_qualification_cents), 0) AS locked_qualification_cents,
       COALESCE(SUM(pending_give_cents), 0) AS pending_give_cents,
       COALESCE(SUM(CASE WHEN level_no = 1 THEN pending_give_cents ELSE 0 END), 0) AS level1_pending_give_cents,
       COALESCE(SUM(CASE WHEN level_no = 1 THEN given_cents ELSE 0 END), 0) AS level1_given_cents,
       COALESCE(SUM(CASE WHEN level_no <> 1 THEN pending_give_cents ELSE 0 END), 0) AS non_level1_pending_give_cents
     FROM v2_help_level_state
     WHERE user_id = ?
     FOR UPDATE`,
    [userId]
  );

  const [level1DedupedLockedRows] = await connection.execute(
    `SELECT COALESCE(SUM(t.amount_cents), 0) AS level1_deduped_locked_cents
     FROM (
       SELECT source_user_id, MAX(amount_cents) AS amount_cents
       FROM v2_help_pending_contributions
       WHERE beneficiary_user_id = ?
         AND level_no = 1
         AND status = 'processed'
         AND reason = 'locked_for_give'
       GROUP BY source_user_id
     ) t
     FOR UPDATE`,
    [userId]
  );

  const [syntheticLockedReceiveRows] = await connection.execute(
    `SELECT
       COALESCE(SUM(pc.amount_cents), 0) AS locked_receive_cents
     FROM v2_help_pending_contributions pc
     LEFT JOIN v2_ledger_entries income_le
       ON income_le.ledger_txn_id = pc.processed_txn_id
      AND income_le.user_id = pc.beneficiary_user_id
      AND income_le.wallet_type = 'income'
      AND income_le.entry_side = 'credit'
     WHERE pc.beneficiary_user_id = ?
       AND pc.status = 'processed'
       AND pc.processed_txn_id IS NOT NULL
       AND pc.reason = 'locked_for_qualification'
       AND income_le.id IS NULL
     FOR UPDATE`,
    [userId]
  );

  const lockRow = Array.isArray(lockRows) && lockRows.length > 0 ? lockRows[0] : null;
  const level1DedupedLockedRow = Array.isArray(level1DedupedLockedRows) && level1DedupedLockedRows.length > 0
    ? level1DedupedLockedRows[0]
    : null;
  const syntheticLockedReceiveRow = Array.isArray(syntheticLockedReceiveRows) && syntheticLockedReceiveRows.length > 0
    ? syntheticLockedReceiveRows[0]
    : null;

  const lockedForQualificationCents = Number.isFinite(Number(lockRow?.locked_qualification_cents))
    ? Math.trunc(Number(lockRow.locked_qualification_cents))
    : 0;
  const pendingGiveCents = Number.isFinite(Number(lockRow?.pending_give_cents))
    ? Math.trunc(Number(lockRow.pending_give_cents))
    : 0;
  const level1PendingGiveCents = Number.isFinite(Number(lockRow?.level1_pending_give_cents))
    ? Math.trunc(Number(lockRow.level1_pending_give_cents))
    : 0;
  const level1GivenCents = Number.isFinite(Number(lockRow?.level1_given_cents))
    ? Math.trunc(Number(lockRow.level1_given_cents))
    : 0;
  const nonLevel1PendingGiveCents = Number.isFinite(Number(lockRow?.non_level1_pending_give_cents))
    ? Math.trunc(Number(lockRow.non_level1_pending_give_cents))
    : 0;
  const level1DedupedLockedCents = Number.isFinite(Number(level1DedupedLockedRow?.level1_deduped_locked_cents))
    ? Math.trunc(Number(level1DedupedLockedRow.level1_deduped_locked_cents))
    : 0;
  const level1SafePendingGiveCents = Math.max(0, level1DedupedLockedCents - level1GivenCents);
  const effectiveLevel1PendingGiveCents = Math.max(0, Math.min(level1PendingGiveCents, level1SafePendingGiveCents));
  const effectivePendingGiveCents = Math.max(0, nonLevel1PendingGiveCents + effectiveLevel1PendingGiveCents);
  const syntheticLockedReceiveCents = Number.isFinite(Number(syntheticLockedReceiveRow?.locked_receive_cents))
    ? Math.trunc(Number(syntheticLockedReceiveRow.locked_receive_cents))
    : 0;

  const effectiveLockedForQualificationCents = Math.max(0, Math.max(lockedForQualificationCents, syntheticLockedReceiveCents));
  const lockedForGiveCents = Math.max(0, effectivePendingGiveCents);
  const v2LockedIncomeCents = Math.max(0, lockedForGiveCents + effectiveLockedForQualificationCents);
  const legacyIncomeMetrics = await readLegacyIncomeMetricsByUserCodeWithConnection(connection, userCode);
  const legacyLockedIncomeCents = Number(legacyIncomeMetrics.lockedIncomeCents || 0);
  const hasV2LockSignals = lockedForGiveCents > 0 || effectiveLockedForQualificationCents > 0;
  const totalLockedIncomeCents = resolveEffectiveLockedIncomeCents({
    v2LockedIncomeCents,
    legacyLockedIncomeCents,
    hasV2LockSignals
  });

  return {
    lockedForQualificationCents: effectiveLockedForQualificationCents,
    lockedForGiveCents,
    totalLockedIncomeCents
  };
}

async function processV2FundTransfer({
  idempotencyKey,
  actorUserCode,
  senderUserCode,
  receiverUserCode,
  amountCents,
  sourceWallet = 'fund',
  destinationWallet = 'fund',
  allowInactiveActor = false,
  transactionPassword,
  otp,
  helpProgressUpdates,
  referenceId,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/fund-transfers', 'FINANCE_MODE_MISMATCH');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  const requestHash = buildV2RequestHash({
    endpoint: V2_FUND_TRANSFER_ENDPOINT_NAME,
    actorUserCode,
    senderUserCode,
    receiverUserCode,
    amountCents,
    sourceWallet,
    destinationWallet,
    helpProgressUpdates,
    referenceId,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_FUND_TRANSFER_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_FUND_TRANSFER_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    await validateAndConsumeSensitiveActionCredentials(connection, {
      actorUserCode,
      transactionPassword,
      otp,
      otpPurpose: 'transaction',
      skipValidation: allowInactiveActor
    });

    const [walletRows] = await connection.execute(
      `SELECT
         wa.id,
         wa.user_id,
         wa.wallet_type,
         wa.current_amount_cents,
         wa.gl_account_id,
         u.user_code,
         u.status AS user_status
       FROM v2_wallet_accounts wa
       INNER JOIN v2_users u ON u.id = wa.user_id
       WHERE u.user_code IN (?, ?) AND wa.wallet_type IN (?, ?)
       ORDER BY wa.id
       FOR UPDATE`,
      [senderUserCode, receiverUserCode, sourceWallet, destinationWallet]
    );

    const senderWallet = Array.isArray(walletRows)
      ? walletRows.find((row) => row.user_code === senderUserCode && row.wallet_type === sourceWallet)
      : null;
    const receiverWallet = Array.isArray(walletRows)
      ? walletRows.find((row) => row.user_code === receiverUserCode && row.wallet_type === destinationWallet)
      : null;

    if (!senderWallet || !receiverWallet) {
      throw createApiError(404, 'Sender or receiver wallet is not provisioned in v2', 'V2_WALLET_NOT_FOUND');
    }
    const senderStatusAllowed = senderWallet.user_status === 'active' || (allowInactiveActor && senderWallet.user_code === actorUserCode);
    if (!senderStatusAllowed || receiverWallet.user_status !== 'active') {
      throw createApiError(403, 'Sender or receiver account is not active', 'USER_NOT_ACTIVE');
    }
    if (sourceWallet === 'income') {
      const incomeLockSnapshot = await readV2LockedIncomeSnapshotForMutation(connection, senderWallet.user_id, senderWallet.user_code);
      const spendableIncomeCents = Math.max(0, Number(senderWallet.current_amount_cents) - incomeLockSnapshot.totalLockedIncomeCents);
      if (spendableIncomeCents < amountCents) {
        throw createApiError(
          409,
          'Insufficient spendable income wallet balance (some amount is locked)',
          'INSUFFICIENT_FUNDS'
        );
      }
    } else if (Number(senderWallet.current_amount_cents) < amountCents) {
      throw createApiError(409, `Insufficient ${sourceWallet} wallet balance`, 'INSUFFICIENT_FUNDS');
    }

    const txUuid = randomUUID();
    const reference = referenceId || `${senderUserCode}->${receiverUserCode}`;

    const [ledgerTxnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
         reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES
        (?, 'v2', 'fund_transfer', 'posted', ?, ?,
         'fund_transfer', ?, ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        actor.id,
        String(reference).slice(0, 80),
        description,
        amountCents,
        amountCents
      ]
    );

    const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
    if (!ledgerTxnId) {
      throw createApiError(500, 'Failed to create ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
    }

    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, ?, ?, 'debit', ?),
        (?, 2, ?, ?, ?, 'credit', ?)`,
      [
        ledgerTxnId,
        senderWallet.gl_account_id,
        senderWallet.user_id,
        sourceWallet,
        amountCents,
        ledgerTxnId,
        receiverWallet.gl_account_id,
        receiverWallet.user_id,
        destinationWallet,
        amountCents
      ]
    );

    const [senderUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents - ?, version = version + 1
       WHERE user_id = ? AND wallet_type = ? AND current_amount_cents >= ?`,
      [amountCents, senderWallet.user_id, sourceWallet, amountCents]
    );
    if (Number(senderUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(409, `Insufficient ${sourceWallet} wallet balance`, 'INSUFFICIENT_FUNDS');
    }

    const [receiverUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents + ?, version = version + 1
       WHERE user_id = ? AND wallet_type = ?`,
      [amountCents, receiverWallet.user_id, destinationWallet]
    );
    if (Number(receiverUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(500, 'Failed to credit receiver wallet', 'RECEIVER_WALLET_UPDATE_FAILED');
    }

    const appliedHelpProgressUpdates = await applyV2HelpProgressUpdates({
      connection,
      helpProgressUpdates,
      allowedUsersByCode: new Map([
        [senderUserCode, { userId: senderWallet.user_id }],
        [receiverUserCode, { userId: receiverWallet.user_id }]
      ])
    });

    const responsePayload = {
      ok: true,
      txUuid,
      ledgerTransactionId: ledgerTxnId,
      senderUserCode,
      receiverUserCode,
      sourceWallet,
      destinationWallet,
      amountCents,
      postedAt: new Date().toISOString()
    };

    if (appliedHelpProgressUpdates.length > 0) {
      responsePayload.helpProgress = {
        updatedUsers: appliedHelpProgressUpdates
      };
    }

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    invalidateStateSnapshotCache();
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function processV2WithdrawalDebit({
  idempotencyKey,
  actorUserCode,
  allowInactiveActor = false,
  amountCents,
  transactionPassword,
  otp,
  destinationType,
  destinationRef,
  referenceId,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/withdrawals', 'FINANCE_MODE_MISMATCH');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  const requestHash = buildV2RequestHash({
    endpoint: V2_WITHDRAWAL_ENDPOINT_NAME,
    actorUserCode,
    amountCents,
    destinationType,
    destinationRef,
    referenceId,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_WITHDRAWAL_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_WITHDRAWAL_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    await validateAndConsumeSensitiveActionCredentials(connection, {
      actorUserCode,
      transactionPassword,
      otp,
      otpPurpose: 'withdrawal',
      skipValidation: allowInactiveActor
    });

    const [walletRows] = await connection.execute(
      `SELECT
         wa.id,
         wa.user_id,
         wa.wallet_type,
         wa.current_amount_cents,
         wa.gl_account_id,
         u.user_code,
         u.status AS user_status
       FROM v2_wallet_accounts wa
       INNER JOIN v2_users u ON u.id = wa.user_id
       WHERE u.user_code = ? AND wa.wallet_type = 'income'
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actorIncomeWallet = Array.isArray(walletRows) ? walletRows[0] : null;
    if (!actorIncomeWallet) {
      throw createApiError(404, 'Income wallet is not provisioned in v2', 'V2_INCOME_WALLET_NOT_FOUND');
    }
    if (actorIncomeWallet.user_status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }
    const actorIncomeLockSnapshot = await readV2LockedIncomeSnapshotForMutation(connection, actorIncomeWallet.user_id, actorUserCode);
    const actorSpendableIncomeCents = Math.max(0, Number(actorIncomeWallet.current_amount_cents) - actorIncomeLockSnapshot.totalLockedIncomeCents);
    if (actorSpendableIncomeCents < amountCents) {
      throw createApiError(409, 'Insufficient spendable income wallet balance (some amount is locked)', 'INSUFFICIENT_FUNDS');
    }

    const [settlementRows] = await connection.execute(
      `SELECT id, account_code, is_active
       FROM v2_gl_accounts
       WHERE account_code = 'SYS_CASH_OR_SETTLEMENT'
       LIMIT 1
       FOR UPDATE`
    );
    const settlementAccount = Array.isArray(settlementRows) ? settlementRows[0] : null;
    if (!settlementAccount || Number(settlementAccount.is_active) !== 1) {
      throw createApiError(503, 'System settlement account is not configured', 'SYS_SETTLEMENT_ACCOUNT_MISSING');
    }

    const txUuid = randomUUID();
    const computedReferenceId = referenceId || `${destinationType}:${destinationRef}`;
    const effectiveDescription = description || `Withdrawal to ${destinationType}`;

    const [ledgerTxnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
         reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES
        (?, 'v2', 'withdrawal_debit', 'posted', ?, ?,
         'withdrawal', ?, ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        actor.id,
        String(computedReferenceId).slice(0, 80),
        effectiveDescription,
        amountCents,
        amountCents
      ]
    );

    const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
    if (!ledgerTxnId) {
      throw createApiError(500, 'Failed to create ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
    }

    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, ?, 'income', 'debit', ?),
        (?, 2, ?, NULL, NULL, 'credit', ?)`,
      [
        ledgerTxnId,
        actorIncomeWallet.gl_account_id,
        actorIncomeWallet.user_id,
        amountCents,
        ledgerTxnId,
        settlementAccount.id,
        amountCents
      ]
    );

    const [walletUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents - ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'income' AND current_amount_cents >= ?`,
      [amountCents, actorIncomeWallet.user_id, amountCents]
    );
    if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(409, 'Insufficient income wallet balance', 'INSUFFICIENT_FUNDS');
    }

    const responsePayload = {
      ok: true,
      txUuid,
      ledgerTransactionId: ledgerTxnId,
      actorUserCode,
      amountCents,
      destinationType,
      destinationRef,
      referenceId: String(computedReferenceId).slice(0, 80),
      postedAt: new Date().toISOString()
    };

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    invalidateStateSnapshotCache();
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function processV2PinPurchase({
  idempotencyKey,
  actorUserCode,
  buyerUserCode,
  allowInactiveActor = false,
  quantity,
  pinPriceCents,
  expiresAt,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/pins/purchase', 'FINANCE_MODE_MISMATCH');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  const effectivePinPriceCents = Number.isFinite(pinPriceCents) && pinPriceCents > 0
    ? Math.trunc(pinPriceCents)
    : V2_DEFAULT_PIN_PRICE_CENTS;
  const totalAmountCents = effectivePinPriceCents * quantity;

  if (!Number.isSafeInteger(totalAmountCents) || totalAmountCents <= 0) {
    throw createApiError(400, 'Invalid total amount for pin purchase', 'INVALID_PIN_PURCHASE_AMOUNT');
  }

  const requestHash = buildV2RequestHash({
    endpoint: V2_PIN_PURCHASE_ENDPOINT_NAME,
    actorUserCode,
    buyerUserCode,
    quantity,
    pinPriceCents: effectivePinPriceCents,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }
    if (actorUserCode !== buyerUserCode) {
      throw createApiError(403, 'Actor is only allowed to purchase pins for self', 'ACTOR_BUYER_MISMATCH');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_PIN_PURCHASE_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_PIN_PURCHASE_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    const [walletRows] = await connection.execute(
      `SELECT
         wa.id,
         wa.user_id,
         wa.wallet_type,
         wa.current_amount_cents,
         wa.gl_account_id,
         u.user_code,
         u.status AS user_status
       FROM v2_wallet_accounts wa
       INNER JOIN v2_users u ON u.id = wa.user_id
       WHERE u.user_code = ? AND wa.wallet_type = 'fund'
       LIMIT 1
       FOR UPDATE`,
      [buyerUserCode]
    );
    const buyerFundWallet = Array.isArray(walletRows) ? walletRows[0] : null;
    if (!buyerFundWallet) {
      throw createApiError(404, 'Fund wallet is not provisioned in v2', 'V2_FUND_WALLET_NOT_FOUND');
    }
    if (buyerFundWallet.user_status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Buyer user is not active', 'BUYER_NOT_ACTIVE');
    }
    if (Number(buyerFundWallet.current_amount_cents) < totalAmountCents) {
      throw createApiError(409, 'Insufficient fund wallet balance', 'INSUFFICIENT_FUNDS');
    }

    const [pinRevenueRows] = await connection.execute(
      `SELECT id, account_code, is_active
       FROM v2_gl_accounts
       WHERE account_code = 'SYS_PIN_REVENUE'
       LIMIT 1
       FOR UPDATE`
    );
    const pinRevenueAccount = Array.isArray(pinRevenueRows) ? pinRevenueRows[0] : null;
    if (!pinRevenueAccount || Number(pinRevenueAccount.is_active) !== 1) {
      throw createApiError(503, 'System pin revenue account is not configured', 'SYS_PIN_REVENUE_ACCOUNT_MISSING');
    }

    const txUuid = randomUUID();
    const referenceId = `${buyerUserCode}:${quantity}`;
    const effectiveDescription = description || `Pin purchase (${quantity})`;

    const [ledgerTxnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
         reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES
        (?, 'v2', 'pin_purchase', 'posted', ?, ?,
         'pin_purchase', ?, ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        actor.id,
        referenceId,
        effectiveDescription,
        totalAmountCents,
        totalAmountCents
      ]
    );

    const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
    if (!ledgerTxnId) {
      throw createApiError(500, 'Failed to create ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
    }

    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, ?, 'fund', 'debit', ?),
        (?, 2, ?, NULL, NULL, 'credit', ?)`,
      [
        ledgerTxnId,
        buyerFundWallet.gl_account_id,
        buyerFundWallet.user_id,
        totalAmountCents,
        ledgerTxnId,
        pinRevenueAccount.id,
        totalAmountCents
      ]
    );

    const [walletUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents - ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'fund' AND current_amount_cents >= ?`,
      [totalAmountCents, buyerFundWallet.user_id, totalAmountCents]
    );
    if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(409, 'Insufficient fund wallet balance', 'INSUFFICIENT_FUNDS');
    }

    const generatedPinCodes = [];
    for (let i = 0; i < quantity; i += 1) {
      let created = false;
      let attempts = 0;

      while (!created && attempts < V2_PIN_CODE_MAX_RETRIES_PER_PIN) {
        attempts += 1;
        const pinCode = generateV2PinCode();

        try {
          await connection.execute(
            `INSERT INTO v2_pins
              (pin_code, buyer_user_id, price_cents, status, purchased_txn_id, expires_at)
             VALUES
              (?, ?, ?, 'generated', ?, ?)`,
            [pinCode, buyerFundWallet.user_id, effectivePinPriceCents, ledgerTxnId, expiresAt]
          );
          generatedPinCodes.push(pinCode);
          created = true;
        } catch (pinInsertError) {
          if (pinInsertError?.code === 'ER_DUP_ENTRY') {
            continue;
          }
          throw pinInsertError;
        }
      }

      if (!created) {
        throw createApiError(500, 'Unable to generate unique PIN codes after retries', 'PIN_CODE_GENERATION_FAILED');
      }
    }

    const responsePayload = {
      ok: true,
      txUuid,
      ledgerTransactionId: ledgerTxnId,
      buyerUserCode,
      quantity,
      pinPriceCents: effectivePinPriceCents,
      totalAmountCents,
      pinCodes: generatedPinCodes,
      postedAt: new Date().toISOString()
    };

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function processV2ReferralCredit({
  idempotencyKey,
  actorUserCode,
  sourceUserCode,
  beneficiaryUserCode,
  allowInactiveActor = false,
  sourceTxnId,
  sourceRef = null,
  eventType,
  levelNo,
  amountCents,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/referrals/credit', 'FINANCE_MODE_MISMATCH');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  const hasSourceTxnId = Number.isSafeInteger(sourceTxnId) && sourceTxnId > 0;
  const normalizedSourceRef = typeof sourceRef === 'string' ? sourceRef.trim() : '';
  const hasSourceRef = isValidV2ReferralSourceRef(normalizedSourceRef);

  if (hasSourceTxnId && hasSourceRef) {
    throw createApiError(400, 'sourceTxnId and sourceRef are mutually exclusive', 'REFERRAL_SOURCE_CONFLICT');
  }
  if (!hasSourceTxnId && !hasSourceRef) {
    throw createApiError(400, 'Either sourceTxnId or sourceRef is required', 'REFERRAL_SOURCE_REQUIRED');
  }

  const eventKey = hasSourceTxnId
    ? buildV2ReferralEventKey({
      sourceTxnId,
      beneficiaryUserCode,
      levelNo,
      eventType
    }).slice(0, 140)
    : buildV2ReferralEventKeyFromRef({
      sourceRef: normalizedSourceRef,
      beneficiaryUserCode,
      levelNo,
      eventType
    }).slice(0, 140);

  const requestHash = buildV2RequestHash({
    endpoint: V2_REFERRAL_CREDIT_ENDPOINT_NAME,
    actorUserCode,
    sourceUserCode,
    beneficiaryUserCode,
    sourceTxnId: hasSourceTxnId ? sourceTxnId : null,
    sourceRef: hasSourceRef ? normalizedSourceRef : null,
    eventType,
    levelNo,
    amountCents,
    eventKey,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }
    if (actorUserCode !== sourceUserCode) {
      throw createApiError(403, 'Actor is only allowed to credit referrals from their own sourceUserCode', 'ACTOR_SOURCE_MISMATCH');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_REFERRAL_CREDIT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_REFERRAL_CREDIT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    const [userRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code IN (?, ?)
       ORDER BY id
       FOR UPDATE`,
      [sourceUserCode, beneficiaryUserCode]
    );
    const sourceUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === sourceUserCode)
      : null;
    const beneficiaryUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === beneficiaryUserCode)
      : null;

    if (!sourceUser || !beneficiaryUser) {
      throw createApiError(404, 'Source or beneficiary user is not provisioned in v2_users', 'V2_USER_NOT_FOUND');
    }
    const sourceStatusAllowed = sourceUser.status === 'active' || (allowInactiveActor && sourceUser.user_code === actorUserCode);
    if (!sourceStatusAllowed || beneficiaryUser.status !== 'active') {
      throw createApiError(403, 'Source or beneficiary user is not active', 'USER_NOT_ACTIVE');
    }

    if (hasSourceTxnId) {
      const [sourceTxnRows] = await connection.execute(
        `SELECT id, initiator_user_id
         FROM v2_ledger_transactions
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [sourceTxnId]
      );
      const sourceTxn = Array.isArray(sourceTxnRows) ? sourceTxnRows[0] : null;
      if (!sourceTxn) {
        throw createApiError(404, 'sourceTxnId is not found in v2_ledger_transactions', 'SOURCE_TXN_NOT_FOUND');
      }
      if (Number(sourceTxn.initiator_user_id) !== Number(sourceUser.id)) {
        throw createApiError(409, 'sourceTxnId does not belong to sourceUserCode', 'SOURCE_TXN_USER_MISMATCH');
      }
    }

    await connection.execute(
      `INSERT INTO v2_referral_events
        (event_key, event_type, source_user_id, beneficiary_user_id, source_txn_id, level_no, amount_cents, status)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE id = id`,
      [eventKey, eventType, sourceUser.id, beneficiaryUser.id, hasSourceTxnId ? sourceTxnId : null, levelNo, amountCents]
    );

    const [eventRows] = await connection.execute(
      `SELECT id, event_key, event_type, source_user_id, beneficiary_user_id,
              source_txn_id, level_no, amount_cents, status, credit_txn_id
       FROM v2_referral_events
       WHERE event_key = ?
       LIMIT 1
       FOR UPDATE`,
      [eventKey]
    );
    const referralEvent = Array.isArray(eventRows) ? eventRows[0] : null;
    if (!referralEvent) {
      throw createApiError(500, 'Failed to load referral event', 'REFERRAL_EVENT_LOAD_FAILED');
    }

    const eventMatchesRequest =
      Number(referralEvent.source_user_id) === Number(sourceUser.id)
      && Number(referralEvent.beneficiary_user_id) === Number(beneficiaryUser.id)
      && Number(referralEvent.level_no) === Number(levelNo)
      && String(referralEvent.event_type) === eventType
      && Number(referralEvent.amount_cents) === Number(amountCents)
      && (
        hasSourceTxnId
          ? Number(referralEvent.source_txn_id) === Number(sourceTxnId)
          : (referralEvent.source_txn_id == null)
      );

    if (!eventMatchesRequest) {
      throw createApiError(409, 'Referral event payload mismatches existing deduped event', 'REFERRAL_EVENT_MISMATCH');
    }

    if (referralEvent.status === 'posted') {
      const postedTxnId = Number(referralEvent.credit_txn_id || 0);
      if (!postedTxnId) {
        throw createApiError(409, 'Referral event is posted without linked credit transaction', 'REFERRAL_EVENT_CORRUPT');
      }

      const responsePayload = {
        ok: true,
        eventKey,
        ...(hasSourceTxnId ? { sourceTxnId } : { sourceRef: normalizedSourceRef }),
        sourceUserCode,
        beneficiaryUserCode,
        eventType,
        levelNo,
        amountCents,
        ledgerTransactionId: postedTxnId,
        alreadyPosted: true
      };

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET status = 'completed', response_code = ?, response_body = ?,
             locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [200, JSON.stringify(responsePayload), idempotencyKey]
      );

      await connection.commit();
      transactionOpen = false;
      return { status: 200, payload: responsePayload };
    }

    if (referralEvent.status !== 'pending') {
      throw createApiError(409, 'Referral event is not in a pending state', 'REFERRAL_EVENT_NOT_PENDING');
    }

    const [incomeWalletRows] = await connection.execute(
      `SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
       FROM v2_wallet_accounts
       WHERE user_id = ? AND wallet_type = 'income'
       LIMIT 1
       FOR UPDATE`,
      [beneficiaryUser.id]
    );
    const beneficiaryIncomeWallet = Array.isArray(incomeWalletRows) ? incomeWalletRows[0] : null;
    if (!beneficiaryIncomeWallet) {
      throw createApiError(404, 'Beneficiary income wallet is not provisioned in v2', 'V2_INCOME_WALLET_NOT_FOUND');
    }

    const [referralExpenseRows] = await connection.execute(
      `SELECT id, account_code, is_active
       FROM v2_gl_accounts
       WHERE account_code = 'SYS_REFERRAL_EXPENSE'
       LIMIT 1
       FOR UPDATE`
    );
    const referralExpenseAccount = Array.isArray(referralExpenseRows) ? referralExpenseRows[0] : null;
    if (!referralExpenseAccount || Number(referralExpenseAccount.is_active) !== 1) {
      throw createApiError(503, 'System referral expense account is not configured', 'SYS_REFERRAL_EXPENSE_ACCOUNT_MISSING');
    }

    const txUuid = randomUUID();
    const effectiveDescription = description || `Referral credit (${eventType})`;

    const [ledgerTxnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
         reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES
        (?, 'v2', 'referral_credit', 'posted', ?, ?,
         'referral_event', ?, ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        actor.id,
        eventKey.slice(0, 80),
        effectiveDescription,
        amountCents,
        amountCents
      ]
    );

    const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
    if (!ledgerTxnId) {
      throw createApiError(500, 'Failed to create ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
    }

    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, NULL, NULL, 'debit', ?),
        (?, 2, ?, ?, 'income', 'credit', ?)`,
      [
        ledgerTxnId,
        referralExpenseAccount.id,
        amountCents,
        ledgerTxnId,
        beneficiaryIncomeWallet.gl_account_id,
        beneficiaryIncomeWallet.user_id,
        amountCents
      ]
    );

    const [walletUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents + ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'income'`,
      [amountCents, beneficiaryIncomeWallet.user_id]
    );
    if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(500, 'Failed to credit beneficiary income wallet', 'BENEFICIARY_WALLET_UPDATE_FAILED');
    }

    await connection.execute(
      `UPDATE v2_referral_events
       SET status = 'posted', credit_txn_id = ?, posted_at = NOW(3)
       WHERE event_key = ?`,
      [ledgerTxnId, eventKey]
    );

    const responsePayload = {
      ok: true,
      txUuid,
      eventKey,
      ledgerTransactionId: ledgerTxnId,
      ...(hasSourceTxnId ? { sourceTxnId } : { sourceRef: normalizedSourceRef }),
      sourceUserCode,
      beneficiaryUserCode,
      eventType,
      levelNo,
      amountCents,
      postedAt: new Date().toISOString()
    };

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function ensureV2HelpEventsQueueTable(connection) {
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS v2_help_events_queue (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       event_key VARCHAR(180) NOT NULL,
       event_type VARCHAR(40) NOT NULL,
       source_ref VARCHAR(120) NOT NULL,
       actor_user_id BIGINT UNSIGNED NOT NULL,
       source_user_id BIGINT UNSIGNED NOT NULL,
       new_member_user_id BIGINT UNSIGNED NOT NULL,
       status ENUM('queued','processed','failed') NOT NULL DEFAULT 'queued',
       payload_json JSON NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       processed_at DATETIME(3) NULL,
       UNIQUE KEY uq_v2_help_events_event_key (event_key),
       KEY idx_v2_help_events_status_created (status, created_at),
       CONSTRAINT fk_v2_help_events_actor FOREIGN KEY (actor_user_id) REFERENCES v2_users(id),
       CONSTRAINT fk_v2_help_events_source FOREIGN KEY (source_user_id) REFERENCES v2_users(id),
       CONSTRAINT fk_v2_help_events_member FOREIGN KEY (new_member_user_id) REFERENCES v2_users(id)
     ) ENGINE=InnoDB`
  );
}

async function resolveLegacyImmediateUplineFromMatrix(connection, newMemberUserCode) {
  const normalizedNewMemberUserCode = normalizeV2UserCode(newMemberUserCode);
  if (!isValidV2UserCode(normalizedNewMemberUserCode)) {
    return { parentUserCode: null, side: null };
  }

  const [rows] = await connection.execute(
    `SELECT state_value
     FROM state_store
     WHERE state_key = 'mlm_matrix'
     LIMIT 1`
  );
  const matrixRaw = Array.isArray(rows) && rows[0] ? rows[0].state_value : null;
  const matrix = typeof matrixRaw === 'string' ? safeParseJSON(matrixRaw) : [];
  if (!Array.isArray(matrix)) {
    return { parentUserCode: null, side: null };
  }

  const node = matrix.find((candidate) => normalizeV2UserCode(candidate?.userId) === normalizedNewMemberUserCode);
  if (!node) {
    return { parentUserCode: null, side: null };
  }

  const parentUserCode = normalizeV2UserCode(node?.parentId);
  let side = Number(node?.position) === 0
    ? 'left'
    : Number(node?.position) === 1
      ? 'right'
      : null;

  if (!side && parentUserCode) {
    const parentNode = matrix.find((candidate) => normalizeV2UserCode(candidate?.userId) === parentUserCode);
    if (parentNode) {
      const leftChild = normalizeV2UserCode(parentNode?.leftChild);
      const rightChild = normalizeV2UserCode(parentNode?.rightChild);
      if (leftChild === normalizedNewMemberUserCode) side = 'left';
      if (rightChild === normalizedNewMemberUserCode) side = 'right';
    }
  }

  return {
    parentUserCode: isValidV2UserCode(parentUserCode) ? parentUserCode : null,
    side
  };
}

async function loadSystemGlAccountForUpdate(connection, {
  accountCode,
  accountName,
  accountType
}) {
  await connection.execute(
    `INSERT INTO v2_gl_accounts
      (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
     VALUES
      (?, ?, ?, NULL, NULL, 1, 1)
     ON DUPLICATE KEY UPDATE
      account_name = VALUES(account_name),
      account_type = VALUES(account_type),
      is_system_account = 1,
      is_active = 1`,
    [accountCode, accountName, accountType]
  );

  const [rows] = await connection.execute(
    `SELECT id, account_code, is_active
     FROM v2_gl_accounts
     WHERE account_code = ?
     LIMIT 1
     FOR UPDATE`,
    [accountCode]
  );
  const account = Array.isArray(rows) ? rows[0] : null;
  if (!account || Number(account.is_active) !== 1) {
    throw createApiError(503, `System GL account is not configured: ${accountCode}`, 'SYS_GL_ACCOUNT_MISSING');
  }

  return account;
}

async function lockV2IncomeWalletByUserId(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
     FROM v2_wallet_accounts
     WHERE user_id = ? AND wallet_type = 'income'
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const wallet = Array.isArray(rows) ? rows[0] : null;
  if (!wallet) {
    throw createApiError(404, 'Income wallet is not provisioned in v2', 'V2_INCOME_WALLET_NOT_FOUND');
  }
  return wallet;
}

async function upsertV2HelpReceiveProgress(connection, {
  userId,
  levelNo,
  amountCents
}) {
  const [rows] = await connection.execute(
    `SELECT user_id, receive_count_in_stage, receive_total_cents_in_stage, next_required_give_cents,
            pending_give_cents, last_progress_event_seq
     FROM v2_help_progress_state
     WHERE user_id = ?
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const existing = Array.isArray(rows) ? rows[0] : null;

  const stageCode = buildV2HelpReceiveStageCode(levelNo);

  if (!existing) {
    await connection.execute(
      `INSERT INTO v2_help_progress_state
        (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
         next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
       VALUES
        (?, ?, ?, ?, 0, 0, 1, NOW(3))`,
      [userId, stageCode, 1, amountCents]
    );
    return { eventSeq: 1, stageCode };
  }

  const nextSeq = Number(existing.last_progress_event_seq || 0) + 1;
  const nextReceiveCount = Number(existing.receive_count_in_stage || 0) + 1;
  const nextReceiveTotal = Number(existing.receive_total_cents_in_stage || 0) + amountCents;

  await connection.execute(
    `UPDATE v2_help_progress_state
     SET current_stage_code = ?,
         receive_count_in_stage = ?,
         receive_total_cents_in_stage = ?,
         last_progress_event_seq = ?,
         updated_at = NOW(3)
     WHERE user_id = ?`,
    [stageCode, nextReceiveCount, nextReceiveTotal, nextSeq, userId]
  );

  return { eventSeq: nextSeq, stageCode };
}

async function upsertV2HelpPendingGiveProgress(connection, {
  userId,
  levelNo,
  amountCents
}) {
  const [rows] = await connection.execute(
    `SELECT user_id, receive_count_in_stage, receive_total_cents_in_stage, next_required_give_cents,
            pending_give_cents, last_progress_event_seq
     FROM v2_help_progress_state
     WHERE user_id = ?
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  const existing = Array.isArray(rows) ? rows[0] : null;

  const stageCode = buildV2HelpPendingGiveStageCode(levelNo);

  if (!existing) {
    await connection.execute(
      `INSERT INTO v2_help_progress_state
        (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
         next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
       VALUES
        (?, ?, 0, 0, ?, ?, 1, NOW(3))`,
      [userId, stageCode, amountCents, amountCents]
    );
    return { eventSeq: 1, stageCode };
  }

  const nextSeq = Number(existing.last_progress_event_seq || 0) + 1;
  const nextRequiredGive = Math.max(Number(existing.next_required_give_cents || 0), amountCents);
  const nextPendingGive = Number(existing.pending_give_cents || 0) + amountCents;

  await connection.execute(
    `UPDATE v2_help_progress_state
     SET current_stage_code = ?,
         next_required_give_cents = ?,
         pending_give_cents = ?,
         last_progress_event_seq = ?,
         updated_at = NOW(3)
     WHERE user_id = ?`,
    [stageCode, nextRequiredGive, nextPendingGive, nextSeq, userId]
  );

  return { eventSeq: nextSeq, stageCode };
}

async function ensureV2HelpSettlementTables(connection) {
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS v2_help_level_state (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       user_id BIGINT UNSIGNED NOT NULL,
       level_no SMALLINT UNSIGNED NOT NULL,
       receive_count INT UNSIGNED NOT NULL DEFAULT 0,
       receive_total_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       locked_first_two_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       locked_qualification_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       safety_deducted_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       pending_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       given_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       income_credited_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       last_event_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
       UNIQUE KEY uq_v2_help_level_state_user_level (user_id, level_no),
       KEY idx_v2_help_level_state_level (level_no),
       CONSTRAINT fk_v2_help_level_state_user FOREIGN KEY (user_id) REFERENCES v2_users(id)
     ) ENGINE=InnoDB`
  );

    await connection.execute(
     `ALTER TABLE v2_help_level_state
      ADD COLUMN IF NOT EXISTS locked_qualification_cents BIGINT UNSIGNED NOT NULL DEFAULT 0
      AFTER locked_first_two_cents`
    );
    await connection.execute(
     `ALTER TABLE v2_help_level_state
      ADD COLUMN IF NOT EXISTS safety_deducted_cents BIGINT UNSIGNED NOT NULL DEFAULT 0
      AFTER locked_qualification_cents`
    );

  await connection.execute(
    `CREATE TABLE IF NOT EXISTS v2_help_pending_contributions (
       id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
       source_event_key VARCHAR(180) NOT NULL,
       source_user_id BIGINT UNSIGNED NOT NULL,
       beneficiary_user_id BIGINT UNSIGNED NOT NULL,
       level_no SMALLINT UNSIGNED NOT NULL,
       side ENUM('left','right','unknown') NOT NULL DEFAULT 'unknown',
       amount_cents BIGINT UNSIGNED NOT NULL,
       status ENUM('pending','processed','skipped','failed') NOT NULL DEFAULT 'pending',
       processed_txn_id BIGINT UNSIGNED NULL,
       reason VARCHAR(190) NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       processed_at DATETIME(3) NULL,
       UNIQUE KEY uq_v2_help_pending_dedupe (source_event_key, source_user_id, beneficiary_user_id, level_no, side),
       KEY idx_v2_help_pending_source_status (source_user_id, status, level_no, id),
       KEY idx_v2_help_pending_beneficiary_status (beneficiary_user_id, status, level_no, id),
       CONSTRAINT fk_v2_help_pending_source FOREIGN KEY (source_user_id) REFERENCES v2_users(id),
       CONSTRAINT fk_v2_help_pending_beneficiary FOREIGN KEY (beneficiary_user_id) REFERENCES v2_users(id),
       CONSTRAINT fk_v2_help_pending_txn FOREIGN KEY (processed_txn_id) REFERENCES v2_ledger_transactions(id)
     ) ENGINE=InnoDB`
  );
}

function normalizeV2HelpContributionSide(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'left' || normalized === 'right') return normalized;
  return 'unknown';
}

async function loadLegacyHelpQualificationContext(connection) {
  const [rows] = await connection.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_settings')`
  );

  const rowList = Array.isArray(rows) ? rows : [];
  const byKey = new Map(rowList.map((row) => [String(row.state_key || ''), row.state_value]));
  const legacyUsers = safeParseJSON(byKey.get('mlm_users'));
  const legacySettings = safeParseJSON(byKey.get('mlm_settings'));

  return {
    directCountByUserCode: buildLegacyDirectCountMap(Array.isArray(legacyUsers) ? legacyUsers : []),
    incrementalDirectRequirements: extractIncrementalDirectRequirementsFromLegacySettings(legacySettings, 10)
  };
}

function isV2HelpQualifiedForLevel(qualificationContext, userCode, levelNo) {
  return isV2UserQualifiedForLevel({
    userCode,
    levelNo,
    directCountByUserCode: qualificationContext?.directCountByUserCode,
    incrementalRequirements: qualificationContext?.incrementalDirectRequirements
  });
}

async function buildLegacyActivationContributionPlanFromMatrixState(connection, newMemberUserCode) {
  const normalizedNewMemberUserCode = normalizeV2UserCode(newMemberUserCode);
  if (!isValidV2UserCode(normalizedNewMemberUserCode)) {
    return [];
  }

  const [rows] = await connection.execute(
    `SELECT state_value
     FROM state_store
     WHERE state_key = 'mlm_matrix'
     LIMIT 1`
  );
  const matrixRaw = Array.isArray(rows) && rows[0] ? rows[0].state_value : null;
  const matrix = typeof matrixRaw === 'string' ? safeParseJSON(matrixRaw) : [];
  if (!Array.isArray(matrix) || matrix.length === 0) {
    return [];
  }

  const byUserCode = new Map();
  for (const node of matrix) {
    const userCode = normalizeV2UserCode(node?.userId);
    if (!isValidV2UserCode(userCode)) continue;
    byUserCode.set(userCode, {
      userCode,
      parentUserCode: normalizeV2UserCode(node?.parentId),
      leftChildUserCode: normalizeV2UserCode(node?.leftChild),
      rightChildUserCode: normalizeV2UserCode(node?.rightChild),
      position: Number(node?.position)
    });
  }

  const plan = [];
  let currentChildUserCode = normalizedNewMemberUserCode;
  let currentNode = byUserCode.get(currentChildUserCode) || null;
  let levelNo = 1;

  while (currentNode && levelNo <= 10) {
    const parentUserCode = isValidV2UserCode(currentNode.parentUserCode)
      ? currentNode.parentUserCode
      : null;
    if (!parentUserCode) break;

    const parentNode = byUserCode.get(parentUserCode) || null;
    let side = currentNode.position === 0
      ? 'left'
      : currentNode.position === 1
        ? 'right'
        : 'unknown';

    if (parentNode) {
      if (parentNode.leftChildUserCode === currentChildUserCode) side = 'left';
      else if (parentNode.rightChildUserCode === currentChildUserCode) side = 'right';
    }

    plan.push({
      beneficiaryUserCode: parentUserCode,
      levelNo,
      side: normalizeV2HelpContributionSide(side)
    });

    currentChildUserCode = parentUserCode;
    currentNode = parentNode;
    levelNo += 1;
  }

  return plan;
}

async function resolveV2ImmediateUplineForAutoGive(connection, sourceUserCode) {
  const normalizedSourceUserCode = normalizeV2UserCode(sourceUserCode);
  if (!isValidV2UserCode(normalizedSourceUserCode)) return null;

  const [matrixRows] = await connection.execute(
    `SELECT parent_user_code, position
     FROM v2_matrix_nodes
     WHERE user_code = ?
     LIMIT 1
     FOR UPDATE`,
    [normalizedSourceUserCode]
  );

  const matrixNode = Array.isArray(matrixRows) ? matrixRows[0] : null;
  const parentUserCode = normalizeV2UserCode(matrixNode?.parent_user_code);
  if (!isValidV2UserCode(parentUserCode)) return null;

  const [parentRows] = await connection.execute(
    `SELECT id, user_code, status
     FROM v2_users
     WHERE user_code = ?
     LIMIT 1
     FOR UPDATE`,
    [parentUserCode]
  );

  const parentUser = Array.isArray(parentRows) ? parentRows[0] : null;
  if (!parentUser || String(parentUser.status) !== 'active') return null;

  const position = Number(matrixNode?.position);
  const side = position === 0 ? 'left' : position === 1 ? 'right' : 'unknown';

  return {
    beneficiaryUserId: Number(parentUser.id),
    beneficiaryUserCode: String(parentUser.user_code || parentUserCode),
    side: normalizeV2HelpContributionSide(side)
  };
}

async function ensureV2HelpLevelStateRow(connection, userId, levelNo) {
  await connection.execute(
    `INSERT INTO v2_help_level_state
      (user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
       locked_qualification_cents, safety_deducted_cents,
       pending_give_cents, given_cents, income_credited_cents, last_event_seq)
     VALUES
      (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE id = id`,
    [userId, levelNo]
  );
}

async function lockV2HelpLevelState(connection, userId, levelNo) {
  await ensureV2HelpLevelStateRow(connection, userId, levelNo);
  const [rows] = await connection.execute(
    `SELECT id, user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
            locked_qualification_cents, safety_deducted_cents,
            pending_give_cents, given_cents, income_credited_cents, last_event_seq
     FROM v2_help_level_state
     WHERE user_id = ? AND level_no = ?
     LIMIT 1
     FOR UPDATE`,
    [userId, levelNo]
  );
  const state = Array.isArray(rows) ? rows[0] : null;
  if (!state) {
    throw createApiError(500, 'Failed to lock help level state', 'HELP_LEVEL_STATE_LOCK_FAILED');
  }
  return state;
}

async function consumeV2HelpPendingGiveForContribution(connection, {
  sourceUserId,
  levelNo,
  amountCents
}) {
  if (levelNo <= 1) {
    return {
      consumed: true,
      sourceLevelNo: 0,
      sourceEventSeq: 0,
      pendingGiveRemainingCents: null
    };
  }

  const sourceLevelNo = Math.max(1, levelNo - 1);
  const sourceState = await lockV2HelpLevelState(connection, sourceUserId, sourceLevelNo);
  if (Number(sourceState.pending_give_cents || 0) < amountCents) {
    return {
      consumed: false,
      sourceLevelNo,
      sourceEventSeq: Number(sourceState.last_event_seq || 0),
      pendingGiveRemainingCents: Number(sourceState.pending_give_cents || 0)
    };
  }

  const nextEventSeq = Number(sourceState.last_event_seq || 0) + 1;
  const nextPendingGive = Number(sourceState.pending_give_cents || 0) - amountCents;
  const nextGiven = Number(sourceState.given_cents || 0) + amountCents;

  await connection.execute(
    `UPDATE v2_help_level_state
     SET pending_give_cents = ?,
         given_cents = ?,
         last_event_seq = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [nextPendingGive, nextGiven, nextEventSeq, sourceState.id]
  );

  return {
    consumed: true,
    sourceLevelNo,
    sourceEventSeq: nextEventSeq,
    pendingGiveRemainingCents: nextPendingGive
  };
}

async function createV2HelpLedgerTransaction(connection, {
  idempotencyKey,
  actorUserId,
  eventKey,
  contributionId,
  description,
  amountCents
}) {
  const txUuid = randomUUID();
  const referenceId = `${String(eventKey || '').slice(0, 60)}:${String(contributionId || '').slice(0, 18)}`.slice(0, 80);

  const [ledgerTxnResult] = await connection.execute(
    `INSERT INTO v2_ledger_transactions
      (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
       reference_type, reference_id, description, total_debit_cents, total_credit_cents)
     VALUES
      (?, 'v2', 'referral_credit', 'posted', ?, ?,
       'help_event', ?, ?, ?, ?)`,
    [
      txUuid,
      idempotencyKey,
      actorUserId,
      referenceId,
      description,
      amountCents,
      amountCents
    ]
  );

  const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
  if (!ledgerTxnId) {
    throw createApiError(500, 'Failed to create help settlement ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
  }

  return { txUuid, ledgerTxnId };
}

async function upsertV2HelpPendingContribution(connection, {
  sourceEventKey,
  sourceUserId,
  beneficiaryUserId,
  levelNo,
  side,
  amountCents
}) {
  await connection.execute(
    `INSERT INTO v2_help_pending_contributions
      (source_event_key, source_user_id, beneficiary_user_id, level_no, side, amount_cents, status)
     VALUES
      (?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
      amount_cents = VALUES(amount_cents),
      status = IF(status = 'processed', status, 'pending'),
      reason = IF(status = 'processed', reason, NULL),
      processed_txn_id = IF(status = 'processed', processed_txn_id, NULL),
      processed_at = IF(status = 'processed', processed_at, NULL)`,
    [
      sourceEventKey,
      sourceUserId,
      beneficiaryUserId,
      levelNo,
      normalizeV2HelpContributionSide(side),
      amountCents
    ]
  );
}

async function applyV2HelpContributionSettlement(connection, {
  pendingContribution,
  actorUserId,
  idempotencyKey,
  eventKey,
  helpExpenseAccount,
  settlementAccount,
  safetyPoolAccount,
  qualificationContext,
  usersById
}) {
  const beneficiaryUser = usersById.get(Number(pendingContribution.beneficiary_user_id)) || null;
  const sourceUser = usersById.get(Number(pendingContribution.source_user_id)) || null;
  const sourceLabel = sourceUser ? `${sourceUser.full_name || sourceUser.user_code} (${sourceUser.user_code})` : `User ${pendingContribution.source_user_id}`;

  if (!beneficiaryUser || String(beneficiaryUser.status) !== 'active') {
    const amountCents = Number(pendingContribution.amount_cents);
    const levelNo = Number(pendingContribution.level_no);
    const holdDescription = `Help hold level ${levelNo} from ${sourceLabel} for inactive beneficiary`;
    const { txUuid, ledgerTxnId } = await createV2HelpLedgerTransaction(connection, {
      idempotencyKey,
      actorUserId,
      eventKey,
      contributionId: pendingContribution.id,
      description: holdDescription,
      amountCents
    });

    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, NULL, NULL, 'debit', ?),
        (?, 2, ?, NULL, NULL, 'credit', ?)`,
      [
        ledgerTxnId,
        helpExpenseAccount.id,
        amountCents,
        ledgerTxnId,
        settlementAccount.id,
        amountCents
      ]
    );

    return {
      status: 'processed',
      reason: 'system_hold_beneficiary_inactive',
      settlementMode: 'system_hold',
      ledgerTransactionId: ledgerTxnId,
      txUuid,
      levelNo,
      amountCents,
      beneficiaryUserCode: beneficiaryUser?.user_code || null,
      sourceProgress: null,
      beneficiaryProgress: null,
      unlockedIncomeCents: 0,
      lockedForGiveCents: 0
    };
  }

  const levelNo = Number(pendingContribution.level_no);
  const amountCents = Number(pendingContribution.amount_cents);
  const beneficiaryState = await lockV2HelpLevelState(connection, beneficiaryUser.id, levelNo);
  const decision = computeV2HelpSettlementDecision({
    receiveCountBefore: Number(beneficiaryState.receive_count || 0),
    safetyDeductedCents: Number(beneficiaryState.safety_deducted_cents || 0),
    isQualifiedForLevel: isV2HelpQualifiedForLevel(qualificationContext, beneficiaryUser.user_code, levelNo),
    amountCents,
    lockedQualificationCents: Number(beneficiaryState.locked_qualification_cents || 0)
  });

  const settlementMode = String(decision.mode || 'system_hold');
  const incomeCreditCents = Number(decision.incomeCreditCents || 0);
  const qualificationReleaseCents = Number(decision.qualificationReleaseCents || 0);
  const lockFirstTwoCents = Number(decision.lockFirstTwoCents || 0);
  const lockQualificationCents = Number(decision.lockQualificationCents || 0);
  const divertedSafetyCents = Number(decision.divertedSafetyCents || 0);

  const summaryDescription = settlementMode === 'locked_for_give'
    ? `Locked first-two help level ${levelNo} from ${sourceLabel}`
    : settlementMode === 'locked_for_qualification'
      ? `Locked receive help level ${levelNo} from ${sourceLabel}`
      : settlementMode === 'safety_pool_diversion'
        ? `5th help diversion level ${levelNo} from ${sourceLabel}`
        : qualificationReleaseCents > 0
          ? `Released locked receive + help credit level ${levelNo} from ${sourceLabel}`
          : `Help credit level ${levelNo} from ${sourceLabel}`;
  const ledgerTransactionTotalCents = settlementMode === 'income_credit_with_release'
    ? incomeCreditCents
    : amountCents;

  const { txUuid, ledgerTxnId } = await createV2HelpLedgerTransaction(connection, {
    idempotencyKey,
    actorUserId,
    eventKey,
    contributionId: pendingContribution.id,
    description: summaryDescription,
    amountCents: ledgerTransactionTotalCents
  });

  if (settlementMode === 'locked_for_give' || settlementMode === 'locked_for_qualification') {
    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, NULL, NULL, 'debit', ?),
        (?, 2, ?, NULL, NULL, 'credit', ?)`,
      [
        ledgerTxnId,
        helpExpenseAccount.id,
        amountCents,
        ledgerTxnId,
        settlementAccount.id,
        amountCents
      ]
    );
  } else if (settlementMode === 'safety_pool_diversion') {
    await connection.execute(
      `INSERT INTO v2_ledger_entries
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES
        (?, 1, ?, NULL, NULL, 'debit', ?),
        (?, 2, ?, NULL, NULL, 'credit', ?)`,
      [
        ledgerTxnId,
        helpExpenseAccount.id,
        amountCents,
        ledgerTxnId,
        safetyPoolAccount.id,
        amountCents
      ]
    );
  } else {
    const beneficiaryWallet = await lockV2IncomeWalletByUserId(connection, beneficiaryUser.id);

    if (qualificationReleaseCents > 0) {
      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, NULL, NULL, 'debit', ?),
          (?, 3, ?, ?, 'income', 'credit', ?)`,
        [
          ledgerTxnId,
          helpExpenseAccount.id,
          amountCents,
          ledgerTxnId,
          settlementAccount.id,
          qualificationReleaseCents,
          ledgerTxnId,
          beneficiaryWallet.gl_account_id,
          beneficiaryWallet.user_id,
          incomeCreditCents
        ]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, ?, 'income', 'credit', ?)`,
        [
          ledgerTxnId,
          helpExpenseAccount.id,
          amountCents,
          ledgerTxnId,
          beneficiaryWallet.gl_account_id,
          beneficiaryWallet.user_id,
          incomeCreditCents
        ]
      );
    }

    const [walletUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents + ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'income'`,
      [incomeCreditCents, beneficiaryWallet.user_id]
    );
    if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(500, 'Failed to credit beneficiary income wallet', 'BENEFICIARY_WALLET_UPDATE_FAILED');
    }
  }

  const nextEventSeq = Number(beneficiaryState.last_event_seq || 0) + 1;
  const nextReceiveCount = Number(beneficiaryState.receive_count || 0) + 1;
  const nextReceiveTotal = Number(beneficiaryState.receive_total_cents || 0) + amountCents;
  const nextLockedFirstTwo = Number(beneficiaryState.locked_first_two_cents || 0) + lockFirstTwoCents;
  const nextLockedQualification = Math.max(
    0,
    Number(beneficiaryState.locked_qualification_cents || 0) + lockQualificationCents - qualificationReleaseCents
  );
  const nextSafetyDeducted = Number(beneficiaryState.safety_deducted_cents || 0) + divertedSafetyCents;
  const nextPendingGive = Number(beneficiaryState.pending_give_cents || 0) + lockFirstTwoCents;
  const nextIncomeCredited = Number(beneficiaryState.income_credited_cents || 0) + incomeCreditCents;

  await connection.execute(
    `UPDATE v2_help_level_state
     SET receive_count = ?,
         receive_total_cents = ?,
         locked_first_two_cents = ?,
         locked_qualification_cents = ?,
         safety_deducted_cents = ?,
         pending_give_cents = ?,
         income_credited_cents = ?,
         last_event_seq = ?,
         updated_at = NOW(3)
     WHERE id = ?`,
    [
      nextReceiveCount,
      nextReceiveTotal,
      nextLockedFirstTwo,
      nextLockedQualification,
      nextSafetyDeducted,
      nextPendingGive,
      nextIncomeCredited,
      nextEventSeq,
      beneficiaryState.id
    ]
  );

  let autoGiveEnqueued = null;
  // Aggregate Give Logic: wait for the 2nd receive before sending the total to the upline.
  // This satisfies the user's requirement of 1 aggregated transaction rather than 2 split ones.
  if (settlementMode === 'locked_for_give' && nextReceiveCount === 2 && levelNo < 10) {
    const autoGiveTarget = await resolveV2ImmediateUplineForAutoGive(connection, beneficiaryUser.user_code);
    if (autoGiveTarget?.beneficiaryUserId) {
      const autoGiveEventKey = `AUTO_GIVE:${beneficiaryUser.id}:${levelNo}:AGGREGATE`.slice(0, 180);
      
      // Calculate how much is still needed to reach the target upgrade amount.
      // We explicitly skip the Level 1 "Activation" help currently in given_cents,
      // as Level 1 activation is NOT part of the Level 2 upgrade goal.
      // Target for upgrade help is nextLockedFirstTwo (usually $10).
      
      // We only subtract helps given FOR THE SAME LEVEL or intended for this upgrade.
      const aggregateAmountCents = nextLockedFirstTwo; 
      
      if (aggregateAmountCents > 0) {
        await upsertV2HelpPendingContribution(connection, {
          sourceEventKey: autoGiveEventKey,
          sourceUserId: beneficiaryUser.id,
          beneficiaryUserId: autoGiveTarget.beneficiaryUserId,
          levelNo: levelNo + 1,
          side: autoGiveTarget.side,
          amountCents: aggregateAmountCents
        });

        autoGiveEnqueued = {
          sourceUserCode: beneficiaryUser.user_code,
          beneficiaryUserCode: autoGiveTarget.beneficiaryUserCode,
          levelNo: levelNo + 1,
          amountCents: aggregateAmountCents
        };
      }
    }
  }

  const sourceProgress = await upsertV2HelpPendingGiveProgress(connection, {
    userId: Number(pendingContribution.source_user_id),
    levelNo,
    amountCents
  });
  const beneficiaryProgress = await upsertV2HelpReceiveProgress(connection, {
    userId: beneficiaryUser.id,
    levelNo,
    amountCents
  });

  return {
    status: 'processed',
    reason: settlementMode,
    settlementMode,
    ledgerTransactionId: ledgerTxnId,
    txUuid,
    levelNo,
    amountCents,
    beneficiaryUserCode: beneficiaryUser.user_code,
    sourceProgress,
    beneficiaryProgress,
    unlockedIncomeCents: incomeCreditCents,
    lockedForGiveCents: lockFirstTwoCents,
    autoGiveEnqueued,
    lockedForQualificationCents: lockQualificationCents,
    releasedQualificationCents: qualificationReleaseCents,
    divertedSafetyCents
  };
}

async function releaseV2QualifiedLockedReceiveBalances(connection, {
  candidateUserIds,
  usersById,
  actorUserId,
  idempotencyKey,
  eventKey,
  settlementAccount,
  qualificationContext
}) {
  const userIds = [...new Set(
    (Array.isArray(candidateUserIds) ? candidateUserIds : [])
      .map((value) => Number(value || 0))
      .filter((value) => value > 0)
  )];

  if (userIds.length === 0) {
    return { processed: [], skipped: [] };
  }

  const processed = [];
  const skipped = [];

  for (const userId of userIds) {
    let user = usersById.get(userId) || null;
    if (!user) {
      const [userRows] = await connection.execute(
        `SELECT id, user_code, status
         FROM v2_users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [userId]
      );
      user = Array.isArray(userRows) ? userRows[0] : null;
      if (user) usersById.set(Number(user.id), user);
    }
    if (!user || String(user.status) !== 'active') continue;

    const [stateRows] = await connection.execute(
      `SELECT id, level_no, locked_qualification_cents, income_credited_cents, last_event_seq
       FROM v2_help_level_state
       WHERE user_id = ? AND locked_qualification_cents > 0
       ORDER BY level_no ASC
       FOR UPDATE`,
      [userId]
    );

    const states = Array.isArray(stateRows) ? stateRows : [];
    for (const state of states) {
      const levelNo = Number(state.level_no || 0);
      const lockedAmountCents = Number(state.locked_qualification_cents || 0);
      if (levelNo <= 0 || lockedAmountCents <= 0) continue;

      const isQualified = isV2HelpQualifiedForLevel(qualificationContext, user.user_code, levelNo);
      if (!isQualified) {
        skipped.push({
          contributionId: `locked_release_${userId}_${levelNo}`,
          sourceUserId: null,
          beneficiaryUserId: userId,
          levelNo,
          amountCents: lockedAmountCents,
          side: 'unknown',
          reason: 'not_qualified'
        });
        continue;
      }

      const beneficiaryWallet = await lockV2IncomeWalletByUserId(connection, userId);
      const { txUuid, ledgerTxnId } = await createV2HelpLedgerTransaction(connection, {
        idempotencyKey,
        actorUserId,
        eventKey,
        contributionId: `release_${userId}_${levelNo}`,
        description: `Released locked receive help level ${levelNo} for ${user.user_code}`,
        amountCents: lockedAmountCents
      });

      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, ?, 'income', 'credit', ?)`,
        [
          ledgerTxnId,
          settlementAccount.id,
          lockedAmountCents,
          ledgerTxnId,
          beneficiaryWallet.gl_account_id,
          beneficiaryWallet.user_id,
          lockedAmountCents
        ]
      );

      const [walletUpdateResult] = await connection.execute(
        `UPDATE v2_wallet_accounts
         SET current_amount_cents = current_amount_cents + ?, version = version + 1
         WHERE user_id = ? AND wallet_type = 'income'`,
        [lockedAmountCents, userId]
      );
      if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
        throw createApiError(500, 'Failed to credit released locked receive amount', 'LOCKED_RECEIVE_RELEASE_WALLET_UPDATE_FAILED');
      }

      await connection.execute(
        `UPDATE v2_help_level_state
         SET locked_qualification_cents = 0,
             income_credited_cents = income_credited_cents + ?,
             last_event_seq = ?,
             updated_at = NOW(3)
         WHERE id = ?`,
        [
          lockedAmountCents,
          Number(state.last_event_seq || 0) + 1,
          state.id
        ]
      );

      const beneficiaryProgress = await upsertV2HelpReceiveProgress(connection, {
        userId,
        levelNo,
        amountCents: lockedAmountCents
      });

      processed.push({
        contributionId: `locked_release_${userId}_${levelNo}`,
        sourceUserId: null,
        beneficiaryUserId: userId,
        beneficiaryUserCode: user.user_code,
        levelNo,
        amountCents: lockedAmountCents,
        side: 'unknown',
        settlementMode: 'released_locked_receive',
        ledgerTransactionId: ledgerTxnId,
        txUuid,
        sourceProgress: null,
        beneficiaryProgress
      });
    }
  }

  return { processed, skipped };
}

async function processV2HelpContributionCascade(connection, {
  seedSourceUserIds,
  usersById,
  actorUserId,
  idempotencyKey,
  eventKey,
  helpExpenseAccount,
  settlementAccount,
  safetyPoolAccount,
  qualificationContext
}) {
  const queue = [];
  const queued = new Set();
  for (const sourceUserId of seedSourceUserIds) {
    const normalized = Number(sourceUserId || 0);
    if (!normalized || queued.has(normalized)) continue;
    queue.push(normalized);
    queued.add(normalized);
  }

  const processed = [];
  const skipped = [];
  let guard = 0;

  while (queue.length > 0 && guard < 500) {
    guard += 1;
    const sourceUserId = Number(queue.shift() || 0);
    if (!sourceUserId) continue;

    const [pendingRows] = await connection.execute(
      `SELECT id, source_event_key, source_user_id, beneficiary_user_id, level_no, side, amount_cents,
              status, processed_txn_id, reason, created_at
       FROM v2_help_pending_contributions
       WHERE source_user_id = ? AND status = 'pending'
       ORDER BY level_no ASC, id ASC
       FOR UPDATE`,
      [sourceUserId]
    );

    const pendingList = Array.isArray(pendingRows) ? pendingRows : [];
    for (const pendingContribution of pendingList) {
      const levelNo = Number(pendingContribution.level_no || 0);
      const amountCents = Number(pendingContribution.amount_cents || 0);

      const consumption = await consumeV2HelpPendingGiveForContribution(connection, {
        sourceUserId,
        levelNo,
        amountCents
      });
      if (!consumption.consumed) {
        continue;
      }

      const claimed = await claimPendingContributionForProcessing(connection, {
        pendingContributionId: pendingContribution.id,
        claimToken: `${eventKey}:${sourceUserId}`
      });
      if (!claimed) {
        skipped.push({
          contributionId: Number(pendingContribution.id),
          sourceUserId,
          beneficiaryUserId: Number(pendingContribution.beneficiary_user_id),
          levelNo,
          amountCents,
          side: String(pendingContribution.side || 'unknown'),
          reason: 'claim_conflict'
        });
        continue;
      }

      const settlement = await applyV2HelpContributionSettlement(connection, {
        pendingContribution,
        actorUserId,
        idempotencyKey,
        eventKey,
        helpExpenseAccount,
        settlementAccount,
        safetyPoolAccount,
        qualificationContext,
        usersById
      });

      if (settlement.status === 'processed') {
        await connection.execute(
          `UPDATE v2_help_pending_contributions
           SET status = 'processed', processed_txn_id = ?, reason = ?, processed_at = NOW(3)
           WHERE id = ?`,
          [settlement.ledgerTransactionId, settlement.reason, pendingContribution.id]
        );

        processed.push({
          contributionId: Number(pendingContribution.id),
          sourceUserId,
          beneficiaryUserId: Number(pendingContribution.beneficiary_user_id),
          beneficiaryUserCode: settlement.beneficiaryUserCode,
          levelNo,
          amountCents,
          side: String(pendingContribution.side || 'unknown'),
          settlementMode: settlement.settlementMode,
          ledgerTransactionId: settlement.ledgerTransactionId,
          txUuid: settlement.txUuid,
          sourceProgress: settlement.sourceProgress,
          beneficiaryProgress: settlement.beneficiaryProgress
        });

        if (settlement.lockedForGiveCents > 0) {
          const beneficiaryUserId = Number(pendingContribution.beneficiary_user_id || 0);
          if (beneficiaryUserId && !queued.has(beneficiaryUserId)) {
            queue.push(beneficiaryUserId);
            queued.add(beneficiaryUserId);
          }
        }
      } else {
        await connection.execute(
          `UPDATE v2_help_pending_contributions
           SET status = 'skipped', reason = ?, processed_at = NOW(3)
           WHERE id = ?`,
          [settlement.reason || 'skipped', pendingContribution.id]
        );

        skipped.push({
          contributionId: Number(pendingContribution.id),
          sourceUserId,
          beneficiaryUserId: Number(pendingContribution.beneficiary_user_id),
          levelNo,
          amountCents,
          side: String(pendingContribution.side || 'unknown'),
          reason: settlement.reason || 'skipped'
        });
      }
    }
  }

  return {
    processed,
    skipped,
    guardTrips: guard
  };
}

async function processV2HelpEvent({
  idempotencyKey,
  actorUserCode,
  sourceUserCode,
  newMemberUserCode,
  sourceRef,
  eventType,
  allowInactiveActor = false,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/help-events', 'FINANCE_MODE_MISMATCH');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  const normalizedSourceRef = String(sourceRef || '').trim();
  if (!isValidV2HelpEventSourceRef(normalizedSourceRef)) {
    throw createApiError(400, `sourceRef must be 1-${V2_HELP_EVENT_SOURCE_REF_MAX_LENGTH} chars [a-zA-Z0-9:_-]`, 'INVALID_SOURCE_REF');
  }
  const levelNo = 1;
  const settlementAmountCents = V2_HELP_LEVEL1_AMOUNT_CENTS;

  const eventKey = buildV2HelpEventKey({
    sourceRef: normalizedSourceRef,
    sourceUserCode,
    newMemberUserCode,
    eventType
  }).slice(0, 180);

  const requestHash = buildV2RequestHash({
    endpoint: V2_HELP_EVENT_ENDPOINT_NAME,
    actorUserCode,
    sourceUserCode,
    newMemberUserCode,
    eventType,
    sourceRef: normalizedSourceRef,
    eventKey,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active' && !allowInactiveActor) {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }
    if (actorUserCode !== sourceUserCode) {
      throw createApiError(403, 'Actor is only allowed to submit help events from their own sourceUserCode', 'ACTOR_SOURCE_MISMATCH');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_HELP_EVENT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_HELP_EVENT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    const [userRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code IN (?, ?)
       ORDER BY id
       FOR UPDATE`,
      [sourceUserCode, newMemberUserCode]
    );
    const sourceUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === sourceUserCode)
      : null;
    const newMemberUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === newMemberUserCode)
      : null;

    if (!sourceUser || !newMemberUser) {
      throw createApiError(404, 'Source user or new member user is not provisioned in v2_users', 'V2_USER_NOT_FOUND');
    }

    const sourceStatusAllowed = sourceUser.status === 'active' || (allowInactiveActor && sourceUser.user_code === actorUserCode);
    if (!sourceStatusAllowed || newMemberUser.status !== 'active') {
      throw createApiError(403, 'Source user or new member user is not active', 'USER_NOT_ACTIVE');
    }

    await ensureV2HelpEventsQueueTable(connection);

    const [existingMemberEventRows] = await connection.execute(
      `SELECT id, event_key, status, created_at, processed_at, payload_json
       FROM v2_help_events_queue
       WHERE source_user_id = ?
         AND new_member_user_id = ?
         AND event_type = ?
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`,
      [sourceUser.id, newMemberUser.id, eventType]
    );
    const existingMemberEvent = Array.isArray(existingMemberEventRows) ? existingMemberEventRows[0] : null;

    if (existingMemberEvent && String(existingMemberEvent.event_key || '') !== eventKey) {
      if (String(existingMemberEvent.status || '') === 'processed') {
        const storedPayload = parseIdempotencyResponseBody(existingMemberEvent.payload_json) || {};
        const replayPayload = (storedPayload && typeof storedPayload === 'object' && storedPayload.result)
          ? {
            ...storedPayload.result,
            idempotentReplay: true,
            duplicateSuppressed: true,
            originalEventKey: String(existingMemberEvent.event_key || ''),
            suppressedEventKey: eventKey
          }
          : {
            ok: true,
            queueEventId: Number(existingMemberEvent.id),
            eventKey: String(existingMemberEvent.event_key || ''),
            eventType,
            sourceRef: normalizedSourceRef,
            sourceUserCode,
            newMemberUserCode,
            queueStatus: 'processed',
            queuedAt: existingMemberEvent.created_at ? new Date(existingMemberEvent.created_at).toISOString() : new Date().toISOString(),
            processedAt: existingMemberEvent.processed_at ? new Date(existingMemberEvent.processed_at).toISOString() : new Date().toISOString(),
            alreadyProcessed: true,
            idempotentReplay: true,
            duplicateSuppressed: true,
            originalEventKey: String(existingMemberEvent.event_key || ''),
            suppressedEventKey: eventKey
          };

        await connection.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'completed', response_code = ?, response_body = ?,
               locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [200, JSON.stringify(replayPayload), idempotencyKey]
        );

        await connection.commit();
        transactionOpen = false;
        return { status: 200, payload: replayPayload };
      }

      throw createApiError(
        409,
        'Activation help event already exists for this member and source user',
        'HELP_EVENT_DUPLICATE_MEMBER_ACTIVATION'
      );
    }

    const eventPayload = {
      sourceUserCode,
      newMemberUserCode,
      sourceRef: normalizedSourceRef,
      eventType,
      description: description || null
    };
    const payloadJson = JSON.stringify(eventPayload);

    await connection.execute(
      `INSERT INTO v2_help_events_queue
        (event_key, event_type, source_ref, actor_user_id, source_user_id, new_member_user_id, status, payload_json)
       VALUES
        (?, ?, ?, ?, ?, ?, 'queued', ?)
       ON DUPLICATE KEY UPDATE
         source_ref = VALUES(source_ref),
         actor_user_id = VALUES(actor_user_id),
         source_user_id = VALUES(source_user_id),
         new_member_user_id = VALUES(new_member_user_id),
         status = IF(status = 'failed', 'queued', status),
         processed_at = IF(status = 'failed', NULL, processed_at),
         payload_json = VALUES(payload_json)`,
      [eventKey, eventType, normalizedSourceRef, actor.id, sourceUser.id, newMemberUser.id, payloadJson]
    );

    const [eventRows] = await connection.execute(
      `SELECT id, event_key, status, created_at, processed_at, payload_json
       FROM v2_help_events_queue
       WHERE event_key = ?
       LIMIT 1
       FOR UPDATE`,
      [eventKey]
    );
    const helpEvent = Array.isArray(eventRows) ? eventRows[0] : null;
    if (!helpEvent) {
      throw createApiError(500, 'Failed to queue help event', 'HELP_EVENT_QUEUE_FAILED');
    }

    if (String(helpEvent.status) === 'processed') {
      const storedPayload = parseIdempotencyResponseBody(helpEvent.payload_json) || {};
      const replayPayload = (storedPayload && typeof storedPayload === 'object' && storedPayload.result)
        ? storedPayload.result
        : {
          ok: true,
          queueEventId: Number(helpEvent.id),
          eventKey,
          eventType,
          sourceRef: normalizedSourceRef,
          sourceUserCode,
          newMemberUserCode,
          queueStatus: 'processed',
          queuedAt: helpEvent.created_at ? new Date(helpEvent.created_at).toISOString() : new Date().toISOString(),
          processedAt: helpEvent.processed_at ? new Date(helpEvent.processed_at).toISOString() : new Date().toISOString(),
          alreadyProcessed: true
        };

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET status = 'completed', response_code = ?, response_body = ?,
             locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [200, JSON.stringify(replayPayload), idempotencyKey]
      );

      await connection.commit();
      transactionOpen = false;
      return { status: 200, payload: replayPayload };
    }

    await ensureV2HelpSettlementTables(connection);

    const contributionPlan = await buildLegacyActivationContributionPlanFromMatrixState(connection, newMemberUserCode);
    const immediateContribution = contributionPlan.find((step) => Number(step.levelNo) === 1) || null;
    const immediateUplineUserCode = immediateContribution?.beneficiaryUserCode || null;
    const immediateUplineSide = immediateContribution?.side || null;

    const beneficiaryUserCodes = [...new Set(
      contributionPlan
        .map((step) => normalizeV2UserCode(step?.beneficiaryUserCode))
        .filter((userCode) => isValidV2UserCode(userCode))
    )];

    const beneficiariesByCode = new Map();
    if (beneficiaryUserCodes.length > 0) {
      const placeholders = beneficiaryUserCodes.map(() => '?').join(', ');
      const [beneficiaryRows] = await connection.execute(
        `SELECT id, user_code, status
         FROM v2_users
         WHERE user_code IN (${placeholders})
         ORDER BY id
         FOR UPDATE`,
        beneficiaryUserCodes
      );
      for (const row of Array.isArray(beneficiaryRows) ? beneficiaryRows : []) {
        beneficiariesByCode.set(String(row.user_code), row);
      }
    }

    const usersById = new Map([
      [Number(sourceUser.id), sourceUser],
      [Number(newMemberUser.id), newMemberUser]
    ]);
    for (const beneficiary of beneficiariesByCode.values()) {
      usersById.set(Number(beneficiary.id), beneficiary);
    }

    const helpExpenseAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: V2_HELP_EXPENSE_ACCOUNT_CODE,
      accountName: 'System help settlement expense',
      accountType: 'EXPENSE'
    });
    const settlementAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: V2_HELP_SETTLEMENT_ACCOUNT_CODE,
      accountName: 'System cash or settlement',
      accountType: 'ASSET'
    });
    const safetyPoolAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: V2_HELP_SAFETY_POOL_ACCOUNT_CODE,
      accountName: 'System help safety pool',
      accountType: 'LIABILITY'
    });
    const qualificationContext = await loadLegacyHelpQualificationContext(connection);

    const processedContributions = [];
    const skippedContributions = [];

    if (contributionPlan.length === 0) {
      const { txUuid, ledgerTxnId } = await createV2HelpLedgerTransaction(connection, {
        idempotencyKey,
        actorUserId: actor.id,
        eventKey,
        contributionId: 'no_upline',
        description: `Help hold level 1 for ${newMemberUserCode} (no upline)` ,
        amountCents: settlementAmountCents
      });

      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, NULL, NULL, 'credit', ?)`,
        [
          ledgerTxnId,
          helpExpenseAccount.id,
          settlementAmountCents,
          ledgerTxnId,
          settlementAccount.id,
          settlementAmountCents
        ]
      );

      processedContributions.push({
        contributionId: 'no_upline',
        sourceUserId: Number(sourceUser.id),
        beneficiaryUserId: null,
        beneficiaryUserCode: null,
        levelNo: 1,
        amountCents: settlementAmountCents,
        side: 'unknown',
        settlementMode: 'system_hold_no_upline',
        ledgerTransactionId: ledgerTxnId,
        txUuid,
        sourceProgress: null,
        beneficiaryProgress: null
      });
    } else {
      for (const planItem of contributionPlan) {
        const beneficiary = beneficiariesByCode.get(planItem.beneficiaryUserCode) || null;
        if (!beneficiary) {
          const { txUuid, ledgerTxnId } = await createV2HelpLedgerTransaction(connection, {
            idempotencyKey,
            actorUserId: actor.id,
            eventKey,
            contributionId: `missing_${planItem.levelNo}_${planItem.beneficiaryUserCode}`,
            description: `Help hold level ${planItem.levelNo} for missing beneficiary`,
            amountCents: settlementAmountCents
          });

          await connection.execute(
            `INSERT INTO v2_ledger_entries
              (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
             VALUES
              (?, 1, ?, NULL, NULL, 'debit', ?),
              (?, 2, ?, NULL, NULL, 'credit', ?)`,
            [
              ledgerTxnId,
              helpExpenseAccount.id,
              settlementAmountCents,
              ledgerTxnId,
              settlementAccount.id,
              settlementAmountCents
            ]
          );

          processedContributions.push({
            contributionId: `missing_${planItem.levelNo}_${planItem.beneficiaryUserCode}`,
            sourceUserId: Number(sourceUser.id),
            beneficiaryUserId: null,
            beneficiaryUserCode: planItem.beneficiaryUserCode,
            levelNo: Number(planItem.levelNo),
            amountCents: settlementAmountCents,
            side: normalizeV2HelpContributionSide(planItem.side),
            settlementMode: 'system_hold_missing_beneficiary',
            ledgerTransactionId: ledgerTxnId,
            txUuid,
            sourceProgress: null,
            beneficiaryProgress: null
          });
          continue;
        }

        await upsertV2HelpPendingContribution(connection, {
          sourceEventKey: eventKey,
          sourceUserId: sourceUser.id,
          beneficiaryUserId: beneficiary.id,
          levelNo: Number(planItem.levelNo),
          side: normalizeV2HelpContributionSide(planItem.side),
          amountCents: settlementAmountCents
        });
      }

      const cascadeResult = await processV2HelpContributionCascade(connection, {
        seedSourceUserIds: [sourceUser.id],
        usersById,
        actorUserId: actor.id,
        idempotencyKey,
        eventKey,
        helpExpenseAccount,
        settlementAccount,
        safetyPoolAccount,
        qualificationContext
      });

      processedContributions.push(...cascadeResult.processed);
      skippedContributions.push(...cascadeResult.skipped);
    }

    const releaseResult = await releaseV2QualifiedLockedReceiveBalances(connection, {
      candidateUserIds: [
        Number(sourceUser.id),
        ...Array.from(beneficiariesByCode.values()).map((row) => Number(row.id || 0))
      ],
      usersById,
      actorUserId: actor.id,
      idempotencyKey,
      eventKey,
      settlementAccount,
      qualificationContext
    });
    processedContributions.push(...releaseResult.processed);
    skippedContributions.push(...releaseResult.skipped);

    const [pendingCountRows] = await connection.execute(
      `SELECT COUNT(*) AS pending_count
       FROM v2_help_pending_contributions
       WHERE source_user_id = ? AND status = 'pending'`,
      [sourceUser.id]
    );
    const pendingContributionCount = Number(
      Array.isArray(pendingCountRows) && pendingCountRows[0]
        ? pendingCountRows[0].pending_count
        : 0
    );

    const latestProcessedContribution = processedContributions
      .filter((entry) => Number(entry.ledgerTransactionId || 0) > 0)
      .slice(-1)[0] || null;

    const responsePayload = {
      ok: true,
      queued: false,
      processed: true,
      queueEventId: Number(helpEvent.id),
      eventKey,
      eventType,
      sourceRef: normalizedSourceRef,
      sourceUserCode,
      newMemberUserCode,
      levelNo,
      amountCents: settlementAmountCents,
      immediateUplineUserCode,
      immediateUplineSide,
      settlementMode: latestProcessedContribution?.settlementMode || 'none',
      ledgerTransactionId: Number(latestProcessedContribution?.ledgerTransactionId || 0) || null,
      txUuid: latestProcessedContribution?.txUuid || null,
      beneficiaryUserCode: latestProcessedContribution?.beneficiaryUserCode || null,
      contributionPlanCount: contributionPlan.length,
      processedContributionCount: processedContributions.length,
      skippedContributionCount: skippedContributions.length,
      pendingContributionCount,
      processedContributions,
      skippedContributions,
      queueStatus: 'processed',
      queuedAt: helpEvent.created_at ? new Date(helpEvent.created_at).toISOString() : new Date().toISOString(),
      processedAt: new Date().toISOString(),
      helpProgress: {
        updatedSources: [...new Set(
          processedContributions
            .map((entry) => entry.sourceProgress)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => `${entry.stageCode}:${entry.eventSeq}`)
        )],
        updatedBeneficiaries: [...new Set(
          processedContributions
            .map((entry) => entry.beneficiaryProgress)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => `${entry.stageCode}:${entry.eventSeq}`)
        )]
      }
    };

    await connection.execute(
      `UPDATE v2_help_events_queue
       SET status = 'processed',
           processed_at = NOW(3),
           payload_json = ?
       WHERE id = ?`,
      [JSON.stringify({ request: eventPayload, result: responsePayload }), helpEvent.id]
    );

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }

      if (eventKey) {
        try {
          await pool.execute(
            `UPDATE v2_help_events_queue
             SET status = 'failed',
                 processed_at = NOW(3),
                 payload_json = ?
             WHERE event_key = ?`,
            [
              JSON.stringify({
                ok: false,
                eventKey,
                sourceUserCode,
                newMemberUserCode,
                sourceRef: normalizedSourceRef,
                errorCode: String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80),
                error: getErrorMessage(error, 'Failed to settle help event'),
                failedAt: new Date().toISOString()
              }),
              eventKey
            ]
          );
        } catch {
          // Keep the primary error as source of truth.
        }
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function processV2AdminAdjustment({
  idempotencyKey,
  actorUserCode,
  targetUserCode,
  approverUserCode,
  walletType,
  direction,
  amountCents,
  reasonCode,
  ticketId,
  note,
  description
}) {
  if (STORAGE_MODE !== 'mysql') {
    throw createApiError(503, 'V2 financial APIs require STORAGE_MODE=mysql', 'V2_REQUIRES_MYSQL');
  }

  if (FINANCE_ENGINE_MODE !== 'v2') {
    throw createApiError(409, 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/admin/adjustments', 'FINANCE_MODE_MISMATCH');
  }

  if (!V2_ADMIN_ADJUSTMENT_ENABLED) {
    throw createApiError(403, 'Admin adjustment endpoint is disabled by policy', 'ADMIN_ADJUSTMENT_DISABLED');
  }

  if (!pool) {
    throw createApiError(503, 'MySQL pool not initialized', 'MYSQL_POOL_NOT_READY');
  }

  if (V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS.size > 0 && !V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS.has(actorUserCode)) {
    throw createApiError(403, 'Actor is not allowed to perform admin adjustments', 'ACTOR_NOT_ALLOWED');
  }

  const requiresFourEyes = amountCents > V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS;
  if (requiresFourEyes && actorUserCode === approverUserCode) {
    throw createApiError(
      403,
      `Four-eyes control requires approverUserCode different from actorUserCode when amount exceeds ${V2_ADMIN_ADJUSTMENT_FOUR_EYES_THRESHOLD_CENTS}`,
      'FOUR_EYES_REQUIRED'
    );
  }

  const requestHash = buildV2RequestHash({
    endpoint: V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME,
    actorUserCode,
    targetUserCode,
    approverUserCode,
    walletType,
    direction,
    amountCents,
    reasonCode,
    ticketId,
    note,
    description
  });

  const connection = await pool.getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [actorRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [actorUserCode]
    );
    const actor = Array.isArray(actorRows) ? actorRows[0] : null;
    if (!actor) {
      throw createApiError(401, 'Actor user is not provisioned in v2_users', 'ACTOR_NOT_FOUND_IN_V2');
    }
    if (actor.status !== 'active') {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }

    const [idemRows] = await connection.execute(
      `SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
       FROM v2_idempotency_keys
       WHERE idempotency_key = ?
       FOR UPDATE`,
      [idempotencyKey]
    );
    const existingIdem = Array.isArray(idemRows) && idemRows.length > 0 ? idemRows[0] : null;

    if (existingIdem) {
      if (existingIdem.request_hash !== requestHash) {
        throw createApiError(409, 'Idempotency key reused with different payload', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }

      if (existingIdem.status === 'completed') {
        const replayPayload = parseIdempotencyResponseBody(existingIdem.response_body) || { ok: true };
        await connection.commit();
        transactionOpen = false;
        return {
          status: Number(existingIdem.response_code) || 200,
          payload: { ...replayPayload, idempotentReplay: true }
        };
      }

      const lockExpiresAt = existingIdem.locked_until ? new Date(existingIdem.locked_until).getTime() : 0;
      if (existingIdem.status === 'processing' && Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
        throw createApiError(409, 'Request with this Idempotency-Key is already processing', 'IDEMPOTENCY_IN_PROGRESS');
      }

      await connection.execute(
        `UPDATE v2_idempotency_keys
         SET endpoint_name = ?, actor_user_id = ?, request_hash = ?, status = 'processing',
             locked_until = DATE_ADD(NOW(3), INTERVAL ? SECOND), error_code = NULL,
             updated_at = NOW(3), last_seen_at = NOW(3)
         WHERE idempotency_key = ?`,
        [V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS, idempotencyKey]
      );
    } else {
      await connection.execute(
        `INSERT INTO v2_idempotency_keys
          (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
         VALUES
          (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
        [idempotencyKey, V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME, actor.id, requestHash, V2_IDEMPOTENCY_LOCK_SECONDS]
      );
    }

    const [userRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code IN (?, ?)
       ORDER BY id
       FOR UPDATE`,
      [targetUserCode, approverUserCode]
    );
    const targetUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === targetUserCode)
      : null;
    const approverUser = Array.isArray(userRows)
      ? userRows.find((row) => row.user_code === approverUserCode)
      : null;

    if (!targetUser || !approverUser) {
      throw createApiError(404, 'Target or approver user is not provisioned in v2_users', 'V2_USER_NOT_FOUND');
    }
    if (targetUser.status !== 'active' || approverUser.status !== 'active') {
      throw createApiError(403, 'Target or approver user is not active', 'USER_NOT_ACTIVE');
    }
    if (V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS.size > 0 && !V2_ADMIN_ADJUSTMENT_ALLOWED_ACTORS.has(approverUserCode)) {
      throw createApiError(403, 'Approver user is not allowed by admin adjustment policy', 'APPROVER_NOT_ALLOWED');
    }

    const [walletRows] = await connection.execute(
      `SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
       FROM v2_wallet_accounts
       WHERE user_id = ? AND wallet_type = ?
       LIMIT 1
       FOR UPDATE`,
      [targetUser.id, walletType]
    );
    const targetWallet = Array.isArray(walletRows) ? walletRows[0] : null;
    if (!targetWallet) {
      throw createApiError(404, 'Target wallet is not provisioned in v2', 'V2_WALLET_NOT_FOUND');
    }

    const [suspenseRows] = await connection.execute(
      `SELECT id, account_code, is_active
       FROM v2_gl_accounts
       WHERE account_code = 'SYS_ADJUSTMENT_SUSPENSE'
       LIMIT 1
       FOR UPDATE`
    );
    const suspenseAccount = Array.isArray(suspenseRows) ? suspenseRows[0] : null;
    if (!suspenseAccount || Number(suspenseAccount.is_active) !== 1) {
      throw createApiError(503, 'System adjustment suspense account is not configured', 'SYS_ADJUSTMENT_SUSPENSE_MISSING');
    }

    const txUuid = randomUUID();
    const auditUuid = randomUUID();
    const referenceId = String(ticketId).slice(0, 80);
    const effectiveDescription = description || `Admin adjustment ${direction} ${walletType} (${reasonCode})`;

    const [ledgerTxnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
         reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES
        (?, 'v2', 'admin_adjustment', 'posted', ?, ?,
         'admin_adjustment', ?, ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        actor.id,
        referenceId,
        effectiveDescription,
        amountCents,
        amountCents
      ]
    );

    const ledgerTxnId = Number(ledgerTxnResult?.insertId || 0);
    if (!ledgerTxnId) {
      throw createApiError(500, 'Failed to create ledger transaction', 'LEDGER_TXN_CREATE_FAILED');
    }

    const isCreditToUser = direction === 'credit';
    if (isCreditToUser) {
      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, ?, ?, 'credit', ?)`,
        [
          ledgerTxnId,
          suspenseAccount.id,
          amountCents,
          ledgerTxnId,
          targetWallet.gl_account_id,
          targetWallet.user_id,
          walletType,
          amountCents
        ]
      );

      const [walletUpdateResult] = await connection.execute(
        `UPDATE v2_wallet_accounts
         SET current_amount_cents = current_amount_cents + ?, version = version + 1
         WHERE user_id = ? AND wallet_type = ?`,
        [amountCents, targetWallet.user_id, walletType]
      );
      if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
        throw createApiError(500, 'Failed to apply wallet credit for admin adjustment', 'WALLET_UPDATE_FAILED');
      }
    } else {
      if (walletType === 'income') {
        const targetIncomeLockSnapshot = await readV2LockedIncomeSnapshotForMutation(connection, targetWallet.user_id, targetUserCode);
        const targetSpendableIncomeCents = Math.max(0, Number(targetWallet.current_amount_cents) - targetIncomeLockSnapshot.totalLockedIncomeCents);
        if (targetSpendableIncomeCents < amountCents) {
          throw createApiError(
            409,
            'Insufficient spendable income wallet balance for admin debit adjustment',
            'INSUFFICIENT_FUNDS'
          );
        }
      } else if (Number(targetWallet.current_amount_cents) < amountCents) {
        throw createApiError(409, 'Insufficient wallet balance for admin debit adjustment', 'INSUFFICIENT_FUNDS');
      }

      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, ?, ?, 'debit', ?),
          (?, 2, ?, NULL, NULL, 'credit', ?)`,
        [
          ledgerTxnId,
          targetWallet.gl_account_id,
          targetWallet.user_id,
          walletType,
          amountCents,
          ledgerTxnId,
          suspenseAccount.id,
          amountCents
        ]
      );

      const [walletUpdateResult] = await connection.execute(
        `UPDATE v2_wallet_accounts
         SET current_amount_cents = current_amount_cents - ?, version = version + 1
         WHERE user_id = ? AND wallet_type = ? AND current_amount_cents >= ?`,
        [amountCents, targetWallet.user_id, walletType, amountCents]
      );
      if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
        throw createApiError(409, 'Insufficient wallet balance for admin debit adjustment', 'INSUFFICIENT_FUNDS');
      }
    }

    const auditPayload = {
      endpoint: '/api/v2/admin/adjustments',
      actorUserCode,
      targetUserCode,
      approverUserCode,
      walletType,
      direction,
      amountCents,
      reasonCode,
      ticketId,
      note,
      description
    };

    await connection.execute(
      `INSERT INTO v2_admin_adjustment_audit
        (audit_uuid, idempotency_key, request_hash, actor_user_id, approver_user_id,
         target_user_id, wallet_type, direction, amount_cents, reason_code,
         ticket_id, note, payload_json, ledger_tx_uuid)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditUuid,
        idempotencyKey,
        requestHash,
        actor.id,
        approverUser.id,
        targetUser.id,
        walletType,
        direction,
        amountCents,
        reasonCode,
        ticketId,
        note,
        JSON.stringify(auditPayload),
        txUuid
      ]
    );

    const responsePayload = {
      ok: true,
      txUuid,
      auditUuid,
      ledgerTransactionId: ledgerTxnId,
      actorUserCode,
      targetUserCode,
      approverUserCode,
      walletType,
      direction,
      amountCents,
      reasonCode,
      ticketId,
      postedAt: new Date().toISOString()
    };

    await connection.execute(
      `UPDATE v2_idempotency_keys
       SET status = 'completed', response_code = ?, response_body = ?,
           locked_until = NULL, error_code = NULL, updated_at = NOW(3), last_seen_at = NOW(3)
       WHERE idempotency_key = ?`,
      [200, JSON.stringify(responsePayload), idempotencyKey]
    );

    await connection.commit();
    transactionOpen = false;
    return { status: 200, payload: responsePayload };
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }

    const shouldMarkFailed = !!idempotencyKey && !!pool;
    if (shouldMarkFailed) {
      try {
        await pool.execute(
          `UPDATE v2_idempotency_keys
           SET status = 'failed', error_code = ?, locked_until = NULL,
               updated_at = NOW(3), last_seen_at = NOW(3)
           WHERE idempotency_key = ?`,
          [String(error?.code || 'UNKNOWN_V2_ERROR').slice(0, 80), idempotencyKey]
        );
      } catch {
        // Keep the primary error as source of truth.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

function getStateArrayLength(state, key) {
  const raw = state?.[key];
  if (typeof raw !== 'string') return null;
  const parsed = safeParseJSON(raw);
  return Array.isArray(parsed) ? parsed.length : null;
}

function hasFullStateSnapshot(state) {
  return DB_KEYS.every((key) => typeof state?.[key] === 'string');
}

function normalizeRequestedStateKeys(requestedKeys) {
  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) return [];
  return requestedKeys.filter((key) => typeof key === 'string' && DB_KEYS_SET.has(key));
}

function filterStateSnapshot(snapshot, requestedKeys) {
  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
    return cloneStateSnapshot(snapshot);
  }
  const allowedKeys = requestedKeys.filter((key) => typeof key === 'string' && DB_KEYS_SET.has(key));
  if (allowedKeys.length === 0) {
    return { state: {}, updatedAt: typeof snapshot?.updatedAt === 'string' ? snapshot.updatedAt : null };
  }
  const filteredState = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(snapshot?.state || {}, key)) {
      filteredState[key] = snapshot.state[key];
    }
  }
  return {
    state: filteredState,
    updatedAt: typeof snapshot?.updatedAt === 'string' ? snapshot.updatedAt : null
  };
}

// ─── MySQL state read/write ──────────────────────────────────────────

async function readStateFromFile(requestedKeys = []) {
  await ensureFileStorageReady();
  const raw = await fs.readFile(STATE_FILE_PATH, 'utf-8');
  const parsed = safeParseJSON(raw);
  const snapshotState = parsed && typeof parsed === 'object' && parsed.state && typeof parsed.state === 'object'
    ? parsed.state
    : {};
  const keysToRead = requestedKeys.length > 0 ? requestedKeys : DB_KEYS;
  const state = {};

  for (const key of keysToRead) {
    if (typeof snapshotState[key] === 'string') {
      state[key] = snapshotState[key];
    }
  }

  return {
    state,
    updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
  };
}

async function readStateFromDB(requestedKeys = []) {
  if (STORAGE_MODE === 'file') {
    return readStateFromFile(requestedKeys);
  }

  const keysToRead = requestedKeys.length > 0 ? requestedKeys : DB_KEYS;
  const placeholders = keysToRead.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT state_key, state_value, updated_at
       FROM \`${MYSQL_DATABASE}\`.state_store
       WHERE state_key IN (${placeholders})`,
    keysToRead
  );

  const state = {};
  let latestUpdatedAt = null;

  for (const row of rows) {
    state[row.state_key] = row.state_value;
    if (row.updated_at) {
      const ts = new Date(row.updated_at).toISOString();
      if (!latestUpdatedAt || ts > latestUpdatedAt) latestUpdatedAt = ts;
    }
  }

  return { state, updatedAt: latestUpdatedAt };
}

async function writeStateToDB(nextState, replaceMissing = true) {
  if (STORAGE_MODE === 'file') {
    const currentSnapshot = await readStateFromFile();
    const currentState = currentSnapshot.state || {};
    const now = new Date().toISOString();
    const keysToWrite = replaceMissing
      ? DB_KEYS
      : Object.keys(nextState).filter((key) => DB_KEYS_SET.has(key));
    const finalState = replaceMissing ? {} : { ...currentState };

    for (const key of keysToWrite) {
      const rawValue = nextState[key];
      if (typeof rawValue === 'string') {
        finalState[key] = rawValue;
      } else if (replaceMissing) {
        delete finalState[key];
      }
    }

    await fs.writeFile(STATE_FILE_PATH, JSON.stringify({ state: finalState, updatedAt: now }, null, 2), 'utf-8');

    const canUpdateCacheFromWrite = replaceMissing || !!stateSnapshotCache?.snapshot;
    if (canUpdateCacheFromWrite) {
      const mergedState = {};
      const previousState = stateSnapshotCache?.snapshot?.state || {};
      for (const k of DB_KEYS) {
        if (Object.prototype.hasOwnProperty.call(nextState, k) && typeof nextState[k] === 'string') {
          mergedState[k] = nextState[k];
        } else if (typeof previousState[k] === 'string') {
          mergedState[k] = previousState[k];
        }
      }
      await setStateSnapshotCache({ state: mergedState, updatedAt: now });
    } else {
      invalidateStateSnapshotCache();
    }

    return { updatedAt: now };
  }

  const now = new Date().toISOString();
  const entries = replaceMissing
    ? DB_KEYS.map((key) => [key, nextState[key]])
    : Object.entries(nextState).filter(([key]) => DB_KEYS_SET.has(key));

  for (const [key, rawValue] of entries) {
    if (typeof rawValue !== 'string') {
      if (replaceMissing) {
        // Delete the key if replaceMissing and value not provided
        await pool.execute('DELETE FROM state_store WHERE state_key = ?', [key]);
      }
      continue;
    }
    await pool.execute(
      `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
      [key, rawValue, toMySQLDatetime(now)]
    );
  }

  // Update cache
  const canUpdateCacheFromWrite = replaceMissing || !!stateSnapshotCache?.snapshot;
  if (canUpdateCacheFromWrite) {
    const mergedState = {};
    const previousState = stateSnapshotCache?.snapshot?.state || {};
    for (const k of DB_KEYS) {
      if (Object.prototype.hasOwnProperty.call(nextState, k) && typeof nextState[k] === 'string') {
        mergedState[k] = nextState[k];
      } else if (typeof previousState[k] === 'string') {
        mergedState[k] = previousState[k];
      }
    }
    await setStateSnapshotCache({ state: mergedState, updatedAt: now });
  } else {
    invalidateStateSnapshotCache();
  }

  return { updatedAt: now };
}

async function readStateKeyValue(key) {
  if (!DB_KEYS_SET.has(key)) return null;

  if (STORAGE_MODE === 'file') {
    const snapshot = await readStateFromFile([key]);
    return typeof snapshot.state[key] === 'string' ? snapshot.state[key] : null;
  }

  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT state_value FROM \`${MYSQL_DATABASE}\`.state_store WHERE state_key = ?`,
      [key]
    );
  } catch (err) {
    console.warn('readStateKeyValue failed, retrying simple select:', getErrorMessage(err), {
      code: err?.code, errno: err?.errno, sqlState: err?.sqlState
    });
    [rows] = await pool.execute(
      `SELECT state_value FROM \`${MYSQL_DATABASE}\`.state_store WHERE state_key = ?`,
      [key]
    );
  }
  if (!rows.length || typeof rows[0].state_value !== 'string') return null;
  return rows[0].state_value;
}

async function upsertStateKeyValue(key, rawValue, updatedAt = new Date().toISOString()) {
  if (!DB_KEYS_SET.has(key)) return;

  if (STORAGE_MODE === 'file') {
    await writeStateToDB({ [key]: rawValue }, false);
    return;
  }

  await pool.execute(
    `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
    [key, rawValue, toMySQLDatetime(updatedAt)]
  );
}

async function getStateSnapshotCached(options = {}) {
  const requestedKeys = normalizeRequestedStateKeys(options.keys);
  const isFullSnapshot = requestedKeys.length === 0;

  if (isFullSnapshot && !options.forceFresh && stateSnapshotCache?.snapshot) {
    return cloneStateSnapshot(stateSnapshotCache.snapshot);
  }

  // For filtered key requests, try to serve from the full cache first
  if (!isFullSnapshot && !options.forceFresh && stateSnapshotCache?.snapshot) {
    return filterStateSnapshot(stateSnapshotCache.snapshot, requestedKeys);
  }

  const snapshot = await readStateFromDB(requestedKeys);
  if (!isFullSnapshot) return cloneStateSnapshot(snapshot);
  return setStateSnapshotCache(snapshot);
}

// ─── Authentication ──────────────────────────────────────────────────

function toEpochMs(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function resolveLoginUserCandidate(usersData, normalizedUserId, normalizedPassword) {
  if (!Array.isArray(usersData)) {
    return { user: null, index: -1 };
  }

  const candidates = [];
  for (let i = 0; i < usersData.length; i += 1) {
    const item = usersData[i];
    if (!item || item.userId !== normalizedUserId) continue;
    candidates.push({ user: item, index: i });
  }

  if (candidates.length === 0) {
    return { user: null, index: -1 };
  }

  const passwordMatches = candidates.filter(({ user }) => String(user.password || '') === normalizedPassword);
  const pool = passwordMatches.length > 0 ? passwordMatches : candidates;

  const ranked = pool
    .map((entry) => {
      const user = entry.user;
      const isActiveRank = user.isActive ? 1 : 0;
      const isBlockedRank = (user.accountStatus === 'permanent_blocked' || user.accountStatus === 'temp_blocked') ? 0 : 1;
      const activeStatusRank = (user.accountStatus === 'active' || !user.accountStatus) ? 1 : 0;
      const reactivatedTs = toEpochMs(user.reactivatedAt);
      const activatedTs = toEpochMs(user.activatedAt);
      const createdTs = toEpochMs(user.createdAt);
      const newestTs = Math.max(reactivatedTs, activatedTs, createdTs);
      return {
        ...entry,
        isActiveRank,
        isBlockedRank,
        activeStatusRank,
        newestTs
      };
    })
    .sort((a, b) => {
      if (b.isActiveRank !== a.isActiveRank) return b.isActiveRank - a.isActiveRank;
      if (b.isBlockedRank !== a.isBlockedRank) return b.isBlockedRank - a.isBlockedRank;
      if (b.activeStatusRank !== a.activeStatusRank) return b.activeStatusRank - a.activeStatusRank;
      if (b.newestTs !== a.newestTs) return b.newestTs - a.newestTs;
      return b.index - a.index;
    });

  const winner = ranked[0] || null;
  return {
    user: winner ? winner.user : null,
    index: winner ? winner.index : -1
  };
}

async function authenticateUser(userId, password) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  const normalizedPassword = typeof password === 'string' ? password : '';
  if (!/^\d{7}$/.test(normalizedUserId)) {
    return { ok: false, status: 400, error: 'User ID must be exactly 7 digits' };
  }

  let usersData = null;
  let selectedUserIndex = -1;

  // Try in-memory cache first
  let user = null;
  if (stateSnapshotCache?.snapshot?.state?.mlm_users) {
    try {
      usersData = JSON.parse(stateSnapshotCache.snapshot.state.mlm_users);
      if (Array.isArray(usersData)) {
        const resolved = resolveLoginUserCandidate(usersData, normalizedUserId, normalizedPassword);
        user = resolved.user;
        selectedUserIndex = resolved.index;
      }
    } catch {
      user = null;
      usersData = null;
      selectedUserIndex = -1;
    }
  }

  // Fallback: read from MySQL
  if (!user) {
    const usersRaw = await readStateKeyValue('mlm_users');
    if (!usersRaw) return { ok: false, status: 404, error: 'User ID not found' };
    try {
      usersData = JSON.parse(usersRaw);
      if (Array.isArray(usersData)) {
        const resolved = resolveLoginUserCandidate(usersData, normalizedUserId, normalizedPassword);
        user = resolved.user;
        selectedUserIndex = resolved.index;
      }
    } catch {
      return { ok: false, status: 500, error: 'Failed to parse user data' };
    }
    if (!user) return { ok: false, status: 404, error: 'User ID not found' };
  }

  if (user.accountStatus === 'permanent_blocked') {
    return {
      ok: false, status: 403,
      error: `Account permanently blocked${user.blockedReason ? `: ${user.blockedReason}` : ''}`
    };
  }

  if (user.accountStatus === 'temp_blocked') {
    const blockedUntil = user.blockedUntil ? new Date(user.blockedUntil) : null;
    if (blockedUntil && blockedUntil > new Date()) {
      return {
        ok: false, status: 403,
        error: `Account temporarily blocked until ${blockedUntil.toLocaleString()}${user.blockedReason ? `: ${user.blockedReason}` : ''}`
      };
    }
  }

  // Auto-deactivate on login if direct-referral deadline has passed.
  if (!user.isAdmin && user.isActive && user.activatedAt) {
    const requiredDirects = 2;
    const directCount = Number.isFinite(Number(user.directCount)) ? Number(user.directCount) : 0;
    if (directCount < requiredDirects) {
      let deadlineDays = 30;
      let settings = null;

      if (stateSnapshotCache?.snapshot?.state?.mlm_settings) {
        const parsedSettings = safeParseJSON(stateSnapshotCache.snapshot.state.mlm_settings);
        if (parsedSettings && typeof parsedSettings === 'object') {
          settings = parsedSettings;
        }
      }

      if (!settings) {
        const settingsRaw = await readStateKeyValue('mlm_settings');
        if (settingsRaw) {
          const parsedSettings = safeParseJSON(settingsRaw);
          if (parsedSettings && typeof parsedSettings === 'object') {
            settings = parsedSettings;
          }
        }
      }

      const configuredDays = Number(settings?.directReferralDeadlineDays);
      if (Number.isFinite(configuredDays) && configuredDays > 0) {
        deadlineDays = configuredDays;
      }

      const baseDateRaw = user.reactivatedAt || user.activatedAt;
      const baseDate = baseDateRaw ? new Date(baseDateRaw) : null;
      if (baseDate && !Number.isNaN(baseDate.getTime())) {
        const deadlineEnd = new Date(baseDate.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
        if (Date.now() >= deadlineEnd.getTime()) {
          const updatedUser = {
            ...user,
            isActive: false,
            deactivationReason: 'direct_referral_deadline'
          };
          user = updatedUser;

          if (Array.isArray(usersData)) {
            const index = (selectedUserIndex >= 0 && usersData[selectedUserIndex] && usersData[selectedUserIndex].userId === updatedUser.userId)
              ? selectedUserIndex
              : usersData.findIndex((item) => item && item.id === updatedUser.id);
            if (index >= 0) {
              usersData[index] = updatedUser;
              await writeStateToDB({ mlm_users: JSON.stringify(usersData) }, false);
            }
          }
        }
      }
    }
  }

  if (!user.isActive) {
    if (user.deactivationReason === 'direct_referral_deadline') {
      return { ok: false, status: 403, error: 'Your ID is inactive as per direct refer terms & conditions.' };
    }
    return { ok: false, status: 403, error: 'Account is inactive. Contact admin.' };
  }

  if (user.password !== normalizedPassword) {
    return { ok: false, status: 401, error: 'Invalid password' };
  }

  return { ok: true, status: 200, user };
}

// ─── Admin audit ─────────────────────────────────────────────────────

async function buildAdminAuditReport() {
  const generatedAt = new Date().toISOString();
  const snapshot = await readStateFromDB();
  const presentStateKeys = Object.keys(snapshot.state).sort();
  const missingStateKeys = DB_KEYS.filter((key) => !presentStateKeys.includes(key));

  const users = safeParseJSON(snapshot.state.mlm_users) || [];
  const wallets = safeParseJSON(snapshot.state.mlm_wallets) || [];
  const matrix = safeParseJSON(snapshot.state.mlm_matrix) || [];
  const safetyPool = safeParseJSON(snapshot.state.mlm_safety_pool) || {};
  const safetyPoolTransactions = Array.isArray(safetyPool.transactions) ? safetyPool.transactions.length : 0;

  const keyCounts = {};
  for (const key of DB_KEYS) {
    const val = snapshot.state[key];
    if (!val) { keyCounts[key] = 0; continue; }
    const parsed = safeParseJSON(val);
    keyCounts[key] = Array.isArray(parsed) ? parsed.length : (parsed && typeof parsed === 'object' ? 1 : 0);
  }

  const userIdSet = new Set(users.map((u) => u.id).filter((id) => typeof id === 'string' && id.length > 0));
  const userUserIdSet = new Set(users.map((u) => u.userId).filter((id) => typeof id === 'string' && id.length > 0));

  const orphanWalletUserIds = wallets
    .filter((w) => !userIdSet.has(w.userId))
    .map((w) => w.userId)
    .slice(0, 50);

  const orphanMatrixUserIds = matrix
    .filter((m) => !userUserIdSet.has(m.userId))
    .map((m) => m.userId)
    .slice(0, 50);

  const danglingMatrixParents = matrix
    .filter((m) => m.parentId && !userUserIdSet.has(m.parentId))
    .map((m) => ({ userId: m.userId, parentId: m.parentId }))
    .slice(0, 50);

  const danglingMatrixChildren = [];
  for (const node of matrix) {
    if (node.leftChild && !userUserIdSet.has(node.leftChild)) {
      danglingMatrixChildren.push({ userId: node.userId, child: node.leftChild, side: 'left' });
    }
    if (node.rightChild && !userUserIdSet.has(node.rightChild)) {
      danglingMatrixChildren.push({ userId: node.userId, child: node.rightChild, side: 'right' });
    }
  }

  const adminAccount = users.find((u) => u.userId === '1000001');

  return {
    generatedAt,
    database: MYSQL_DATABASE,
    storage: STORAGE_MODE === 'file' ? 'file_snapshot' : 'mysql_key_value',
    keyCounts,
    stateCoverage: { expectedStateKeys: DB_KEYS, presentStateKeys, missingStateKeys },
    integrity: {
      userCount: users.length,
      walletCount: wallets.length,
      matrixNodeCount: matrix.length,
      safetyPoolTransactionCount: safetyPoolTransactions,
      orphanWalletCount: orphanWalletUserIds.length,
      orphanWalletUserIds,
      orphanMatrixNodeCount: orphanMatrixUserIds.length,
      orphanMatrixUserIds,
      danglingMatrixParentCount: danglingMatrixParents.length,
      danglingMatrixParents,
      danglingMatrixChildCount: danglingMatrixChildren.length,
      danglingMatrixChildren: danglingMatrixChildren.slice(0, 50)
    },
    adminAccount: adminAccount
      ? {
        exists: true, userId: adminAccount.userId, id: adminAccount.id,
        email: adminAccount.email, isAdmin: !!adminAccount.isAdmin,
        isActive: !!adminAccount.isActive, accountStatus: adminAccount.accountStatus,
        hasPassword: typeof adminAccount.password === 'string' && adminAccount.password.length > 0
      }
      : { exists: false }
  };
}

async function buildMissingMatrixUsersAudit(limit = 200) {
  const generatedAt = new Date().toISOString();
  const snapshot = await readStateFromDB(['mlm_users', 'mlm_matrix']);
  const users = safeParseJSON(snapshot.state.mlm_users) || [];
  const matrix = safeParseJSON(snapshot.state.mlm_matrix) || [];

  const userPublicIdSet = new Set(
    users
      .map((user) => (typeof user?.userId === 'string' ? user.userId.trim() : ''))
      .filter(Boolean)
  );

  const parsedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const items = [];

  for (const node of matrix) {
    const publicUserId = typeof node?.userId === 'string' ? node.userId.trim() : '';
    if (!publicUserId) continue;
    if (userPublicIdSet.has(publicUserId)) continue;

    const parentId = typeof node?.parentId === 'string' ? node.parentId.trim() : null;
    const normalizedPosition = Number(node?.position) === 0
      ? 'left'
      : Number(node?.position) === 1
        ? 'right'
        : null;

    items.push({
      userId: publicUserId,
      username: typeof node?.username === 'string' ? node.username : '',
      parentId,
      parentExistsInUsers: !!(parentId && userPublicIdSet.has(parentId)),
      position: normalizedPosition,
      isActive: !!node?.isActive
    });

    if (items.length >= parsedLimit) break;
  }

  return {
    generatedAt,
    missingCount: items.length,
    limit: parsedLimit,
    items
  };
}

function auditRound2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function auditGetTxTime(tx) {
  const ts = new Date(tx?.completedAt || tx?.createdAt || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function auditParseWithdrawalFee(description) {
  if (!description) return 0;
  const match = String(description).match(/Fee:\s*\$([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return 0;
  const fee = Number(match[1]);
  return Number.isFinite(fee) ? fee : 0;
}

function auditResolveTransactionLevel(tx) {
  const numericLevel = Number(tx?.level);
  if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= 20) {
    return numericLevel;
  }
  const desc = String(tx?.description || '');
  const match = desc.match(/\blevel\s+(\d+)\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) return null;
  return parsed;
}

function auditIsLockedFirstTwoReceiveDescription(description, level) {
  const desc = String(description || '').toLowerCase();
  const prefix = typeof level === 'number'
    ? `locked first-two help at level ${level}`
    : 'locked first-two help at level';
  return desc.includes(prefix);
}

function auditIsLockedQualifiedReceiveDescription(description, level) {
  const desc = String(description || '').toLowerCase();
  const prefix = typeof level === 'number'
    ? `locked receive help at level ${level}`
    : 'locked receive help at level';
  return desc.includes(prefix);
}

function auditGetUnsettledLockedReceiveEffectiveAmount(tx, allTransactions) {
  if (tx?.type !== 'receive_help' || tx?.status !== 'completed') return 0;
  if (
    !auditIsLockedFirstTwoReceiveDescription(tx.description)
    && !auditIsLockedQualifiedReceiveDescription(tx.description)
  ) {
    return 0;
  }

  const directAmount = Number(tx.amount || 0);
  if (directAmount > 0) {
    return Math.abs(directAmount);
  }

  const displayAmount = Number(tx.displayAmount || 0);
  if (!(displayAmount > 0)) return 0;

  const level = auditResolveTransactionLevel(tx);
  if (!level) return 0;

  const txTime = auditGetTxTime(tx);
  const expectedGiveLevel = Math.min(20, level + 1);
  const settledByGiveHelp = allTransactions.some((candidate) =>
    candidate.userId === tx.userId
    && candidate.type === 'give_help'
    && candidate.status === 'completed'
    && Number(candidate.amount || 0) < 0
    && String(candidate.description || '').toLowerCase().includes('from locked income')
    && auditResolveTransactionLevel(candidate) === expectedGiveLevel
    && Math.abs(auditGetTxTime(candidate) - txTime) <= 10 * 60 * 1000
  );

  return settledByGiveHelp ? 0 : Math.abs(displayAmount);
}

function computeIncomeLedgerFromTransactionsForAudit(userId, transactions) {
  const txs = transactions
    .filter((tx) => tx.userId === userId)
    .sort((a, b) => auditGetTxTime(a) - auditGetTxTime(b));

  let incomeWallet = 0;

  for (const tx of txs) {
    const txDesc = String(tx.description || '').toLowerCase();
    const txType = String(tx.type || '');
    const txAmount = Number(tx.amount || 0);

    switch (txType) {
      case 'direct_income':
      case 'level_income':
        incomeWallet += txAmount;
        break;
      case 'royalty_transfer':
        if (txAmount > 0 && txDesc.includes('income wallet')) {
          incomeWallet += txAmount;
        }
        break;
      case 'receive_help': {
        const isLockedReceive = auditIsLockedQualifiedReceiveDescription(txDesc)
          || auditIsLockedFirstTwoReceiveDescription(txDesc)
          || auditGetUnsettledLockedReceiveEffectiveAmount(tx, txs) > 0;
        if (!isLockedReceive) {
          incomeWallet += txAmount;
        }
        break;
      }
      case 'give_help':
        if (!txDesc.includes('from locked income') && !txDesc.includes('from matrix contribution')) {
          if (txAmount >= 0) {
            incomeWallet += txAmount;
          } else {
            const incomeOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
            incomeWallet -= incomeOutflow;
          }
        }
        break;
      case 'safety_pool':
        if (txAmount >= 0) {
          incomeWallet += txAmount;
        } else {
          const safetyOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= safetyOutflow;
        }
        break;
      case 'withdrawal': {
        const fee = auditParseWithdrawalFee(tx.description || '');
        const withdrawalOutflow = txAmount < 0 ? Math.abs(txAmount) : Math.abs(txAmount) + fee;
        const appliedOutflow = Math.min(withdrawalOutflow, Math.max(0, incomeWallet));
        incomeWallet -= appliedOutflow;
        break;
      }
      case 'income_transfer':
        if (txAmount >= 0) {
          incomeWallet += txAmount;
        } else {
          const isUserInitiatedIncomeToFundTransfer = txDesc.includes('to your fund wallet')
            || txDesc.includes('to fund wallet of');
          const transferOutflow = isUserInitiatedIncomeToFundTransfer
            ? Math.abs(txAmount)
            : Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= transferOutflow;
        }
        break;
      case 'admin_credit':
        if (txDesc.includes('income wallet')) {
          incomeWallet += txAmount;
        }
        break;
      case 'admin_debit':
        if (txDesc.includes('income wallet')) {
          const debitOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= debitOutflow;
        }
        break;
      case 'fund_recovery':
        if (txDesc.includes('income wallet')) {
          const recoveryOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= recoveryOutflow;
        }
        break;
      case 'system_fee':
        if (txDesc.includes('income wallet')) {
          const feeOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= feeOutflow;
        }
        break;
      default:
        break;
    }
  }

  return Math.max(0, auditRound2(incomeWallet));
}

async function buildIncomeTransferSenderMismatchAudit() {
  const generatedAt = new Date().toISOString();
  const snapshot = await readStateFromDB(['mlm_users', 'mlm_wallets', 'mlm_transactions']);
  const users = Array.isArray(safeParseJSON(snapshot.state.mlm_users)) ? safeParseJSON(snapshot.state.mlm_users) : [];
  const wallets = Array.isArray(safeParseJSON(snapshot.state.mlm_wallets)) ? safeParseJSON(snapshot.state.mlm_wallets) : [];
  const transactions = Array.isArray(safeParseJSON(snapshot.state.mlm_transactions)) ? safeParseJSON(snapshot.state.mlm_transactions) : [];

  const userById = new Map(users.map((user) => [String(user.id || ''), user]));
  const senderDebitCountByUser = new Map();

  for (const tx of transactions) {
    if (tx?.type !== 'income_transfer' || tx?.status !== 'completed' || !(Number(tx?.amount || 0) < 0)) continue;
    const desc = String(tx?.description || '').toLowerCase();
    if (!desc.includes('to your fund wallet') && !desc.includes('to fund wallet of')) continue;
    const key = String(tx.userId || '');
    if (!key) continue;
    senderDebitCountByUser.set(key, (senderDebitCountByUser.get(key) || 0) + 1);
  }

  const mismatches = [];
  let totalIncomeDelta = 0;

  for (const wallet of wallets) {
    const walletUserId = String(wallet?.userId || '');
    if (!walletUserId) continue;
    const senderDebitCount = Number(senderDebitCountByUser.get(walletUserId) || 0);
    if (senderDebitCount <= 0) continue;

    const expectedIncomeWallet = computeIncomeLedgerFromTransactionsForAudit(walletUserId, transactions);
    const currentIncomeWallet = Number(wallet.incomeWallet || 0);
    const delta = auditRound2(expectedIncomeWallet - currentIncomeWallet);
    if (Math.abs(delta) <= 0.009) continue;

    const user = userById.get(walletUserId);
    totalIncomeDelta = auditRound2(totalIncomeDelta + delta);

    mismatches.push({
      internalUserId: walletUserId,
      userId: String(user?.userId || walletUserId),
      name: String(user?.fullName || user?.username || 'Unknown'),
      senderDebitCount,
      currentIncomeWallet: auditRound2(currentIncomeWallet),
      expectedIncomeWallet,
      incomeDelta: delta
    });
  }

  mismatches.sort((a, b) => Math.abs(b.incomeDelta) - Math.abs(a.incomeDelta));

  return {
    generatedAt,
    scannedUsers: wallets.length,
    senderUsersWithTransfers: senderDebitCountByUser.size,
    transferSenderIncomeMismatches: mismatches.length,
    totalIncomeDelta,
    topMismatches: mismatches.slice(0, 50)
  };
}

async function runLedgerMismatchAlertCheck() {
  if (!LEDGER_MISMATCH_ALERT_ENABLED) return;
  if (ledgerMismatchAuditRunning) return;

  ledgerMismatchAuditRunning = true;
  try {
    const report = await buildIncomeTransferSenderMismatchAudit();
    if (report.transferSenderIncomeMismatches <= 0) return;

    const signature = report.topMismatches
      .slice(0, 20)
      .map((row) => `${row.userId}:${row.incomeDelta.toFixed(2)}`)
      .join('|');
    const now = Date.now();
    const cooldownMs = LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES * 60 * 1000;
    const withinCooldown = signature === ledgerMismatchAlertLastSignature && (now - ledgerMismatchAlertLastAt) < cooldownMs;
    if (withinCooldown) return;

    ledgerMismatchAlertLastSignature = signature;
    ledgerMismatchAlertLastAt = now;

    const preview = report.topMismatches.slice(0, 10)
      .map((row) => `${row.userId} ${row.name}: current=${row.currentIncomeWallet.toFixed(2)} expected=${row.expectedIncomeWallet.toFixed(2)} delta=${row.incomeDelta.toFixed(2)} transfers=${row.senderDebitCount}`)
      .join('\n');

    const subject = `[ReferNex Alert] Sender debit mismatch detected (${report.transferSenderIncomeMismatches} users)`;
    const textBody = [
      `Database: ${MYSQL_DATABASE}`,
      `Generated: ${report.generatedAt}`,
      `Sender users with income-transfer debits: ${report.senderUsersWithTransfers}`,
      `Mismatches: ${report.transferSenderIncomeMismatches}`,
      `Total income delta: ${report.totalIncomeDelta.toFixed(2)}`,
      '',
      'Top mismatches:',
      preview
    ].join('\n');

    console.error(`[ledger-alert] ${subject}`);
    console.error(`[ledger-alert] ${preview}`);

    if (!LEDGER_MISMATCH_ALERT_TO) return;
    const smtpErrors = getSmtpConfigErrors();
    if (smtpErrors.length > 0) {
      console.warn(`[ledger-alert] SMTP not configured for email alert: ${smtpErrors.join(', ')}`);
      return;
    }

    await getSmtpTransporter().sendMail({
      from: SMTP_FROM,
      to: LEDGER_MISMATCH_ALERT_TO,
      subject,
      text: textBody
    });
  } catch (error) {
    console.warn(`[ledger-alert] failed: ${getErrorMessage(error, 'Unknown error')}`);
  } finally {
    ledgerMismatchAuditRunning = false;
  }
}

// ─── Backups (file-based, reads from state_store) ────────────────────

function createBackupDirName(prefix = 'state-backup') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}`;
}

async function ensureStateBackupDir() {
  await fs.mkdir(STATE_BACKUP_DIR, { recursive: true });
}

async function createStateBackup(options = {}) {
  await ensureStateBackupDir();
  const now = new Date().toISOString();
  const dirName = createBackupDirName(options.prefix || 'state-backup');
  const dirPath = path.join(STATE_BACKUP_DIR, dirName);
  const manifestPath = path.join(dirPath, 'manifest.json');
  const requestedKeys = normalizeRequestedStateKeys(options.keys);
  const keysToBackup = requestedKeys.length > 0 ? requestedKeys : DB_KEYS;

  await fs.mkdir(dirPath, { recursive: true });

  const snapshot = await readStateFromDB(keysToBackup);
  let latestUpdatedAt = snapshot.updatedAt;
  const keys = [];
  const files = [];

  for (const stateKey of keysToBackup) {
    const rawValue = snapshot.state[stateKey];
    if (typeof rawValue !== 'string') continue;

    const fileName = `${stateKey}.json`;
    const stateFilePath = path.join(dirPath, fileName);
    const parsed = safeParseJSON(rawValue);
    await fs.writeFile(stateFilePath, JSON.stringify(parsed, null, 2), 'utf-8');

    const itemCount = Array.isArray(parsed) ? parsed.length : (parsed && typeof parsed === 'object' ? 1 : 0);
    keys.push(stateKey);
    files.push({ stateKey, fileName, itemCount });
  }

  const manifest = {
    formatVersion: 2,
    createdAt: now,
    source: options.source || 'manual',
    reason: options.reason || null,
    updatedAt: latestUpdatedAt,
    keys,
    files
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return { fileName: dirName, filePath: dirPath, createdAt: now, updatedAt: latestUpdatedAt, keys };
}

async function listStateBackups(limit = 20) {
  await ensureStateBackupDir();
  const entries = await fs.readdir(STATE_BACKUP_DIR, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));

  const items = [];
  for (const fileName of directories) {
    const filePath = path.join(STATE_BACKUP_DIR, fileName);
    const manifestPath = path.join(filePath, 'manifest.json');
    const stat = await fs.stat(filePath);
    let manifest = null;
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')); } catch { manifest = null; }
    items.push({
      fileName, filePath, size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: typeof manifest?.createdAt === 'string' ? manifest.createdAt : null,
      updatedAt: typeof manifest?.updatedAt === 'string' ? manifest.updatedAt : null,
      keys: Array.isArray(manifest?.keys) ? manifest.keys.filter((key) => typeof key === 'string') : []
    });
  }
  return items;
}

// ─── Request body parser ─────────────────────────────────────────────

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      data += chunk;
      if (totalBytes > STATE_PAYLOAD_LIMIT_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function serveUploadedFile(req, res, url) {
  const relativeUploadPath = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ''));
  if (!relativeUploadPath || relativeUploadPath.includes('\0')) {
    sendJson(res, 400, { ok: false, error: 'Invalid upload path' });
    return;
  }

  const normalized = path.normalize(relativeUploadPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolutePath = path.join(UPLOADS_BASE_DIR, normalized);
  const uploadsRoot = `${path.resolve(UPLOADS_BASE_DIR)}${path.sep}`;
  const resolvedPath = path.resolve(absolutePath);

  if (!resolvedPath.startsWith(uploadsRoot)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  try {
    const fileBuffer = await fs.readFile(resolvedPath);
    const contentType = getMimeTypeForExtension(path.extname(resolvedPath));
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': fileBuffer.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    res.end(fileBuffer);
  } catch {
    sendJson(res, 404, { ok: false, error: 'File not found' });
  }
}

async function readPaymentMethodsState() {
  if (Array.isArray(paymentMethodsSnapshotCache)) {
    return clonePaymentMethodsSnapshot(paymentMethodsSnapshotCache);
  }

  const cachedRaw = stateSnapshotCache?.snapshot?.state?.mlm_payment_methods;
  if (typeof cachedRaw === 'string') {
    const cachedParsed = safeParseJSON(cachedRaw);
    if (Array.isArray(cachedParsed)) {
      paymentMethodsSnapshotCache = clonePaymentMethodsSnapshot(cachedParsed);
      return clonePaymentMethodsSnapshot(cachedParsed);
    }
  }

  try {
    const raw = await readStateKeyValue('mlm_payment_methods');
    if (!raw) {
      paymentMethodsSnapshotCache = [];
      return [];
    }

    const parsed = safeParseJSON(raw);
    if (Array.isArray(parsed)) {
      paymentMethodsSnapshotCache = clonePaymentMethodsSnapshot(parsed);
      return clonePaymentMethodsSnapshot(parsed);
    }
  } catch (error) {
    if (Array.isArray(paymentMethodsSnapshotCache)) {
      return clonePaymentMethodsSnapshot(paymentMethodsSnapshotCache);
    }
    throw error;
  }

  paymentMethodsSnapshotCache = [];
  return [];
}

async function writePaymentMethodsState(methods) {
  const normalized = Array.isArray(methods) ? methods : [];
  const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(normalized);

  await upsertStateKeyValue('mlm_payment_methods', serialized, updatedAt);
  paymentMethodsSnapshotCache = clonePaymentMethodsSnapshot(normalized);

  if (stateSnapshotCache?.snapshot) {
    const nextSnapshot = cloneStateSnapshot(stateSnapshotCache.snapshot);
    nextSnapshot.state = { ...(nextSnapshot.state || {}), mlm_payment_methods: serialized };
    nextSnapshot.updatedAt = updatedAt;
    await setStateSnapshotCache(nextSnapshot);
  }

  return { updatedAt };
}

// ─── HTTP server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const v2HeaderValidationError = validateV2MutationHeaders(req, url);
  if (v2HeaderValidationError) {
    sendJson(res, v2HeaderValidationError.status, {
      ok: false,
      error: v2HeaderValidationError.error,
      code: v2HeaderValidationError.code
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    await serveUploadedFile(req, res, url);
    return;
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const mysqlHealth = await getMySQLHealth();
    sendJson(res, mysqlHealth.ok ? 200 : 503, {
      ok: mysqlHealth.ok,
      timestamp: new Date().toISOString(),
      storage: STORAGE_MODE,
      mode: STORAGE_MODE === 'file' ? 'snapshot_file' : 'key_value',
      database: MYSQL_DATABASE,
      mysql: mysqlHealth,
      stateKeys: DB_KEYS
    });
    return;
  }

  // GET state
  if (req.method === 'GET' && url.pathname === '/api/state') {
    try {
      const requestedKeys = (url.searchParams.get('keys') || '')
        .split(',').map((key) => key.trim()).filter(Boolean);
      const forceFresh = url.searchParams.get('force') === '1';
      if (requestedKeys.length > 0) {
        const snapshot = await getStateSnapshotCached({ keys: requestedKeys, forceFresh });
        sendJson(res, 200, snapshot, req);
      } else {
        const snapshot = await getStateSnapshotCached({ forceFresh });
        sendStateSnapshot(res, snapshot, req);
      }
    } catch (error) {
      const status = getHttpStatusForRequestError(error);
      const message = getErrorMessage(error, 'Failed to read state');
      console.error(`[GET /api/state] ${message}`);
      if (error && typeof error === 'object') {
        console.error('[GET /api/state] details', {
          code: error.code,
          errno: error.errno,
          sqlState: error.sqlState,
          sqlMessage: error.sqlMessage,
          sql: error.sql
        });
      }
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  // Login
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const result = await authenticateUser(parsed?.userId, parsed?.password);
      if (!result.ok) {
        sendJson(res, result.status, { ok: false, error: result.error });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        user: result.user,
        v2Auth: issueV2AccessTokenForUser(result.user) || {
          tokenType: 'Bearer',
          accessToken: null,
          issuer: V2_AUTH_TOKEN_ISSUER,
          expiresAt: null,
          note: V2_ALLOW_LEGACY_BEARER_USER_CODE
            ? 'Signed V2 auth token unavailable; legacy Bearer userCode compatibility remains enabled'
            : 'Signed V2 auth token unavailable because V2_AUTH_TOKEN_SECRET is not configured'
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request body';
      sendJson(res, 400, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/password-reset') {
    let connection;
    let transactionOpen = false;
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const userId = String(parsed?.userId || '').replace(/\D/g, '').slice(0, 7);
      const email = String(parsed?.email || '').trim().toLowerCase();
      const otp = normalizeOtpCode(parsed?.otp);
      const newPassword = String(parsed?.newPassword || '');

      if (!/^\d{7}$/.test(userId)) {
        sendJson(res, 400, { ok: false, error: 'User ID must be exactly 7 digits', code: 'INVALID_USER_ID' });
        return;
      }
      if (!email) {
        sendJson(res, 400, { ok: false, error: 'Email is required', code: 'EMAIL_REQUIRED' });
        return;
      }
      if (otp.length !== 6) {
        sendJson(res, 400, { ok: false, error: 'OTP must be a valid 6-digit code', code: 'INVALID_OTP' });
        return;
      }
      if (newPassword.length < 6) {
        sendJson(res, 400, { ok: false, error: 'Password must be at least 6 characters', code: 'INVALID_PASSWORD' });
        return;
      }

      const updatePasswordFromState = async (users, otpRecords) => {
        const userIndex = Array.isArray(users)
          ? users.findIndex((candidate) => String(candidate?.userId || '').trim() === userId)
          : -1;
        if (userIndex < 0) {
          throw createApiError(404, 'User ID not found', 'USER_NOT_FOUND');
        }

        const user = users[userIndex];
        if (String(user?.email || '').trim().toLowerCase() !== email) {
          throw createApiError(400, 'Email does not match this User ID', 'EMAIL_MISMATCH');
        }

        const otpMatch = findLatestValidOtpRecord(otpRecords, {
          identityKeys: [userId, user?.id, user?.userId],
          email,
          otp,
          purpose: 'profile_update'
        });
        if (!otpMatch.record || otpMatch.index < 0) {
          throw createApiError(400, 'Invalid or expired OTP', 'INVALID_OTP');
        }

        const updatedUsers = [...users];
        updatedUsers[userIndex] = {
          ...user,
          password: newPassword
        };
        return {
          updatedUsers,
          updatedOtpRecords: markOtpRecordUsed(otpRecords, otpMatch.index)
        };
      };

      if (STORAGE_MODE === 'file') {
        const users = safeParseJSON(await readStateKeyValue('mlm_users')) || [];
        const otpRecords = safeParseJSON(await readStateKeyValue('mlm_otp_records')) || [];
        const { updatedUsers, updatedOtpRecords } = await updatePasswordFromState(users, otpRecords);
        await writeStateToDB({
          mlm_users: JSON.stringify(updatedUsers),
          mlm_otp_records: JSON.stringify(updatedOtpRecords)
        }, false);
        sendJson(res, 200, { ok: true, message: 'Password updated successfully' });
        return;
      }

      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      const [rows] = await connection.execute(
        `SELECT state_key, state_value
         FROM state_store
         WHERE state_key IN ('mlm_users', 'mlm_otp_records')
         FOR UPDATE`
      );
      const stateByKey = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        stateByKey.set(String(row.state_key || ''), String(row.state_value || ''));
      }

      const users = safeParseJSON(stateByKey.get('mlm_users'));
      const otpRecords = safeParseJSON(stateByKey.get('mlm_otp_records'));
      const { updatedUsers, updatedOtpRecords } = await updatePasswordFromState(
        Array.isArray(users) ? users : [],
        Array.isArray(otpRecords) ? otpRecords : []
      );

      const nowDb = toMySQLDatetime(new Date().toISOString());
      await connection.execute(
        `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
        ['mlm_users', JSON.stringify(updatedUsers), nowDb]
      );
      await connection.execute(
        `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
        ['mlm_otp_records', JSON.stringify(updatedOtpRecords), nowDb]
      );

      await connection.commit();
      transactionOpen = false;
      invalidateStateSnapshotCache();

      sendJson(res, 200, { ok: true, message: 'Password updated successfully' });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch {
          // ignore rollback secondary error
        }
      }
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to reset password');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'PASSWORD_RESET_FAILED'
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/otp/send') {
    let connection;
    let transactionOpen = false;
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const identityKey = String(parsed?.identityKey || parsed?.userId || '').trim();
      const email = String(parsed?.email || '').trim().toLowerCase();
      const purpose = String(parsed?.purpose || '').trim();
      const userName = String(parsed?.userName || '').trim();
      const resolvedUserId = String(parsed?.resolvedUserId || '').trim();

      if (!identityKey) {
        sendJson(res, 400, { ok: false, error: 'identityKey is required', code: 'IDENTITY_KEY_REQUIRED' });
        return;
      }
      if (!email) {
        sendJson(res, 400, { ok: false, error: 'Email is required', code: 'EMAIL_REQUIRED' });
        return;
      }
      if (!['registration', 'profile_update', 'transaction', 'withdrawal'].includes(purpose)) {
        sendJson(res, 400, { ok: false, error: 'Invalid OTP purpose', code: 'INVALID_OTP_PURPOSE' });
        return;
      }

      if (purpose === 'profile_update') {
        const users = safeParseJSON(await readStateKeyValue('mlm_users')) || [];
        const matchedUser = Array.isArray(users)
          ? users.find((candidate) => String(candidate?.userId || '').trim() === identityKey)
          : null;
        if (!matchedUser) {
          sendJson(res, 404, { ok: false, error: 'User ID not found', code: 'USER_NOT_FOUND' });
          return;
        }
        if (String(matchedUser?.email || '').trim().toLowerCase() !== email) {
          sendJson(res, 400, { ok: false, error: 'Email does not match this User ID', code: 'EMAIL_MISMATCH' });
          return;
        }
      }

      const buildOtpRecords = (records) => {
        const nowIso = new Date().toISOString();
        const updatedRecords = Array.isArray(records)
          ? records.map((record) => {
            const recordUserKey = String(record?.userId || '').trim();
            const recordEmail = String(record?.email || '').trim().toLowerCase();
            const sameIdentity = recordUserKey === identityKey || recordEmail === email;
            if (sameIdentity && String(record?.purpose || '').trim() === purpose && !record?.isUsed) {
              return { ...record, isUsed: true };
            }
            return record;
          })
          : [];
        const otpRecord = {
          id: `otp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          userId: identityKey,
          email,
          otp: `${Math.floor(100000 + Math.random() * 900000)}`,
          purpose,
          createdAt: nowIso,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          isUsed: false
        };
        updatedRecords.push(otpRecord);
        return { updatedRecords, otpRecord };
      };

      let otpRecord;
      if (STORAGE_MODE === 'file') {
        const otpRecords = safeParseJSON(await readStateKeyValue('mlm_otp_records')) || [];
        const nextState = buildOtpRecords(Array.isArray(otpRecords) ? otpRecords : []);
        otpRecord = nextState.otpRecord;
        await writeStateToDB({
          mlm_otp_records: JSON.stringify(nextState.updatedRecords)
        }, false);
      } else {
        if (!pool) {
          sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
          return;
        }
        connection = await pool.getConnection();
        await connection.beginTransaction();
        transactionOpen = true;

        const [rows] = await connection.execute(
          `SELECT state_value
           FROM state_store
           WHERE state_key = 'mlm_otp_records'
           FOR UPDATE`
        );
        const otpRecordsRaw = Array.isArray(rows) && rows.length > 0 ? rows[0]?.state_value : '[]';
        const otpRecords = safeParseJSON(otpRecordsRaw);
        const nextState = buildOtpRecords(Array.isArray(otpRecords) ? otpRecords : []);
        otpRecord = nextState.otpRecord;

        await connection.execute(
          `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
          ['mlm_otp_records', JSON.stringify(nextState.updatedRecords), toMySQLDatetime(new Date().toISOString())]
        );

        await connection.commit();
        transactionOpen = false;
        invalidateStateSnapshotCache();
      }

      const emailResult = await sendOtpEmailBestEffort({
        to: email,
        otp: otpRecord?.otp,
        purpose,
        fullName: userName,
        userId: resolvedUserId
      });
      if (!emailResult.sent) {
        sendJson(res, 500, { ok: false, error: emailResult.error || 'Failed to send OTP email', code: 'OTP_EMAIL_SEND_FAILED' });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        message: 'OTP sent to your email'
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch {
          // ignore rollback secondary error
        }
      }
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to send OTP');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'OTP_SEND_FAILED'
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/otp/verify') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const identityKey = String(parsed?.identityKey || parsed?.userId || '').trim();
      const email = String(parsed?.email || '').trim().toLowerCase();
      const purpose = String(parsed?.purpose || '').trim();
      const otp = normalizeOtpCode(parsed?.otp);

      if (!identityKey) {
        sendJson(res, 400, { ok: false, error: 'identityKey is required', code: 'IDENTITY_KEY_REQUIRED' });
        return;
      }
      if (!email) {
        sendJson(res, 400, { ok: false, error: 'Email is required', code: 'EMAIL_REQUIRED' });
        return;
      }
      if (otp.length !== 6) {
        sendJson(res, 400, { ok: false, error: 'OTP must be a valid 6-digit code', code: 'INVALID_OTP' });
        return;
      }

      const otpRecords = safeParseJSON(await readStateKeyValue('mlm_otp_records')) || [];
      const otpMatch = findLatestValidOtpRecord(Array.isArray(otpRecords) ? otpRecords : [], {
        identityKeys: [identityKey],
        email,
        otp,
        purpose
      });
      if (!otpMatch.record) {
        sendJson(res, 400, { ok: false, error: 'Invalid or expired OTP', code: 'INVALID_OTP' });
        return;
      }

      sendJson(res, 200, { ok: true, message: 'OTP verified' });
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to verify OTP');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'OTP_VERIFY_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/registrations') {
    let connection;
    let transactionOpen = false;
    try {
      if (STORAGE_MODE !== 'mysql') {
        sendJson(res, 503, { ok: false, error: 'V2 registration API requires STORAGE_MODE=mysql', code: 'V2_REQUIRES_MYSQL' });
        return;
      }
      if (FINANCE_ENGINE_MODE !== 'v2') {
        sendJson(res, 409, { ok: false, error: 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/registrations', code: 'FINANCE_MODE_MISMATCH' });
        return;
      }
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};

      const rawRegistrationBearerToken = parseBearerToken(req);
      const authContext = rawRegistrationBearerToken
        ? await resolveV2RequestAuthContext({
          req,
          endpointName: V2_ATOMIC_REGISTRATION_ENDPOINT_NAME,
          requiredRole: 'user',
          allowImpersonation: true
        })
        : null;

      const fullName = String(parsed?.fullName || '').trim();
      const email = String(parsed?.email || '').trim();
      const password = String(parsed?.password || '');
      const transactionPassword = String(parsed?.transactionPassword || '');
      const phone = String(parsed?.phone || '').trim();
      const country = String(parsed?.country || '').trim();
      const sponsorId = String(parsed?.sponsorId || '').replace(/\D/g, '').slice(0, 7);
      const pinCode = String(parsed?.pinCode || '').trim().toUpperCase();
      const registrationOtp = normalizeOtpCode(parsed?.registrationOtp);
      const registrationOtpKey = String(
        parsed?.registrationOtpKey || `register_${email.trim().toLowerCase()}`
      ).trim();

      if (!fullName || !email || !password || !transactionPassword || !phone || !country) {
        sendJson(res, 400, { ok: false, error: 'Missing required registration fields', code: 'INVALID_REGISTRATION_PAYLOAD' });
        return;
      }
      if (!/^\d{7}$/.test(sponsorId)) {
        sendJson(res, 400, { ok: false, error: 'Sponsor ID must be exactly 7 digits', code: 'INVALID_SPONSOR_ID' });
        return;
      }
      if (!/^[A-Z0-9]{6,12}$/.test(pinCode)) {
        sendJson(res, 400, { ok: false, error: 'PIN code format is invalid', code: 'INVALID_PIN_FORMAT' });
        return;
      }
      if (registrationOtp.length !== 6) {
        sendJson(res, 400, { ok: false, error: 'Registration OTP must be a valid 6-digit code', code: 'INVALID_REGISTRATION_OTP' });
        return;
      }
      if (!registrationOtpKey) {
        sendJson(res, 400, { ok: false, error: 'Registration OTP key is required', code: 'REGISTRATION_OTP_KEY_REQUIRED' });
        return;
      }

      const normalizeMatrixSide = (position) => {
        if (position === 'left' || position === 0 || position === '0') return 'left';
        if (position === 'right' || position === 1 || position === '1') return 'right';
        return null;
      };

      const buildDefaultWallet = (userId) => ({
        userId,
        depositWallet: 0,
        fundRecoveryDue: 0,
        fundRecoveryRecoveredTotal: 0,
        fundRecoveryReason: null,
        pinWallet: 0,
        incomeWallet: 0,
        royaltyWallet: 0,
        matrixWallet: 0,
        lockedIncomeWallet: 0,
        giveHelpLocked: 0,
        totalReceived: 0,
        totalGiven: 0,
        pendingSystemFee: 0,
        lastSystemFeeDate: null,
        rewardPoints: 0,
        totalRewardPointsEarned: 0,
        totalRewardPointsRedeemed: 0
      });

      const toNonNegativeCents = (amount) => {
        const normalized = Number(amount);
        if (!Number.isFinite(normalized)) return 0;
        return Math.max(0, Math.trunc(Math.round(normalized * 100)));
      };

      const ensureV2UserAndWallets = async (legacyUser, legacyWallet) => {
        const userCode = normalizeV2UserCode(legacyUser?.userId);
        if (!isValidV2UserCode(userCode)) {
          throw createApiError(400, 'Invalid legacy user mapping for v2 provisioning', 'V2_PROVISION_USER_CODE_INVALID');
        }

        const legacyUserId = String(legacyUser?.id || '').trim() || null;
        const fullNameValue = String(legacyUser?.fullName || userCode).trim().slice(0, 150) || userCode;
        const emailValue = String(legacyUser?.email || '').trim().slice(0, 190) || null;
        const v2Status = isLegacyUserEligibleForV2Access(legacyUser) ? 'active' : 'blocked';

        await connection.execute(
          `INSERT INTO v2_users
            (legacy_user_id, user_code, full_name, email, status)
           VALUES
            (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            full_name = VALUES(full_name),
            email = VALUES(email),
            status = VALUES(status),
            updated_at = NOW(3)`,
          [legacyUserId, userCode, fullNameValue, emailValue, v2Status]
        );

        const [v2UserRows] = await connection.execute(
          `SELECT id, user_code
           FROM v2_users
           WHERE user_code = ?
           LIMIT 1
           FOR UPDATE`,
          [userCode]
        );
        const v2User = Array.isArray(v2UserRows) ? v2UserRows[0] : null;
        if (!v2User) {
          throw createApiError(500, 'Failed to load provisioned v2 user', 'V2_PROVISION_USER_LOAD_FAILED');
        }

        const walletBlueprints = [
          { walletType: 'fund', openingCents: toNonNegativeCents(legacyWallet?.depositWallet) },
          { walletType: 'income', openingCents: toNonNegativeCents(legacyWallet?.incomeWallet) },
          { walletType: 'royalty', openingCents: toNonNegativeCents(legacyWallet?.royaltyWallet) }
        ];

        for (const walletSpec of walletBlueprints) {
          const accountCode = `USR_${userCode}_${String(walletSpec.walletType).toUpperCase()}`.slice(0, 80);
          const accountName = `${userCode} ${walletSpec.walletType} wallet`.slice(0, 160);

          await connection.execute(
            `INSERT INTO v2_gl_accounts
              (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
             VALUES
              (?, ?, 'LIABILITY', ?, ?, 0, 1)
             ON DUPLICATE KEY UPDATE
              account_name = VALUES(account_name),
              account_type = VALUES(account_type),
              owner_user_id = VALUES(owner_user_id),
              wallet_type = VALUES(wallet_type),
              is_system_account = 0,
              is_active = 1`,
            [accountCode, accountName, Number(v2User.id), walletSpec.walletType]
          );

          const [glRows] = await connection.execute(
            `SELECT id
             FROM v2_gl_accounts
             WHERE account_code = ?
             LIMIT 1
             FOR UPDATE`,
            [accountCode]
          );
          const glAccount = Array.isArray(glRows) ? glRows[0] : null;
          if (!glAccount) {
            throw createApiError(500, 'Failed to load user GL account for v2 provisioning', 'V2_PROVISION_GL_LOAD_FAILED');
          }

          await connection.execute(
            `INSERT INTO v2_wallet_accounts
              (user_id, wallet_type, gl_account_id, baseline_amount_cents, current_amount_cents, currency, version)
             VALUES
              (?, ?, ?, ?, ?, 'INR', 0)
             ON DUPLICATE KEY UPDATE
              gl_account_id = VALUES(gl_account_id),
              updated_at = NOW(3)`,
            [
              Number(v2User.id),
              walletSpec.walletType,
              Number(glAccount.id),
              walletSpec.openingCents,
              walletSpec.openingCents
            ]
          );
        }

        return { userId: Number(v2User.id), userCode };
      };

      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      const keysToLock = [
        'mlm_users',
        'mlm_wallets',
        'mlm_matrix',
        'mlm_pins',
        'mlm_otp_records',
        'mlm_transactions',
        'mlm_notifications',
        'mlm_safety_pool'
      ];
      const placeholders = keysToLock.map(() => '?').join(', ');
      const [stateRows] = await connection.execute(
        `SELECT state_key, state_value
         FROM state_store
         WHERE state_key IN (${placeholders})
         FOR UPDATE`,
        keysToLock
      );

      const stateByKey = new Map();
      for (const row of Array.isArray(stateRows) ? stateRows : []) {
        stateByKey.set(String(row.state_key), String(row.state_value || ''));
      }

      const parseStateArray = (key) => {
        const parsedValue = safeParseJSON(stateByKey.get(key));
        return Array.isArray(parsedValue) ? parsedValue : [];
      };
      const parseStateObject = (key, fallback) => {
        const parsedValue = safeParseJSON(stateByKey.get(key));
        return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
          ? parsedValue
          : fallback;
      };

      const users = parseStateArray('mlm_users');
      const wallets = parseStateArray('mlm_wallets');
      const matrix = parseStateArray('mlm_matrix');
      const pins = parseStateArray('mlm_pins');
      const otpRecords = parseStateArray('mlm_otp_records');
      const transactions = parseStateArray('mlm_transactions');
      const notifications = parseStateArray('mlm_notifications');
      const safetyPool = parseStateObject('mlm_safety_pool', { totalAmount: 0, transactions: [] });
      if (!Array.isArray(safetyPool.transactions)) {
        safetyPool.transactions = [];
      }

      const usersByUserId = new Map(users.map((user) => [String(user?.userId || ''), user]));
      const usersByInternalId = new Map(users.map((user) => [String(user?.id || ''), user]));

      let actorUser = null;
      if (authContext?.actorUserCode) {
        const actorUserCode = normalizeV2UserCode(authContext.actorUserCode);
        actorUser = usersByUserId.get(actorUserCode) || null;
        if (!actorUser) {
          throw createApiError(403, 'Actor user is not available in legacy state', 'ACTOR_NOT_FOUND_IN_STATE');
        }
      }

      const sponsorUser = usersByUserId.get(sponsorId);
      if (!sponsorUser) {
        throw createApiError(404, 'Sponsor user not found', 'SPONSOR_NOT_FOUND');
      }
      if (!isLegacyUserEligibleForV2Access(sponsorUser)) {
        throw createApiError(403, 'Sponsor account is inactive or blocked', 'SPONSOR_NOT_ACTIVE');
      }

      const pinIndex = pins.findIndex((pin) => String(pin?.pinCode || '').trim().toUpperCase() === pinCode);
      if (pinIndex === -1) {
        throw createApiError(404, 'PIN not found', 'PIN_NOT_FOUND');
      }

      const selectedPin = pins[pinIndex];
      const selectedPinStatus = String(selectedPin?.status || '').toLowerCase();
      if (selectedPinStatus === 'suspended') {
        throw createApiError(409, 'PIN is suspended by admin', 'PIN_SUSPENDED');
      }

      if (selectedPinStatus !== 'unused') {
      const replayUserRef = String(selectedPin?.registrationUserId || selectedPin?.usedById || '').trim();
        const replayUser = usersByInternalId.get(replayUserRef) || usersByUserId.get(replayUserRef);
        if (replayUser?.userId) {
          const replaySponsorUserCode = normalizeV2UserCode(replayUser.sponsorId);
          const replaySponsorUser = isValidV2UserCode(replaySponsorUserCode)
            ? usersByUserId.get(replaySponsorUserCode) || null
            : null;

          const walletByInternalId = new Map(
            wallets.map((wallet) => [String(wallet?.userId || ''), wallet])
          );

          await ensureV2UserAndWallets(
            replayUser,
            walletByInternalId.get(String(replayUser.id)) || null
          );

          if (replaySponsorUser) {
            await ensureV2UserAndWallets(
              replaySponsorUser,
              walletByInternalId.get(String(replaySponsorUser.id)) || null
            );
          }

          const replayContributionPlan = await buildLegacyActivationContributionPlanFromMatrixState(connection, replayUser.userId);
          const replayProvisionedCodes = new Set();
          for (const step of Array.isArray(replayContributionPlan) ? replayContributionPlan : []) {
            const beneficiaryUserCode = normalizeV2UserCode(step?.beneficiaryUserCode);
            if (!isValidV2UserCode(beneficiaryUserCode) || replayProvisionedCodes.has(beneficiaryUserCode)) {
              continue;
            }
            const beneficiaryLegacyUser = usersByUserId.get(beneficiaryUserCode);
            if (!beneficiaryLegacyUser) {
              continue;
            }

            await ensureV2UserAndWallets(
              beneficiaryLegacyUser,
              walletByInternalId.get(String(beneficiaryLegacyUser.id)) || null
            );
            replayProvisionedCodes.add(beneficiaryUserCode);
          }

          await connection.commit();
          transactionOpen = false;
          invalidateStateSnapshotCache();

          const {
            referralResult,
            helpEventResult,
            sideEffectWarnings
          } = await settleRegistrationSideEffects({
            createdUser: replayUser,
            sponsorUser: replaySponsorUser,
            pinCode
          });

          sendJson(res, 200, {
            ok: true,
            userId: replayUser.userId,
            sponsorUserId: String(replayUser.sponsorId || ''),
            pinCode,
            idempotentReplay: true,
            welcomeEmailDispatched: false,
            message: `Registration already completed for User ID ${replayUser.userId}`,
            referralSettled: !!referralResult,
            helpSettled: !!helpEventResult,
            sideEffectWarnings,
            referralResult,
            helpEventResult
          });
          return;
        }
        throw createApiError(409, 'PIN has already been used', 'PIN_ALREADY_USED');
      }

      const registrationOtpMatch = findLatestValidOtpRecord(otpRecords, {
        identityKeys: [registrationOtpKey],
        email,
        otp: registrationOtp,
        purpose: 'registration'
      });
      if (!registrationOtpMatch.record || registrationOtpMatch.index < 0) {
        throw createApiError(400, 'Registration OTP is invalid or expired', 'INVALID_REGISTRATION_OTP');
      }

      const pinOwnerRef = String(selectedPin?.ownerId || '').trim();
      const pinOwnerUser = usersByInternalId.get(pinOwnerRef) || usersByUserId.get(pinOwnerRef);
      if (!pinOwnerUser?.userId) {
        throw createApiError(409, 'PIN owner mapping is invalid', 'PIN_OWNER_NOT_FOUND');
      }
      if (actorUser && String(pinOwnerUser.userId) !== String(actorUser.userId)) {
        throw createApiError(403, 'PIN does not belong to the authenticated actor', 'PIN_OWNER_MISMATCH');
      }

      const existingUserIds = new Set(users.map((user) => String(user?.userId || '').trim()));
      let generatedUserId = '';
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const candidate = `${Math.floor(1000000 + Math.random() * 9000000)}`;
        if (!existingUserIds.has(candidate)) {
          generatedUserId = candidate;
          break;
        }
      }
      if (!generatedUserId) {
        throw createApiError(500, 'Unable to allocate unique User ID', 'USER_ID_GENERATION_FAILED');
      }

      const matrixByUserId = new Map(matrix.map((node) => [String(node?.userId || ''), node]));
      const ensureMatrixNodeForUser = (userCode, visiting = new Set()) => {
        const normalized = String(userCode || '').trim();
        if (!normalized) return null;
        if (matrixByUserId.has(normalized)) {
          return matrixByUserId.get(normalized);
        }
        if (visiting.has(normalized)) {
          return null;
        }
        visiting.add(normalized);

        const user = usersByUserId.get(normalized);
        if (!user) return null;

        let parentNode = null;
        if (user.parentId) {
          parentNode = ensureMatrixNodeForUser(String(user.parentId), visiting);
          if (!parentNode) return null;
        } else if (!user.isAdmin && user.userId !== '1000001') {
          return null;
        }

        const side = user.parentId ? normalizeMatrixSide(user.position) : 'left';
        if (user.parentId && !side) return null;

        const node = {
          userId: user.userId,
          username: user.fullName,
          level: parentNode ? Number(parentNode.level || 0) + 1 : 0,
          position: side === 'right' ? 1 : 0,
          parentId: parentNode?.userId,
          isActive: !!user.isActive && user.accountStatus !== 'permanent_blocked' && user.accountStatus !== 'temp_blocked'
        };

        matrix.push(node);
        matrixByUserId.set(node.userId, node);

        if (parentNode) {
          if (side === 'left' && !parentNode.leftChild) parentNode.leftChild = node.userId;
          if (side === 'right' && !parentNode.rightChild) parentNode.rightChild = node.userId;
        }

        return node;
      };

      const sponsorNode = ensureMatrixNodeForUser(sponsorUser.userId);
      if (!sponsorNode) {
        throw createApiError(409, 'Sponsor matrix node is not available', 'SPONSOR_MATRIX_NODE_MISSING');
      }

      const childSideMap = new Map();
      const setChild = (parentId, side, childId) => {
        if (!parentId || !childId || !side) return;
        if (!matrixByUserId.has(parentId) || !matrixByUserId.has(childId)) return;
        const current = childSideMap.get(parentId) || {};
        if (side === 'left' && !current.left) current.left = childId;
        if (side === 'right' && !current.right) current.right = childId;
        childSideMap.set(parentId, current);
      };

      for (const node of matrix) {
        const parentId = String(node?.parentId || '').trim();
        const nodeUserId = String(node?.userId || '').trim();
        setChild(parentId, normalizeMatrixSide(node?.position), nodeUserId);
      }
      for (const node of matrix) {
        const nodeUserId = String(node?.userId || '').trim();
        setChild(nodeUserId, 'left', String(node?.leftChild || '').trim());
        setChild(nodeUserId, 'right', String(node?.rightChild || '').trim());
      }

      const queue = [sponsorNode.userId];
      const visited = new Set();
      let placement = null;
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId || visited.has(currentId)) continue;
        visited.add(currentId);

        const currentNode = matrixByUserId.get(currentId);
        if (!currentNode) continue;
        const children = childSideMap.get(currentId) || {};
        if (!children.left) {
          placement = { parentId: currentId, position: 'left' };
          break;
        }
        if (!children.right) {
          placement = { parentId: currentId, position: 'right' };
          break;
        }
        queue.push(children.left, children.right);
      }

      if (!placement) {
        throw createApiError(409, 'No matrix placement slot found for sponsor', 'MATRIX_PLACEMENT_NOT_FOUND');
      }

      const nowIso = new Date().toISOString();
      const updatedOtpRecords = markOtpRecordUsed(otpRecords, registrationOtpMatch.index);
      const createdUser = {
        id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: generatedUserId,
        email,
        password,
        fullName,
        phone,
        country,
        isActive: true,
        isAdmin: false,
        accountStatus: 'active',
        blockedAt: null,
        blockedUntil: null,
        blockedReason: null,
        deactivationReason: null,
        reactivatedAt: null,
        createdAt: nowIso,
        activatedAt: nowIso,
        gracePeriodEnd: null,
        sponsorId: sponsorUser.userId,
        parentId: placement.parentId,
        position: placement.position,
        level: 0,
        directCount: 0,
        totalEarnings: 0,
        isCapped: false,
        capLevel: 0,
        reEntryCount: 0,
        cycleCount: 0,
        requiredDirectForNextLevel: 2,
        completedDirectForCurrentLevel: 0,
        transactionPassword,
        emailVerified: false,
        achievements: {
          nationalTour: false,
          internationalTour: false,
          familyTour: false
        }
      };

      users.push(createdUser);
      usersByUserId.set(createdUser.userId, createdUser);
      usersByInternalId.set(createdUser.id, createdUser);

      if (!wallets.some((wallet) => String(wallet?.userId || '') === createdUser.id)) {
        wallets.push(buildDefaultWallet(createdUser.id));
      }

      const updatedPin = {
        ...selectedPin,
        status: 'used',
        usedAt: nowIso,
        usedById: createdUser.id,
        registrationUserId: createdUser.id
      };
      pins[pinIndex] = updatedPin;

      const parentNode = matrixByUserId.get(placement.parentId) || null;
      const matrixNode = {
        userId: createdUser.userId,
        username: createdUser.fullName,
        level: parentNode ? Number(parentNode.level || 0) + 1 : 0,
        position: placement.position === 'left' ? 0 : 1,
        parentId: placement.parentId,
        isActive: true
      };
      matrix.push(matrixNode);
      matrixByUserId.set(matrixNode.userId, matrixNode);

      if (parentNode) {
        if (placement.position === 'left' && !parentNode.leftChild) {
          parentNode.leftChild = matrixNode.userId;
        }
        if (placement.position === 'right' && !parentNode.rightChild) {
          parentNode.rightChild = matrixNode.userId;
        }
      }

      sponsorUser.directCount = users.filter((member) => String(member?.sponsorId || '') === sponsorUser.userId).length;

      transactions.push({
        id: `tx_${Date.now()}_pin_used_backend_${createdUser.userId}`,
        userId: createdUser.id,
        type: 'pin_used',
        amount: Number(updatedPin.amount || 11),
        pinCode,
        pinId: String(updatedPin.id || ''),
        status: 'completed',
        description: 'Account activation using PIN',
        createdAt: nowIso,
        completedAt: nowIso
      });

      safetyPool.totalAmount = Number(safetyPool.totalAmount || 0) + 1;
      safetyPool.transactions.push({
        id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        amount: 1,
        fromUserId: createdUser.id,
        reason: 'Admin fee',
        createdAt: nowIso
      });

      notifications.push({
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: createdUser.id,
        title: 'Welcome To ReferNex',
        message: `Welcome to ReferNex.\n\nAccount created successfully. Your User ID is ${createdUser.userId}. Please check your email for your login and transaction passwords.`,
        type: 'success',
        isRead: false,
        createdAt: nowIso
      });

      const walletByInternalId = new Map(
        wallets.map((wallet) => [String(wallet?.userId || ''), wallet])
      );

      await ensureV2UserAndWallets(
        sponsorUser,
        walletByInternalId.get(String(sponsorUser.id)) || null
      );

      await ensureV2UserAndWallets(
        createdUser,
        walletByInternalId.get(String(createdUser.id)) || null
      );

      const contributionPlan = await buildLegacyActivationContributionPlanFromMatrixState(connection, createdUser.userId);
      const provisionedBeneficiaryCodes = new Set();
      for (const step of Array.isArray(contributionPlan) ? contributionPlan : []) {
        const beneficiaryUserCode = normalizeV2UserCode(step?.beneficiaryUserCode);
        if (!isValidV2UserCode(beneficiaryUserCode) || provisionedBeneficiaryCodes.has(beneficiaryUserCode)) {
          continue;
        }
        const beneficiaryLegacyUser = usersByUserId.get(beneficiaryUserCode);
        if (!beneficiaryLegacyUser) {
          continue;
        }

        await ensureV2UserAndWallets(
          beneficiaryLegacyUser,
          walletByInternalId.get(String(beneficiaryLegacyUser.id)) || null
        );
        provisionedBeneficiaryCodes.add(beneficiaryUserCode);
      }

      const nowDb = toMySQLDatetime(nowIso);
      const upsertStateKey = async (key, value) => {
        await connection.execute(
          `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
          [key, JSON.stringify(value), nowDb]
        );
      };

      await upsertStateKey('mlm_users', users);
      await upsertStateKey('mlm_wallets', wallets);
      await upsertStateKey('mlm_matrix', matrix);
      await upsertStateKey('mlm_pins', pins);
      await upsertStateKey('mlm_otp_records', updatedOtpRecords);
      await upsertStateKey('mlm_transactions', transactions);
      await upsertStateKey('mlm_notifications', notifications);
      await upsertStateKey('mlm_safety_pool', safetyPool);

      await connection.commit();
      transactionOpen = false;
      invalidateStateSnapshotCache();

      let sideEffectWarnings = [];
      let referralResult = null;
      let helpEventResult = null;
      let welcomeEmailDispatched = false;

      const welcomeEmailResult = await sendRegistrationWelcomeEmailBestEffort({
        to: createdUser.email,
        fullName: createdUser.fullName,
        userId: createdUser.userId,
        email: createdUser.email,
        phone: createdUser.phone,
        loginPassword: createdUser.password,
        transactionPassword: createdUser.transactionPassword
      });
      if (welcomeEmailResult.sent) {
        welcomeEmailDispatched = true;
      } else {
        sideEffectWarnings.push(`Welcome email pending: ${welcomeEmailResult.error}`);
      }

      const registrationSettlement = await settleRegistrationSideEffects({
        createdUser,
        sponsorUser,
        pinCode
      });
      referralResult = registrationSettlement.referralResult;
      helpEventResult = registrationSettlement.helpEventResult;
      sideEffectWarnings = sideEffectWarnings.concat(registrationSettlement.sideEffectWarnings || []);

      sendJson(res, 200, {
        ok: true,
        idempotentReplay: false,
        userId: createdUser.userId,
        sponsorUserId: sponsorUser.userId,
        pinCode,
        welcomeEmailDispatched,
        referralSettled: !!referralResult,
        helpSettled: !!helpEventResult,
        sideEffectWarnings,
        referralResult,
        helpEventResult
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch {
          // ignore rollback failure
        }
      }

      const status = Number(error?.status) || getHttpStatusForRequestError(error);
      const message = getErrorMessage(error, 'Failed to register user');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_REGISTRATION_FAILED'
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/wallet') {
    try {
      if (STORAGE_MODE !== 'mysql') {
        sendJson(res, 503, { ok: false, error: 'V2 financial APIs require STORAGE_MODE=mysql', code: 'V2_REQUIRES_MYSQL' });
        return;
      }
      if (FINANCE_ENGINE_MODE !== 'v2') {
        sendJson(res, 409, { ok: false, error: 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/wallet', code: 'FINANCE_MODE_MISMATCH' });
        return;
      }
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_WALLET_READ_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });

      const requestedUserCode = normalizeV2UserCode(url.searchParams.get('userCode') || authContext.actorUserCode);
      if (!isValidV2UserCode(requestedUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'userCode is required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (requestedUserCode !== authContext.actorUserCode) {
        sendJson(res, 403, {
          ok: false,
          error: 'Actor is only allowed to read their effective userCode wallet snapshot',
          code: 'ACTOR_USER_MISMATCH'
        });
        return;
      }

      const user = await resolveV2UserForReadByCode(requestedUserCode);
      const walletSnapshot = await readV2WalletSnapshotByUserId(user.userId, user.userCode);

      sendJson(res, 200, {
        ok: true,
        userCode: user.userCode,
        wallet: {
          fundCents: walletSnapshot.balancesCents.fund,
          incomeCents: walletSnapshot.balancesCents.income,
          royaltyCents: walletSnapshot.balancesCents.royalty,
          lockedIncomeCents: walletSnapshot.lockedBreakdownCents.totalLockedIncome,
          lockedForGiveCents: walletSnapshot.lockedBreakdownCents.lockedForGive,
          lockedForQualificationCents: walletSnapshot.lockedBreakdownCents.lockedForQualification,
          pendingGiveCents: walletSnapshot.lockedBreakdownCents.pendingGive,
          totalReceivedCents: walletSnapshot.lifetimeTotalsCents.totalReceived,
          totalGivenCents: walletSnapshot.lifetimeTotalsCents.totalGiven,
          updatedAt: walletSnapshot.updatedAt
        }
      });
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : getHttpStatusForRequestError(error));
      const message = getErrorMessage(error, 'Failed to read V2 wallet snapshot');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_WALLET_READ_FAILED'
      });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/transactions') {
    try {
      if (STORAGE_MODE !== 'mysql') {
        sendJson(res, 503, { ok: false, error: 'V2 financial APIs require STORAGE_MODE=mysql', code: 'V2_REQUIRES_MYSQL' });
        return;
      }
      if (FINANCE_ENGINE_MODE !== 'v2') {
        sendJson(res, 409, { ok: false, error: 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/transactions', code: 'FINANCE_MODE_MISMATCH' });
        return;
      }
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_TRANSACTIONS_READ_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });

      const requestedUserCode = normalizeV2UserCode(url.searchParams.get('userCode') || authContext.actorUserCode);
      if (!isValidV2UserCode(requestedUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'userCode is required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (requestedUserCode !== authContext.actorUserCode) {
        sendJson(res, 403, {
          ok: false,
          error: 'Actor is only allowed to read their effective userCode transactions',
          code: 'ACTOR_USER_MISMATCH'
        });
        return;
      }

      const user = await resolveV2UserForReadByCode(requestedUserCode);
      const limit = normalizeV2ReadLimit(url.searchParams.get('limit'), 100, 300);
      const transactions = await readV2LedgerEntriesByUserId(user.userId, limit);

      sendJson(res, 200, {
        ok: true,
        userCode: user.userCode,
        count: transactions.length,
        transactions
      });
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : getHttpStatusForRequestError(error));
      const message = getErrorMessage(error, 'Failed to read V2 transactions');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_TRANSACTIONS_READ_FAILED'
      });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/v2/pins') {
    try {
      if (STORAGE_MODE !== 'mysql') {
        sendJson(res, 503, { ok: false, error: 'V2 financial APIs require STORAGE_MODE=mysql', code: 'V2_REQUIRES_MYSQL' });
        return;
      }
      if (FINANCE_ENGINE_MODE !== 'v2') {
        sendJson(res, 409, { ok: false, error: 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/pins', code: 'FINANCE_MODE_MISMATCH' });
        return;
      }
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_PINS_READ_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });

      const requestedUserCode = normalizeV2UserCode(url.searchParams.get('userCode') || authContext.actorUserCode);
      if (!isValidV2UserCode(requestedUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'userCode is required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (requestedUserCode !== authContext.actorUserCode) {
        sendJson(res, 403, {
          ok: false,
          error: 'Actor is only allowed to read their effective userCode pins',
          code: 'ACTOR_USER_MISMATCH'
        });
        return;
      }

      const user = await resolveV2UserForReadByCode(requestedUserCode);
      const limit = normalizeV2ReadLimit(url.searchParams.get('limit'), 300, 1000);
      const pins = await readV2PinsByUserId(user.userId, limit);

      sendJson(res, 200, {
        ok: true,
        userCode: user.userCode,
        count: pins.length,
        pins
      });
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : getHttpStatusForRequestError(error));
      const message = getErrorMessage(error, 'Failed to read V2 pins');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_PINS_READ_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/pin-transfers') {
    let connection;
    let transactionOpen = false;
    try {
      if (STORAGE_MODE !== 'mysql') {
        sendJson(res, 503, { ok: false, error: 'V2 pin transfer API requires STORAGE_MODE=mysql', code: 'V2_REQUIRES_MYSQL' });
        return;
      }
      if (FINANCE_ENGINE_MODE !== 'v2') {
        sendJson(res, 409, { ok: false, error: 'FINANCE_ENGINE_MODE must be v2 to use /api/v2/pin-transfers', code: 'FINANCE_MODE_MISMATCH' });
        return;
      }
      if (!pool) {
        sendJson(res, 503, { ok: false, error: 'MySQL pool not initialized', code: 'MYSQL_POOL_NOT_READY' });
        return;
      }

      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: 'v2_pin_transfer',
        requiredRole: 'user',
        allowImpersonation: true
      });

      const actorUserCode = authContext.actorUserCode;
      const fromUserCode = normalizeV2UserCode(parsed?.fromUserCode || actorUserCode);
      const toUserCode = normalizeV2UserCode(parsed?.toUserCode);
      const pinId = typeof parsed?.pinId === 'string' ? parsed.pinId.trim() : '';
      const pinCode = typeof parsed?.pinCode === 'string' ? parsed.pinCode.trim().toUpperCase() : '';
      const transactionPassword = String(parsed?.transactionPassword || '');
      const otp = normalizeOtpCode(parsed?.otp);

      if (!isValidV2UserCode(fromUserCode) || !isValidV2UserCode(toUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'fromUserCode and toUserCode are required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (fromUserCode === toUserCode) {
        sendJson(res, 400, {
          ok: false,
          error: 'fromUserCode and toUserCode must be different',
          code: 'SELF_TRANSFER_NOT_ALLOWED'
        });
        return;
      }
      if (fromUserCode !== actorUserCode) {
        sendJson(res, 403, {
          ok: false,
          error: 'Actor is only allowed to transfer from their own fromUserCode',
          code: 'ACTOR_USER_MISMATCH'
        });
        return;
      }
      if (!pinId && !pinCode) {
        sendJson(res, 400, {
          ok: false,
          error: 'pinId or pinCode is required',
          code: 'MISSING_PIN_REFERENCE'
        });
        return;
      }

      const isInChain = await areUsersInSameLegacyChain(fromUserCode, toUserCode);
      if (!isInChain) {
        sendJson(res, 403, {
          ok: false,
          error: 'PIN can only be transferred to upline or downline members',
          code: 'CHAIN_TRANSFER_ONLY'
        });
        return;
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      const stateKeys = ['mlm_users', 'mlm_pins', 'mlm_pin_transfers'];
      const placeholders = stateKeys.map(() => '?').join(', ');
      const [stateRows] = await connection.execute(
        `SELECT state_key, state_value
         FROM state_store
         WHERE state_key IN (${placeholders})
         FOR UPDATE`,
        stateKeys
      );

      const stateByKey = new Map();
      for (const row of Array.isArray(stateRows) ? stateRows : []) {
        stateByKey.set(String(row?.state_key || ''), row?.state_value);
      }

      const usersParsed = safeParseJSON(stateByKey.get('mlm_users'));
      const pinsParsed = safeParseJSON(stateByKey.get('mlm_pins'));
      const transfersParsed = safeParseJSON(stateByKey.get('mlm_pin_transfers'));
      const users = Array.isArray(usersParsed) ? usersParsed : [];
      const pins = Array.isArray(pinsParsed) ? pinsParsed : [];
      const pinTransfers = Array.isArray(transfersParsed) ? transfersParsed : [];

      const usersByInternalId = new Map(users.map((user) => [String(user?.id || '').trim(), user]));
      const usersByUserCode = new Map(
        users
          .map((user) => [normalizeV2UserCode(user?.userId), user])
          .filter(([code]) => !!code)
      );

      const fromUser = usersByUserCode.get(fromUserCode) || null;
      const toUser = usersByUserCode.get(toUserCode) || null;
      if (!fromUser || !toUser) {
        throw createApiError(404, 'Sender or recipient user not found', 'USER_NOT_FOUND');
      }
      if (!isLegacyUserEligibleForV2Access(fromUser) || !isLegacyUserEligibleForV2Access(toUser)) {
        throw createApiError(403, 'Sender or recipient account is inactive or blocked', 'USER_NOT_ACTIVE');
      }

      await validateAndConsumeSensitiveActionCredentials(connection, {
        actorUserCode: fromUserCode,
        transactionPassword,
        otp,
        otpPurpose: 'transaction',
        skipValidation: authContext.authSubjectIsAdmin && authContext.isImpersonated
      });

      const normalizedPinCode = String(pinCode || '').trim().toUpperCase();
      const pinIndex = pinId
        ? pins.findIndex((pin) => String(pin?.id || '').trim() === pinId)
        : pins.findIndex((pin) => String(pin?.pinCode || '').trim().toUpperCase() === normalizedPinCode);
      if (pinIndex === -1) {
        throw createApiError(404, 'PIN not found', 'PIN_NOT_FOUND');
      }

      const selectedPin = pins[pinIndex];
      const selectedPinStatus = String(selectedPin?.status || '').toLowerCase();
      if (selectedPinStatus === 'suspended') {
        throw createApiError(409, 'Suspended PIN cannot be transferred', 'PIN_SUSPENDED');
      }
      if (selectedPinStatus !== 'unused') {
        throw createApiError(409, 'Only unused PIN can be transferred', 'PIN_ALREADY_USED');
      }

      const ownerRef = String(selectedPin?.ownerId || '').trim();
      const ownerUser = usersByInternalId.get(ownerRef) || usersByUserCode.get(normalizeV2UserCode(ownerRef));
      const ownerMatches = ownerRef === String(fromUser.id)
        || ownerRef === String(fromUser.userId)
        || (ownerUser && normalizeV2UserCode(ownerUser.userId) === fromUserCode);
      if (!ownerMatches) {
        throw createApiError(403, 'PIN does not belong to sender', 'PIN_NOT_OWNED');
      }

      const nowIso = new Date().toISOString();
      const transferredPinCode = String(selectedPin?.pinCode || '').trim().toUpperCase();
      pins[pinIndex] = {
        ...selectedPin,
        ownerId: String(toUser.id),
        transferredFrom: String(fromUser.id),
        transferredAt: nowIso
      };

      if (transferredPinCode) {
        await connection.execute(
          `UPDATE v2_pins
           SET status = 'transferred', updated_at = NOW(3)
           WHERE pin_code = ? AND status IN ('generated', 'unused')`,
          [transferredPinCode]
        ).catch(() => {
          // Best-effort legacy/v2 alignment; transfer should not fail if v2_pins row is absent.
        });
      }

      const transferRecord = {
        id: `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pinId: String(pins[pinIndex].id || ''),
        pinCode: String(pins[pinIndex].pinCode || ''),
        fromUserId: String(fromUser.id),
        fromUserName: String(fromUser.fullName || fromUser.userId || ''),
        toUserId: String(toUser.id),
        toUserName: String(toUser.fullName || toUser.userId || ''),
        transferredAt: nowIso
      };
      pinTransfers.push(transferRecord);

      const nowDb = toMySQLDatetime(nowIso);
      const upsertStateKey = async (key, value) => {
        await connection.execute(
          `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
          [key, JSON.stringify(value), nowDb]
        );
      };

      await upsertStateKey('mlm_pins', pins);
      await upsertStateKey('mlm_pin_transfers', pinTransfers);

      await connection.commit();
      transactionOpen = false;
      invalidateStateSnapshotCache();

      sendJson(res, 200, {
        ok: true,
        transferId: transferRecord.id,
        pinId: transferRecord.pinId,
        pinCode: transferRecord.pinCode,
        fromUserCode,
        toUserCode,
        transferredAt: nowIso
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch {
          // ignore rollback secondary error
        }
      }

      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to transfer PIN');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_PIN_TRANSFER_FAILED'
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/fund-transfers') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_FUND_TRANSFER_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });
      const allowInactiveActor = authContext.authSubjectIsAdmin && authContext.isImpersonated;
      const actorUserCode = authContext.actorUserCode;
      const senderUserCode = normalizeV2UserCode(parsed?.senderUserCode);
      const receiverUserCode = normalizeV2UserCode(parsed?.receiverUserCode);
      const sourceWallet = String(parsed?.sourceWallet || 'fund').trim().toLowerCase();
      const destinationWallet = String(parsed?.destinationWallet || 'fund').trim().toLowerCase();
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? Math.trunc(amountCentsRaw) : NaN;
      const transactionPassword = String(parsed?.transactionPassword || '');
      const otp = normalizeOtpCode(parsed?.otp);
      const normalizedProgress = normalizeV2FundTransferProgressUpdates(
        parsed?.progressUpdates,
        senderUserCode,
        receiverUserCode
      );
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
      const referenceId = typeof parsed?.referenceId === 'string' ? parsed.referenceId.trim() : '';
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;

      if (!isValidV2UserCode(senderUserCode) || !isValidV2UserCode(receiverUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'senderUserCode and receiverUserCode are required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (!isValidV2WalletType(sourceWallet) || !isValidV2WalletType(destinationWallet)) {
        sendJson(res, 400, {
          ok: false,
          error: 'sourceWallet and destinationWallet must be one of fund, income, royalty',
          code: 'INVALID_WALLET_TYPE'
        });
        return;
      }
      if (sourceWallet !== 'fund' && sourceWallet !== 'income') {
        sendJson(res, 400, {
          ok: false,
          error: 'sourceWallet currently supports fund or income only',
          code: 'UNSUPPORTED_SOURCE_WALLET'
        });
        return;
      }
      if (destinationWallet !== 'fund') {
        sendJson(res, 400, {
          ok: false,
          error: 'destinationWallet for this endpoint currently supports fund only',
          code: 'UNSUPPORTED_DESTINATION_WALLET'
        });
        return;
      }
      const isAllowedIncomeToFundSelfTransfer = senderUserCode === receiverUserCode
        && sourceWallet === 'income'
        && destinationWallet === 'fund';
      if (senderUserCode === receiverUserCode && !isAllowedIncomeToFundSelfTransfer) {
        sendJson(res, 400, {
          ok: false,
          error: 'Self transfer is allowed only for sourceWallet=income and destinationWallet=fund',
          code: 'SELF_TRANSFER_NOT_ALLOWED'
        });
        return;
      }
      if (senderUserCode !== actorUserCode) {
        sendJson(res, 403, {
          ok: false,
          error: 'Actor is only allowed to transfer from their own senderUserCode',
          code: 'ACTOR_SENDER_MISMATCH'
        });
        return;
      }
      if (!isAllowedIncomeToFundSelfTransfer) {
        const isInChain = await areUsersInSameLegacyChain(senderUserCode, receiverUserCode);
        if (!isInChain) {
          sendJson(res, 403, {
            ok: false,
            error: 'Transfer allowed only to upline or downline chain members',
            code: 'CHAIN_TRANSFER_ONLY'
          });
          return;
        }
      }
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        sendJson(res, 400, { ok: false, error: 'amountCents must be a positive integer', code: 'INVALID_AMOUNT' });
        return;
      }
      if (normalizedProgress.error) {
        sendJson(res, 400, {
          ok: false,
          error: normalizedProgress.error,
          code: normalizedProgress.code
        });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2FundTransfer({
          idempotencyKey,
          actorUserCode,
          senderUserCode,
          receiverUserCode,
          amountCents,
          sourceWallet,
          destinationWallet,
          allowInactiveActor,
          transactionPassword,
          otp,
          helpProgressUpdates: normalizedProgress.updates,
          referenceId,
          description
        }),
        V2_FUND_TRANSFER_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process fund transfer');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_FUND_TRANSFER_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/withdrawals') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_WITHDRAWAL_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });
      const allowInactiveActor = authContext.authSubjectIsAdmin && authContext.isImpersonated;
      const actorUserCode = authContext.actorUserCode;
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? Math.trunc(amountCentsRaw) : NaN;
      const transactionPassword = String(parsed?.transactionPassword || '');
      const otp = normalizeOtpCode(parsed?.otp);
      const destinationType = String(parsed?.destinationType || '').trim().toLowerCase();
      const destinationRef = String(parsed?.destinationRef || '').trim();
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
      const referenceId = typeof parsed?.referenceId === 'string' ? parsed.referenceId.trim().slice(0, 80) : '';
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;

      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        sendJson(res, 400, { ok: false, error: 'amountCents must be a positive integer', code: 'INVALID_AMOUNT' });
        return;
      }
      if (!isValidV2WithdrawalDestinationType(destinationType)) {
        sendJson(res, 400, { ok: false, error: 'destinationType must be one of bank|upi|wallet', code: 'INVALID_DESTINATION_TYPE' });
        return;
      }
      if (!destinationRef || destinationRef.length > 120) {
        sendJson(res, 400, { ok: false, error: 'destinationRef is required and must be 1-120 chars', code: 'INVALID_DESTINATION_REF' });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2WithdrawalDebit({
          idempotencyKey,
          actorUserCode,
          allowInactiveActor,
          amountCents,
          transactionPassword,
          otp,
          destinationType,
          destinationRef,
          referenceId,
          description
        }),
        V2_WITHDRAWAL_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process withdrawal');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_WITHDRAWAL_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/pins/purchase') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_PIN_PURCHASE_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });
      const allowInactiveActor = authContext.authSubjectIsAdmin && authContext.isImpersonated;
      const actorUserCode = authContext.actorUserCode;
      const buyerUserCode = normalizeV2UserCode(parsed?.buyerUserCode || actorUserCode);
      const quantityRaw = Number(parsed?.quantity);
      const quantity = Number.isFinite(quantityRaw) ? quantityRaw : NaN;
      const pinPriceRaw = parsed?.pinPriceCents;
      const pinPriceNumber = pinPriceRaw == null ? null : Number(pinPriceRaw);
      const pinPriceCents = Number.isFinite(pinPriceNumber) ? pinPriceNumber : null;
      const expiresAtRaw = parsed?.expiresAt;
      const expiresAt = expiresAtRaw == null || String(expiresAtRaw).trim() === '' ? null : new Date(expiresAtRaw);
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;

      if (!isValidV2UserCode(buyerUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'buyerUserCode is required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > V2_PIN_PURCHASE_MAX_QUANTITY) {
        sendJson(res, 400, {
          ok: false,
          error: `quantity must be an integer between 1 and ${V2_PIN_PURCHASE_MAX_QUANTITY}`,
          code: 'INVALID_QUANTITY'
        });
        return;
      }
      if (pinPriceCents != null && (!Number.isFinite(pinPriceCents) || !Number.isInteger(pinPriceCents) || pinPriceCents <= 0)) {
        sendJson(res, 400, {
          ok: false,
          error: 'pinPriceCents must be a positive integer when provided',
          code: 'INVALID_PIN_PRICE'
        });
        return;
      }
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        sendJson(res, 400, {
          ok: false,
          error: 'expiresAt must be a valid ISO datetime string',
          code: 'INVALID_EXPIRES_AT'
        });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2PinPurchase({
          idempotencyKey,
          actorUserCode,
          buyerUserCode,
          allowInactiveActor,
          quantity,
          pinPriceCents,
          expiresAt,
          description
        }),
        V2_PIN_PURCHASE_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process pin purchase');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_PIN_PURCHASE_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/referrals/credit') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_REFERRAL_CREDIT_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: true
      });
      const allowInactiveActor = authContext.authSubjectIsAdmin && authContext.isImpersonated;
      const actorUserCode = authContext.actorUserCode;
      const sourceUserCode = normalizeV2UserCode(parsed?.sourceUserCode);
      const beneficiaryUserCode = normalizeV2UserCode(parsed?.beneficiaryUserCode);
      const eventType = String(parsed?.eventType || '').trim().toLowerCase();
      const sourceTxnIdRaw = Number(parsed?.sourceTxnId);
      const sourceTxnId = Number.isFinite(sourceTxnIdRaw) ? sourceTxnIdRaw : NaN;
      const sourceRef = typeof parsed?.sourceRef === 'string' ? parsed.sourceRef.trim() : '';
      const hasSourceTxnId = Number.isSafeInteger(sourceTxnId) && sourceTxnId > 0;
      const hasSourceRef = !!sourceRef;
      const levelNoRaw = parsed?.levelNo == null ? 1 : Number(parsed?.levelNo);
      const levelNo = Number.isFinite(levelNoRaw) ? levelNoRaw : NaN;
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? amountCentsRaw : NaN;
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;

      if (!isValidV2UserCode(sourceUserCode) || !isValidV2UserCode(beneficiaryUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'sourceUserCode and beneficiaryUserCode are required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (!isValidV2ReferralEventType(eventType)) {
        sendJson(res, 400, {
          ok: false,
          error: 'eventType must be one of direct_referral|level_referral',
          code: 'INVALID_EVENT_TYPE'
        });
        return;
      }
      if (hasSourceTxnId && hasSourceRef) {
        sendJson(res, 400, {
          ok: false,
          error: 'Provide either sourceTxnId or sourceRef, not both',
          code: 'INVALID_REFERRAL_SOURCE'
        });
        return;
      }
      if (!hasSourceTxnId && !hasSourceRef) {
        sendJson(res, 400, {
          ok: false,
          error: 'sourceTxnId or sourceRef is required',
          code: 'MISSING_REFERRAL_SOURCE'
        });
        return;
      }
      if (!hasSourceTxnId && hasSourceRef && !isValidV2ReferralSourceRef(sourceRef)) {
        sendJson(res, 400, {
          ok: false,
          error: `sourceRef must be 1-${V2_REFERRAL_SOURCE_REF_MAX_LENGTH} chars [a-zA-Z0-9:_-]`,
          code: 'INVALID_SOURCE_REF'
        });
        return;
      }
      if (!Number.isInteger(levelNo) || levelNo < 1 || levelNo > V2_REFERRAL_MAX_LEVEL) {
        sendJson(res, 400, {
          ok: false,
          error: `levelNo must be an integer between 1 and ${V2_REFERRAL_MAX_LEVEL}`,
          code: 'INVALID_LEVEL_NO'
        });
        return;
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        sendJson(res, 400, {
          ok: false,
          error: 'amountCents must be a positive integer',
          code: 'INVALID_AMOUNT'
        });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2ReferralCredit({
          idempotencyKey,
          actorUserCode,
          sourceUserCode,
          beneficiaryUserCode,
          allowInactiveActor,
          sourceTxnId: hasSourceTxnId ? sourceTxnId : null,
          sourceRef: hasSourceRef ? sourceRef : null,
          eventType,
          levelNo,
          amountCents,
          description
        }),
        V2_REFERRAL_CREDIT_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process referral credit');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_REFERRAL_CREDIT_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/help-events') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_HELP_EVENT_ENDPOINT_NAME,
        requiredRole: 'user',
        allowImpersonation: false
      });
      const allowInactiveActor = false;
      const actorUserCode = authContext.actorUserCode;
      const sourceUserCode = normalizeV2UserCode(parsed?.sourceUserCode);
      const newMemberUserCode = normalizeV2UserCode(parsed?.newMemberUserCode);
      const eventType = String(parsed?.eventType || '').trim().toLowerCase();
      const sourceRef = typeof parsed?.sourceRef === 'string' ? parsed.sourceRef.trim() : '';
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');

      if (!isValidV2UserCode(sourceUserCode) || !isValidV2UserCode(newMemberUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'sourceUserCode and newMemberUserCode are required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (!isValidV2HelpEventType(eventType)) {
        sendJson(res, 400, {
          ok: false,
          error: `eventType must be ${V2_HELP_EVENT_TYPE_ACTIVATION_JOIN}`,
          code: 'INVALID_EVENT_TYPE'
        });
        return;
      }
      if (!isValidV2HelpEventSourceRef(sourceRef)) {
        sendJson(res, 400, {
          ok: false,
          error: `sourceRef must be 1-${V2_HELP_EVENT_SOURCE_REF_MAX_LENGTH} chars [a-zA-Z0-9:_-]`,
          code: 'INVALID_SOURCE_REF'
        });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2HelpEvent({
          idempotencyKey,
          actorUserCode,
          sourceUserCode,
          newMemberUserCode,
          sourceRef,
          eventType,
          allowInactiveActor,
          description
        }),
        V2_HELP_EVENT_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status)
        || (error instanceof SyntaxError ? 400 : getHttpStatusForRequestError(error));
      const message = getErrorMessage(error, 'Failed to process help event');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_HELP_EVENT_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/admin/adjustments') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const authContext = await resolveV2RequestAuthContext({
        req,
        endpointName: V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME,
        requiredRole: 'admin',
        allowImpersonation: false
      });
      const actorUserCode = authContext.actorUserCode;
      const targetUserCode = normalizeV2UserCode(parsed?.targetUserCode);
      const approverUserCode = normalizeV2UserCode(parsed?.approverUserCode);
      const walletType = String(parsed?.walletType || '').trim().toLowerCase();
      const direction = String(parsed?.direction || '').trim().toLowerCase();
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? amountCentsRaw : NaN;
      const reasonCode = String(parsed?.reasonCode || '').trim().toUpperCase();
      const ticketId = String(parsed?.ticketId || '').trim();
      const note = String(parsed?.note || '').trim();
      const idempotencyKey = getSingleHeaderValue(req, 'idempotency-key');
      const description = typeof parsed?.description === 'string' ? parsed.description.trim().slice(0, 255) : null;

      if (!isValidV2UserCode(targetUserCode) || !isValidV2UserCode(approverUserCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'targetUserCode and approverUserCode are required and must be 3-20 chars [a-zA-Z0-9_-]',
          code: 'INVALID_USER_CODE'
        });
        return;
      }
      if (!isValidV2WalletType(walletType)) {
        sendJson(res, 400, {
          ok: false,
          error: 'walletType must be one of fund|income|royalty',
          code: 'INVALID_WALLET_TYPE'
        });
        return;
      }
      if (!isValidV2AdminAdjustmentDirection(direction)) {
        sendJson(res, 400, {
          ok: false,
          error: 'direction must be one of credit|debit',
          code: 'INVALID_DIRECTION'
        });
        return;
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        sendJson(res, 400, {
          ok: false,
          error: 'amountCents must be a positive integer',
          code: 'INVALID_AMOUNT'
        });
        return;
      }
      if (!isValidV2AdminAdjustmentReasonCode(reasonCode)) {
        sendJson(res, 400, {
          ok: false,
          error: 'reasonCode must be 3-40 chars and use A-Z, 0-9, _',
          code: 'INVALID_REASON_CODE'
        });
        return;
      }
      if (!ticketId || ticketId.length > V2_ADMIN_ADJUSTMENT_MAX_TICKET_ID_LENGTH) {
        sendJson(res, 400, {
          ok: false,
          error: `ticketId is required and must be 1-${V2_ADMIN_ADJUSTMENT_MAX_TICKET_ID_LENGTH} chars`,
          code: 'INVALID_TICKET_ID'
        });
        return;
      }
      if (!note || note.length > V2_ADMIN_ADJUSTMENT_MAX_NOTE_LENGTH) {
        sendJson(res, 400, {
          ok: false,
          error: `note is required and must be 1-${V2_ADMIN_ADJUSTMENT_MAX_NOTE_LENGTH} chars`,
          code: 'INVALID_NOTE'
        });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await executeV2TransactionWithRetry(
        () => processV2AdminAdjustment({
          idempotencyKey,
          actorUserCode,
          targetUserCode,
          approverUserCode,
          walletType,
          direction,
          amountCents,
          reasonCode,
          ticketId,
          note,
          description
        }),
        V2_ADMIN_ADJUSTMENT_ENDPOINT_NAME
      );

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process admin adjustment');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || (typeof error === 'object' && error.code) || 'V2_ADMIN_ADJUSTMENT_FAILED'
      });
    }
    return;
  }

  // POST state
  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const forceWrite = url.searchParams.get('force') === '1';
      const isChunked = url.searchParams.get('chunk') === '1';
      let stateActorContext = null;

      if (FINANCE_ENGINE_MODE === 'v2') {
        stateActorContext = await resolveV2RequestAuthContext({
          req,
          endpointName: V2_STATE_SYNC_ENDPOINT_NAME,
          requiredRole: 'user',
          allowImpersonation: false
        });
      }

      const incomingStateRaw = sanitizeIncomingState(parsed?.state);
      const incomingState = { ...incomingStateRaw };
      if (FINANCE_ENGINE_MODE === 'v2') {
        const allowlist = getV2StateWriteAllowlistForActor(!!stateActorContext?.authSubjectIsAdmin);
        const disallowedKeys = getIncomingDisallowedStateKeys(incomingState, allowlist);
        if (disallowedKeys.length > 0) {
          sendJson(res, 403, {
            ok: false,
            error: 'State write rejected by role allowlist while FINANCE_ENGINE_MODE=v2',
            code: 'STATE_KEY_ROLE_FORBIDDEN',
            actorRole: stateActorContext?.authSubjectIsAdmin ? 'admin' : 'user',
            disallowedKeys
          });
          return;
        }

        if (forceWrite && !stateActorContext?.authSubjectIsAdmin) {
          sendJson(res, 403, {
            ok: false,
            error: 'force=1 state writes require admin role while FINANCE_ENGINE_MODE=v2',
            code: 'STATE_FORCE_ADMIN_REQUIRED'
          });
          return;
        }
      }

      let blockedFinancialKeys = getIncomingFinancialStateKeys(incomingState);
      if (FINANCE_ENGINE_MODE === 'v2' && stateActorContext?.authSubjectIsAdmin) {
        blockedFinancialKeys = blockedFinancialKeys.filter((key) => !V2_ADMIN_PIN_STATE_WRITE_KEYS.has(key));
      }
      if (FINANCE_ENGINE_MODE === 'v2' && !LEGACY_FINANCIAL_WRITES_ENABLED && blockedFinancialKeys.length > 0) {
        sendJson(res, 403, {
          ok: false,
          error: 'Legacy financial writes are blocked while FINANCE_ENGINE_MODE=v2',
          code: 'LEGACY_FINANCIAL_WRITE_BLOCKED',
          blockedKeys: blockedFinancialKeys
        });
        return;
      }

      const incomingBaseUpdatedAt = typeof parsed?.baseUpdatedAt === 'string' ? parsed.baseUpdatedAt : null;
      const incomingUsersCount = getStateArrayLength(incomingState, 'mlm_users');

      const currentSnapshot = await getStateSnapshotCached();
      const currentUpdatedAt = typeof currentSnapshot?.updatedAt === 'string' ? currentSnapshot.updatedAt : null;
      // Always enforce baseUpdatedAt matching to prevent stale clients from overwriting newer state.
      // The force query flag is reserved for intentional destructive snapshots only.
      if (currentUpdatedAt && incomingBaseUpdatedAt !== currentUpdatedAt) {
        sendJson(res, 409, {
          ok: false,
          error: 'State is stale. Refresh from server and retry.',
          code: 'STATE_STALE',
          expectedUpdatedAt: currentUpdatedAt,
          receivedBaseUpdatedAt: incomingBaseUpdatedAt
        });
        return;
      }

      if (!forceWrite && !isChunked && Object.prototype.hasOwnProperty.call(incomingState, 'mlm_users') && incomingUsersCount === 0) {
        // Check if server already has users — protect against accidental wipe
        const usersRaw = await readStateKeyValue('mlm_users');
        if (usersRaw) {
          const existing = safeParseJSON(usersRaw);
          if (Array.isArray(existing) && existing.length > 0) {
            sendJson(res, 409, {
              ok: false,
              error: 'Rejected empty users snapshot to protect existing server data. Retry with ?force=1 only if this is intentional.'
            });
            return;
          }
        }
      }

      let normalizedIncomingState = incomingState;
      if (FINANCE_ENGINE_MODE === 'v2') {
        normalizedIncomingState = normalizeQualificationDerivedStateForWrite(
          incomingState,
          currentSnapshot?.state || {}
        );
      }

      const replaceMissing = isChunked ? false : hasFullStateSnapshot(normalizedIncomingState);
      const saved = await writeStateToDB(normalizedIncomingState, replaceMissing);
      sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to persist state');
      const status = Number(error?.status) || getHttpStatusForRequestError(error);
      console.error(`[POST /api/state] ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/payment-methods') {
    try {
      const methods = await readPaymentMethodsState();
      sendJson(res, 200, { ok: true, methods });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to load payment methods');
      const status = getHttpStatusForRequestError(error);
      console.error(`[GET /api/payment-methods] ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/payment-methods') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const methods = Array.isArray(parsed?.methods) ? parsed.methods : [];
      const saved = await writePaymentMethodsState(methods);
      sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to save payment methods');
      const status = getHttpStatusForRequestError(error);
      console.error(`[POST /api/payment-methods] ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload-file') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const scope = sanitizeUploadScope(parsed?.scope);
      const dataUrl = typeof parsed?.dataUrl === 'string' ? parsed.dataUrl : '';
      const fileName = typeof parsed?.fileName === 'string' ? parsed.fileName : 'upload';
      const saved = await saveUploadedDataUrl({ scope, fileName, dataUrl });
      sendJson(res, 200, {
        ok: true,
        filePath: saved.relativePath,
        fileUrl: `${getPublicRequestBaseUrl(req)}${saved.relativePath}`,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to upload file');
      const status = getHttpStatusForRequestError(error);
      console.error(`[POST /api/upload-file] ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  // Admin audit
  if (req.method === 'GET' && url.pathname === '/api/admin-audit') {
    try {
      const report = await buildAdminAuditReport();
      sendJson(res, 200, { ok: true, report });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to build admin audit report' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/missing-matrix-users') {
    try {
      const limitParam = Number(url.searchParams.get('limit') || 200);
      const report = await buildMissingMatrixUsersAudit(limitParam);
      sendJson(res, 200, { ok: true, report });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to build missing matrix users report' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/audit/income-transfer-sender-mismatches') {
    try {
      const report = await buildIncomeTransferSenderMismatchAudit();
      sendJson(res, 200, { ok: true, report });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to build sender mismatch report' });
    }
    return;
  }

  // List backups
  if (req.method === 'GET' && url.pathname === '/api/backups') {
    try {
      const limit = Number(url.searchParams.get('limit') || 20);
      const backups = await listStateBackups(limit);
      sendJson(res, 200, { ok: true, backups });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: getErrorMessage(error, 'Failed to list backups') });
    }
    return;
  }

  // Backup status
  if (req.method === 'GET' && url.pathname === '/api/backups/status') {
    sendJson(res, 200, { ok: true, running: !!activeStateBackupPromise });
    return;
  }

  // Create backup
  if (req.method === 'POST' && url.pathname === '/api/backups/create') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};

      if (activeStateBackupPromise) {
        sendJson(res, 202, { ok: true, started: false, running: true });
        return;
      }

      const backupOptions = {
        prefix: typeof parsed?.prefix === 'string' && parsed.prefix.trim() ? parsed.prefix.trim() : 'state-backup',
        source: typeof parsed?.source === 'string' && parsed.source.trim() ? parsed.source.trim() : 'manual',
        reason: typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : null
      };

      activeStateBackupPromise = createStateBackup(backupOptions)
        .then((backup) => {
          activeStateBackupPromise = null;
          return backup;
        })
        .catch((error) => {
          activeStateBackupPromise = null;
          console.error(`[state-backup] ${getErrorMessage(error, 'Backup failed')}`);
          throw error;
        });

      sendJson(res, 202, { ok: true, started: true, running: true });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500;
      sendJson(res, status, { ok: false, error: getErrorMessage(error, 'Failed to create backup') });
    }
    return;
  }

  // Send mail
  if (req.method === 'POST' && url.pathname === '/api/send-mail') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const to = normalizeEmailRecipients(parsed?.to);
      const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : '';
      const text = typeof parsed?.text === 'string' ? parsed.text : '';
      const html = typeof parsed?.html === 'string' ? parsed.html : '';
      const from = typeof parsed?.from === 'string' && parsed.from.trim().length > 0 ? parsed.from.trim() : SMTP_FROM;

      if (!to) { sendJson(res, 400, { ok: false, error: 'Missing required field: to' }); return; }
      if (!subject) { sendJson(res, 400, { ok: false, error: 'Missing required field: subject' }); return; }
      if (!text && !html) { sendJson(res, 400, { ok: false, error: 'Provide at least one of: text or html' }); return; }

      const smtpErrors = getSmtpConfigErrors();
      if (smtpErrors.length > 0) {
        sendJson(res, 500, { ok: false, error: `SMTP is not configured. Missing/invalid env values: ${smtpErrors.join(', ')}` });
        return;
      }

      const info = await getSmtpTransporter().sendMail({
        from, to, subject,
        text: text || undefined,
        html: html || undefined
      });

      sendJson(res, 200, {
        ok: true, messageId: info.messageId,
        accepted: info.accepted, rejected: info.rejected
      });
    } catch (error) {
      const isJsonError = error instanceof SyntaxError;
      const baseError = isJsonError ? 'Invalid JSON request body' : error instanceof Error ? error.message : 'Failed to send email';
      const friendlyError =
        typeof baseError === 'string' && baseError.toLowerCase().includes('greeting never received')
          ? `${baseError}. Check SMTP host/port reachability or force plain SMTP with SMTP_SECURE=false, SMTP_PORT=25, SMTP_IGNORE_TLS=true.`
          : baseError;
      sendJson(res, isJsonError ? 400 : 500, { ok: false, error: friendlyError });
    }
    return;
  }

  // Cleanup for rebuild
  if (req.method === 'POST' && url.pathname === '/api/cleanup-for-rebuild') {
    if (FINANCE_ENGINE_MODE === 'v2') {
      sendJson(res, 403, {
        ok: false,
        error: 'Cleanup for rebuild is disabled when FINANCE_ENGINE_MODE=v2',
        code: 'CLEANUP_DISABLED_IN_V2'
      });
      return;
    }

    try {
      const now = new Date().toISOString();
      const snapshot = await readStateFromDB();

      // Clear transactions
      await upsertStateKeyValue('mlm_transactions', '[]', now);

      // Clear help trackers
      await upsertStateKeyValue('mlm_help_trackers', '[]', now);

      // Clear safety pool
      await upsertStateKeyValue('mlm_safety_pool', JSON.stringify({ totalAmount: 0, transactions: [] }), now);

      // Clear pending matrix contributions
      await upsertStateKeyValue('mlm_matrix_pending_contributions', '[]', now);

      // Reset wallet balances
      let walletsReset = 0;
      const walletsRaw = snapshot.state.mlm_wallets;
      if (typeof walletsRaw === 'string') {
        const wallets = safeParseJSON(walletsRaw);
        if (Array.isArray(wallets)) {
          walletsReset = wallets.length;
          const resetWallets = wallets.map((w) => ({
            ...w,
            incomeWallet: 0, royaltyWallet: 0, matrixWallet: 0, totalReceived: 0, totalGiven: 0,
            giveHelpLocked: 0, lockedIncomeWallet: 0
          }));
          await upsertStateKeyValue('mlm_wallets', JSON.stringify(resetWallets), now);
        }
      }

      // Count what was kept
      const usersArr = safeParseJSON(snapshot.state.mlm_users) || [];
      const matrixArr = safeParseJSON(snapshot.state.mlm_matrix) || [];
      const pinsArr = safeParseJSON(snapshot.state.mlm_pins) || [];

      invalidateStateSnapshotCache();

      sendJson(res, 200, {
        ok: true,
        message: `Cleanup complete. Kept: ${usersArr.length} users, ${matrixArr.length} matrix nodes, ${pinsArr.length} pins. Cleared: transactions, help trackers, safety pool. Wallet balances reset to $0.`,
        kept: { users: usersArr.length, matrix: matrixArr.length, pins: pinsArr.length },
        cleared: ['transactions', 'help_trackers', 'safety_pool', 'matrix_pending_contributions'],
        walletsReset
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Cleanup failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

// ─── Startup ─────────────────────────────────────────────────────────

async function start() {
  await connectStorage();

  server.listen(PORT, HOST, () => {
    console.log(`Backend listening on http://${HOST}:${PORT}`);
    console.log(`Environment: NODE_ENV=${NODE_ENV} envFile=${ENV_FILE_PATH ? path.basename(ENV_FILE_PATH) : 'process.env'}`);
    if (STORAGE_MODE === 'file') {
      console.log(`Storage: file ${STATE_FILE_PATH}`);
    } else {
      console.log(`MySQL: ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`);
    }
    console.log(
      'Finance flags:',
      `mode=${FINANCE_ENGINE_MODE}`,
      `legacyFinancialWritesEnabled=${LEGACY_FINANCIAL_WRITES_ENABLED}`,
      `requireSystemVersion=${REQUIRE_SYSTEM_VERSION_HEADER}`,
      `requireIdempotency=${REQUIRE_IDEMPOTENCY_FOR_MUTATIONS}`
    );
    console.log(
      'V2 auth flags:',
      `signedTokenEnabled=${!!V2_AUTH_TOKEN_SECRET}`,
      `legacyBearerCompat=${V2_ALLOW_LEGACY_BEARER_USER_CODE}`,
      `auditEnabled=${V2_AUTH_AUDIT_ENABLED}`,
      `issuer=${V2_AUTH_TOKEN_ISSUER}`,
      `ttlSeconds=${V2_AUTH_TOKEN_TTL_SECONDS}`
    );
    const smtpErrors = getSmtpConfigErrors();
    if (smtpErrors.length === 0) {
      console.log(`SMTP ready: host=${SMTP_HOST} port=${SMTP_PORT} secure=${SMTP_SECURE} from=${SMTP_FROM}`);
      void getSmtpTransporter().verify()
        .then(() => console.log('SMTP verify: connection OK'))
        .catch((error) => console.warn(`SMTP verify failed: ${error instanceof Error ? error.message : String(error)}`));
    } else {
      console.log(`SMTP disabled: ${smtpErrors.join(', ')}`);
    }

    // Warm the cache
    void getStateSnapshotCached({ forceFresh: true })
      .then(() => console.log('State snapshot cache warmed'))
      .catch((error) => console.warn(`State snapshot cache warm failed: ${error instanceof Error ? error.message : String(error)}`));

    // Refresh cache every 5 minutes
    setInterval(() => {
      void getStateSnapshotCached({ forceFresh: true }).catch(() => {});
    }, 5 * 60 * 1000);

    if (LEDGER_MISMATCH_ALERT_ENABLED) {
      console.log(
        `Ledger mismatch alert: enabled interval=${LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES}m cooldown=${LEDGER_MISMATCH_ALERT_COOLDOWN_MINUTES}m recipients=${LEDGER_MISMATCH_ALERT_TO || 'console-only'}`
      );

      // First run shortly after startup, then run periodically.
      setTimeout(() => {
        void runLedgerMismatchAlertCheck();
      }, 20 * 1000);

      setInterval(() => {
        void runLedgerMismatchAlertCheck();
      }, LEDGER_MISMATCH_ALERT_INTERVAL_MINUTES * 60 * 1000);
    } else {
      console.log('Ledger mismatch alert: disabled');
    }
  });
}

function shutdown(signal) {
  console.log(`Received ${signal}. Closing backend...`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
