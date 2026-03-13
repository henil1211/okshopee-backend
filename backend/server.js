import { createServer } from 'node:http';
import { gzip as zlibGzip } from 'node:zlib';
import { promisify } from 'node:util';
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
const STATE_BACKUP_DIR = path.join(__dirname, 'data', 'backups');
let smtpTransporter;

// All known state keys (same as before — frontend sends/receives these)
const DB_KEYS = [
  'mlm_users', 'mlm_wallets', 'mlm_transactions', 'mlm_matrix',
  'mlm_safety_pool', 'mlm_grace_periods', 'mlm_reentries',
  'mlm_notifications', 'mlm_settings', 'mlm_payment_methods',
  'mlm_payments', 'mlm_pins', 'mlm_pin_transfers',
  'mlm_pin_purchase_requests', 'mlm_support_tickets', 'mlm_otp_records',
  'mlm_email_logs', 'mlm_impersonation', 'mlm_help_trackers',
  'mlm_matrix_pending_contributions',
  'mlm_marketplace_categories', 'mlm_marketplace_retailers',
  'mlm_marketplace_banners', 'mlm_marketplace_deals',
  'mlm_marketplace_invoices', 'mlm_marketplace_redemptions'
];

const DB_KEYS_SET = new Set(DB_KEYS);

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

async function connectStorage() {
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
  let rows;
  try {
    [rows] = await pool.execute(
      `SELECT state_key, state_value, updated_at FROM state_store WHERE state_key IN (${placeholders})`,
      keysToRead
    );
  } catch (err) {
    console.warn('[readStateFromDB] primary SELECT failed, falling back without updated_at:', getErrorMessage(err), {
      code: err?.code, errno: err?.errno, sqlState: err?.sqlState
    });
    // Fallback: query without updated_at to keep API working even if schema differs.
    [rows] = await pool.execute(
      `SELECT state_key, state_value, NULL as updated_at FROM state_store WHERE state_key IN (${placeholders})`,
      keysToRead
    );
  }

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
      'SELECT state_value FROM state_store WHERE state_key = ?',
      [key]
    );
  } catch (err) {
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      console.warn('updated_at column missing during readStateKeyValue; retrying without updated_at');
      [rows] = await pool.execute(
        'SELECT state_value FROM state_store WHERE state_key = ?',
        [key]
      );
    } else {
      throw err;
    }
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

  // Try in-memory cache first
  let user = null;
  if (stateSnapshotCache?.snapshot?.state?.mlm_users) {
    try {
      const usersData = JSON.parse(stateSnapshotCache.snapshot.state.mlm_users);
      if (Array.isArray(usersData)) {
        user = usersData.find((u) => u && u.userId === normalizedUserId) || null;
      }
    } catch {
      user = null;
    }
  }

  // Fallback: read from MySQL
  if (!user) {
    const usersRaw = await readStateKeyValue('mlm_users');
    if (!usersRaw) return { ok: false, status: 404, error: 'User ID not found' };
    try {
      const usersData = JSON.parse(usersRaw);
      if (Array.isArray(usersData)) {
        user = usersData.find((u) => u && u.userId === normalizedUserId) || null;
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

// ─── HTTP server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
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
      if (requestedKeys.length > 0) {
        const snapshot = await getStateSnapshotCached({ keys: requestedKeys });
        sendJson(res, 200, snapshot, req);
      } else {
        const snapshot = await getStateSnapshotCached();
        sendStateSnapshot(res, snapshot, req);
      }
    } catch (error) {
      const status = getHttpStatusForRequestError(error);
      const message = getErrorMessage(error, 'Failed to read state');
      console.error(`[GET /api/state] ${message}`);
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

  // POST state
  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const incomingState = sanitizeIncomingState(parsed?.state);
      const incomingUsersCount = getStateArrayLength(incomingState, 'mlm_users');
      const forceWrite = url.searchParams.get('force') === '1';
      const isChunked = url.searchParams.get('chunk') === '1';

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
            incomeWallet: 0, matrixWallet: 0, totalReceived: 0, totalGiven: 0,
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
