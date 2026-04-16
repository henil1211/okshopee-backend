import { createServer } from 'node:http';
import { gzip as zlibGzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';

const gzipAsync = promisify(zlibGzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load exactly one env file to avoid silent overrides between environments.
const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const ENV_FILE_CANDIDATES = NODE_ENV === 'production'
  ? [path.join(__dirname, '.env')]
  : NODE_ENV === 'test'
    ? [path.join(__dirname, '.env.test'), path.join(__dirname, '.env')]
    : [path.join(__dirname, '.env.local'), path.join(__dirname, '.env')];
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
const AUTH_MAINTENANCE_ENABLED = process.env.AUTH_MAINTENANCE_ENABLED !== 'false';
const AUTH_MAINTENANCE_MESSAGE = process.env.AUTH_MAINTENANCE_MESSAGE || 'System in under Maintainance for 72 hours, Try Again After 72 hours';
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
  'mlm_safety_pool',
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
const V2_IDEMPOTENCY_LOCK_SECONDS = 30;

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
    connectTimeout: 30000
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
  console.log('MySQL connected and state_store table ready');
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
  const code = error.code || '';
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    message.includes('connection') ||
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
    'Access-Control-Allow-Headers': 'Content-Type',
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
    'Access-Control-Allow-Headers': 'Content-Type',
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

function isValidV2WithdrawalDestinationType(value) {
  return value === 'bank' || value === 'upi' || value === 'wallet';
}

function parseBearerToken(req) {
  const authHeader = getSingleHeaderValue(req, 'authorization');
  if (!authHeader) return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return '';
  return String(match[1] || '').trim();
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

async function processV2FundTransfer({
  idempotencyKey,
  actorUserCode,
  senderUserCode,
  receiverUserCode,
  amountCents,
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
       WHERE u.user_code IN (?, ?) AND wa.wallet_type = 'fund'
       ORDER BY wa.id
       FOR UPDATE`,
      [senderUserCode, receiverUserCode]
    );

    const senderWallet = Array.isArray(walletRows)
      ? walletRows.find((row) => row.user_code === senderUserCode)
      : null;
    const receiverWallet = Array.isArray(walletRows)
      ? walletRows.find((row) => row.user_code === receiverUserCode)
      : null;

    if (!senderWallet || !receiverWallet) {
      throw createApiError(404, 'Sender or receiver fund wallet is not provisioned in v2', 'V2_WALLET_NOT_FOUND');
    }
    if (senderWallet.user_status !== 'active' || receiverWallet.user_status !== 'active') {
      throw createApiError(403, 'Sender or receiver account is not active', 'USER_NOT_ACTIVE');
    }
    if (Number(senderWallet.current_amount_cents) < amountCents) {
      throw createApiError(409, 'Insufficient fund wallet balance', 'INSUFFICIENT_FUNDS');
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
        (?, 1, ?, ?, 'fund', 'debit', ?),
        (?, 2, ?, ?, 'fund', 'credit', ?)`,
      [
        ledgerTxnId,
        senderWallet.gl_account_id,
        senderWallet.user_id,
        amountCents,
        ledgerTxnId,
        receiverWallet.gl_account_id,
        receiverWallet.user_id,
        amountCents
      ]
    );

    const [senderUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents - ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'fund' AND current_amount_cents >= ?`,
      [amountCents, senderWallet.user_id, amountCents]
    );
    if (Number(senderUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(409, 'Insufficient fund wallet balance', 'INSUFFICIENT_FUNDS');
    }

    const [receiverUpdateResult] = await connection.execute(
      `UPDATE v2_wallet_accounts
       SET current_amount_cents = current_amount_cents + ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'fund'`,
      [amountCents, receiverWallet.user_id]
    );
    if (Number(receiverUpdateResult?.affectedRows || 0) !== 1) {
      throw createApiError(500, 'Failed to credit receiver wallet', 'RECEIVER_WALLET_UPDATE_FAILED');
    }

    const responsePayload = {
      ok: true,
      txUuid,
      ledgerTransactionId: ledgerTxnId,
      senderUserCode,
      receiverUserCode,
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

async function processV2WithdrawalDebit({
  idempotencyKey,
  actorUserCode,
  amountCents,
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
    if (actorIncomeWallet.user_status !== 'active') {
      throw createApiError(403, 'Actor user is not active', 'ACTOR_NOT_ACTIVE');
    }
    if (Number(actorIncomeWallet.current_amount_cents) < amountCents) {
      throw createApiError(409, 'Insufficient income wallet balance', 'INSUFFICIENT_FUNDS');
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

async function authenticateUser(userId, password) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  const normalizedPassword = typeof password === 'string' ? password : '';
  if (!/^\d{7}$/.test(normalizedUserId)) {
    return { ok: false, status: 400, error: 'User ID must be exactly 7 digits' };
  }

  let usersData = null;

  // Try in-memory cache first
  let user = null;
  if (stateSnapshotCache?.snapshot?.state?.mlm_users) {
    try {
      usersData = JSON.parse(stateSnapshotCache.snapshot.state.mlm_users);
      if (Array.isArray(usersData)) {
        user = usersData.find((u) => u && u.userId === normalizedUserId) || null;
      }
    } catch {
      user = null;
      usersData = null;
    }
  }

  // Fallback: read from MySQL
  if (!user) {
    const usersRaw = await readStateKeyValue('mlm_users');
    if (!usersRaw) return { ok: false, status: 404, error: 'User ID not found' };
    try {
      usersData = JSON.parse(usersRaw);
      if (Array.isArray(usersData)) {
        user = usersData.find((u) => u && u.userId === normalizedUserId) || null;
      }
    } catch {
      return { ok: false, status: 500, error: 'Failed to parse user data' };
    }
    if (!user) return { ok: false, status: 404, error: 'User ID not found' };
  }

  if (AUTH_MAINTENANCE_ENABLED && !user.isAdmin) {
    return { ok: false, status: 503, error: AUTH_MAINTENANCE_MESSAGE };
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
            const index = usersData.findIndex((item) => item && (item.id === updatedUser.id || item.userId === updatedUser.userId));
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
      sendJson(res, 200, { ok: true, user: result.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request body';
      sendJson(res, 400, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/fund-transfers') {
    try {
      const actorUserCode = normalizeV2UserCode(parseBearerToken(req));
      if (!isValidV2UserCode(actorUserCode)) {
        sendJson(res, 401, { ok: false, error: 'Missing or invalid Bearer token', code: 'INVALID_BEARER_TOKEN' });
        return;
      }

      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const senderUserCode = normalizeV2UserCode(parsed?.senderUserCode);
      const receiverUserCode = normalizeV2UserCode(parsed?.receiverUserCode);
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? Math.trunc(amountCentsRaw) : NaN;
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
      if (senderUserCode === receiverUserCode) {
        sendJson(res, 400, { ok: false, error: 'senderUserCode and receiverUserCode must be different', code: 'SELF_TRANSFER_NOT_ALLOWED' });
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
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        sendJson(res, 400, { ok: false, error: 'amountCents must be a positive integer', code: 'INVALID_AMOUNT' });
        return;
      }
      if (!idempotencyKey) {
        sendJson(res, 400, { ok: false, error: 'Missing required Idempotency-Key header', code: 'MISSING_IDEMPOTENCY_KEY' });
        return;
      }

      const result = await processV2FundTransfer({
        idempotencyKey,
        actorUserCode,
        senderUserCode,
        receiverUserCode,
        amountCents,
        referenceId,
        description
      });

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process fund transfer');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || 'V2_FUND_TRANSFER_FAILED'
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v2/withdrawals') {
    try {
      const actorUserCode = normalizeV2UserCode(parseBearerToken(req));
      if (!isValidV2UserCode(actorUserCode)) {
        sendJson(res, 401, { ok: false, error: 'Missing or invalid Bearer token', code: 'INVALID_BEARER_TOKEN' });
        return;
      }

      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const amountCentsRaw = Number(parsed?.amountCents);
      const amountCents = Number.isFinite(amountCentsRaw) ? Math.trunc(amountCentsRaw) : NaN;
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

      const result = await processV2WithdrawalDebit({
        idempotencyKey,
        actorUserCode,
        amountCents,
        destinationType,
        destinationRef,
        referenceId,
        description
      });

      sendJson(res, result.status, result.payload);
    } catch (error) {
      const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
      const message = getErrorMessage(error, 'Failed to process withdrawal');
      sendJson(res, status, {
        ok: false,
        error: message,
        code: error?.code || 'V2_WITHDRAWAL_FAILED'
      });
    }
    return;
  }

  // POST state
  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const incomingState = sanitizeIncomingState(parsed?.state);
      const blockedFinancialKeys = getIncomingFinancialStateKeys(incomingState);
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
      const forceWrite = url.searchParams.get('force') === '1';
      const isChunked = url.searchParams.get('chunk') === '1';

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

      const replaceMissing = isChunked ? false : hasFullStateSnapshot(incomingState);
      const saved = await writeStateToDB(incomingState, replaceMissing);
      sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to persist state');
      const status = getHttpStatusForRequestError(error);
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
