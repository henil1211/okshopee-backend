import { createServer } from 'node:http';
import { gzip as zlibGzip } from 'node:zlib';
import { promisify } from 'node:util';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
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
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_LEGACY_SNAPSHOT_COLLECTION =
  process.env.MONGODB_LEGACY_SNAPSHOT_COLLECTION || 'app_state';
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
const STATE_DOC_ID = 'singleton';
const LEGACY_STATE_FILE = path.join(__dirname, 'data', 'app-state.json');
const STATE_BACKUP_DIR = path.join(__dirname, 'data', 'backups');
let smtpTransporter;

function extractDbNameFromMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    const dbName = parsed.pathname.replace(/^\/+/, '');
    return dbName || null;
  } catch {
    return null;
  }
}

function redactMongoUri(uri) {
  if (typeof uri !== 'string' || uri.length === 0) return uri;
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
      return parsed.toString();
    }
    return uri;
  } catch {
    return uri.replace(/\/\/([^@]+)@/, '//***:***@');
  }
}

const DB_FROM_URI = extractDbNameFromMongoUri(MONGODB_URI);
const MONGODB_DB = process.env.MONGODB_DB || DB_FROM_URI || 'okshopee24';
const MONGODB_DB_SOURCE = process.env.MONGODB_DB ? 'env' : DB_FROM_URI ? 'uri' : 'default';

const STATE_COLLECTIONS = {
  mlm_users: { collection: 'users', kind: 'array', idField: 'id' },
  mlm_wallets: { collection: 'wallets', kind: 'array', idField: 'userId' },
  mlm_transactions: { collection: 'transactions', kind: 'array', idField: 'id' },
  mlm_matrix: { collection: 'matrix', kind: 'array', idField: 'userId' },
  mlm_safety_pool: { collection: 'safety_pool', kind: 'object' },
  mlm_grace_periods: { collection: 'grace_periods', kind: 'array', idField: 'userId' },
  mlm_reentries: { collection: 'reentries', kind: 'array', idField: 'id' },
  mlm_notifications: { collection: 'notifications', kind: 'array', idField: 'id' },
  mlm_settings: { collection: 'settings', kind: 'object' },
  mlm_payment_methods: { collection: 'payment_methods', kind: 'array', idField: 'id' },
  mlm_payments: { collection: 'payments', kind: 'array', idField: 'id' },
  mlm_pins: { collection: 'pins', kind: 'array', idField: 'id' },
  mlm_pin_transfers: { collection: 'pin_transfers', kind: 'array', idField: 'id' },
  mlm_pin_purchase_requests: { collection: 'pin_purchase_requests', kind: 'array', idField: 'id' },
  mlm_support_tickets: { collection: 'support_tickets', kind: 'array', idField: 'ticket_id' },
  mlm_otp_records: { collection: 'otp_records', kind: 'array', idField: 'id' },
  mlm_email_logs: { collection: 'email_logs', kind: 'array', idField: 'id' },
  mlm_impersonation: { collection: 'impersonation', kind: 'array', idField: 'id' },
  mlm_help_trackers: { collection: 'help_trackers', kind: 'array', idField: 'userId' },
  mlm_matrix_pending_contributions: { collection: 'matrix_pending_contributions', kind: 'array', idField: 'id' }
};

const DB_KEYS = Object.keys(STATE_COLLECTIONS);
const SAFETY_POOL_STATE_KEY = 'mlm_safety_pool';
const SAFETY_POOL_TRANSACTIONS_COLLECTION = 'safety_pool_transactions';
const STATE_META_COLLECTION = 'state_meta';
const STATE_BACKUP_JOB_COLLECTION = 'state_backup_jobs';
const STATE_BACKUP_JOB_ID = 'singleton';
let stateSnapshotCache = null;
let activeStateBackupPromise = null;

const mongoClient = new MongoClient(MONGODB_URI, {
  maxPoolSize: 5,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 120000,
  connectTimeoutMS: 60000
});
let mongoDb;

function getErrorMessage(error, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

function createBackupFileName(prefix = 'state-backup') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.json`;
}

function createBackupDirName(prefix = 'state-backup') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}`;
}

function isMongoConnectivityError(error) {
  if (!error || typeof error !== 'object') return false;

  const name = typeof error.name === 'string' ? error.name : '';
  const message = getErrorMessage(error, '').toLowerCase();

  if (name.startsWith('Mongo')) {
    return (
      message.includes('server selection') ||
      message.includes('connection') ||
      message.includes('timed out') ||
      message.includes('topology') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('ehostunreach') ||
      message.includes('network timeout')
    );
  }

  return (
    message.includes('mongodb') &&
    (
      message.includes('connection') ||
      message.includes('timed out') ||
      message.includes('server selection')
    )
  );
}

function getHttpStatusForRequestError(error) {
  if (getErrorMessage(error) === 'Payload too large') {
    return 413;
  }
  if (error instanceof SyntaxError) {
    return 400;
  }
  if (isMongoConnectivityError(error)) {
    return 503;
  }
  return 500;
}

async function getMongoHealthDetails() {
  try {
    if (!mongoDb) {
      return { ok: false, error: 'Mongo database handle not initialized' };
    }
    await mongoDb.command({ ping: 1 });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

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
  stateSnapshotCache = {
    snapshot: cloned,
    jsonBody,
    gzipBody
  };
  return cloneStateSnapshot(cloned);
}

function invalidateStateSnapshotCache() {
  stateSnapshotCache = null;
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
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return '';
  }
  const recipients = value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return recipients.join(', ');
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
      tls: {
        rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED
      }
    };

    if (SMTP_USER && SMTP_PASS) {
      transportConfig.auth = {
        user: SMTP_USER,
        pass: SMTP_PASS
      };
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
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

function getStateArrayLength(state, key) {
  const raw = state?.[key];
  if (typeof raw !== 'string') return null;
  const parsed = safeParseJSON(raw);
  return Array.isArray(parsed) ? parsed.length : null;
}

function hashObject(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function resolveItemId(item, idField, index) {
  if (item && typeof item === 'object') {
    if (idField && item[idField] !== undefined && item[idField] !== null && String(item[idField]).length > 0) {
      return String(item[idField]);
    }
    for (const fallbackField of ['id', 'userId', 'email', 'pinCode', 'code']) {
      if (item[fallbackField] !== undefined && item[fallbackField] !== null && String(item[fallbackField]).length > 0) {
        return String(item[fallbackField]);
      }
    }
  }
  return `auto_${index}_${hashObject(item)}`;
}

function normalizeArrayItem(item, idField, resolvedId) {
  const normalized =
    item && typeof item === 'object' && !Array.isArray(item)
      ? { ...item }
      : { value: item };

  delete normalized._id;
  delete normalized.__syncUpdatedAt;
  delete normalized.__syncCreatedAt;

  if (idField && (normalized[idField] === undefined || normalized[idField] === null || String(normalized[idField]).length === 0)) {
    normalized[idField] = resolvedId;
  }

  return normalized;
}

function cleanupReadDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  delete out._id;
  delete out.__syncUpdatedAt;
  delete out.__syncCreatedAt;
  return out;
}

async function connectMongo() {
  await mongoClient.connect();
  mongoDb = mongoClient.db(MONGODB_DB);
}

async function readLegacyStateFile() {
  try {
    const raw = await fs.readFile(LEGACY_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      state: parsed?.state && typeof parsed.state === 'object' ? parsed.state : {},
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    return { state: {}, updatedAt: null };
  }
}

async function readLegacySnapshotCollection() {
  try {
    const collection = mongoDb.collection(MONGODB_LEGACY_SNAPSHOT_COLLECTION);
    const doc = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { state: 1, updatedAt: 1 } });
    if (!doc || !doc.state || typeof doc.state !== 'object') {
      return { state: {}, updatedAt: null };
    }
    return {
      state: sanitizeIncomingState(doc.state),
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null
    };
  } catch {
    return { state: {}, updatedAt: null };
  }
}

async function readArrayState(collectionName, idField) {
  const collection = mongoDb.collection(collectionName);
  const docs = await collection.find({ _id: { $ne: STATE_DOC_ID } }).toArray();
  if (docs.length > 0) {
    let latestUpdatedAt = null;
    const value = docs.map((doc) => {
      const item = cleanupReadDoc(doc);
      if (idField && (item[idField] === undefined || item[idField] === null || String(item[idField]).length === 0)) {
        item[idField] = String(doc._id);
      }
      if (typeof doc.__syncUpdatedAt === 'string' && (!latestUpdatedAt || doc.__syncUpdatedAt > latestUpdatedAt)) {
        latestUpdatedAt = doc.__syncUpdatedAt;
      }
      return item;
    });
    return { found: true, value, updatedAt: latestUpdatedAt };
  }

  const legacyDoc = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { value: 1, updatedAt: 1 } });
  if (legacyDoc && Array.isArray(legacyDoc.value)) {
    return {
      found: true,
      value: legacyDoc.value,
      updatedAt: typeof legacyDoc.updatedAt === 'string' ? legacyDoc.updatedAt : null
    };
  }

  return { found: false, value: [], updatedAt: null };
}

async function readObjectState(collectionName) {
  const collection = mongoDb.collection(collectionName);
  const doc = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { value: 1, updatedAt: 1 } });
  if (!doc || !Object.prototype.hasOwnProperty.call(doc, 'value')) {
    return { found: false, value: null, updatedAt: null };
  }
  return {
    found: true,
    value: doc.value,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null
  };
}

function normalizeRequestedStateKeys(requestedKeys) {
  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
    return [];
  }

  return requestedKeys.filter(
    (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(STATE_COLLECTIONS, key)
  );
}

async function readStateFromCollections(requestedKeys = []) {
  const state = {};
  let latestUpdatedAt = null;
  const stateEntries =
    requestedKeys.length > 0
      ? requestedKeys.map((stateKey) => [stateKey, STATE_COLLECTIONS[stateKey]])
      : Object.entries(STATE_COLLECTIONS);
  const results = await Promise.all(
    stateEntries.map(async ([stateKey, config]) => {
      if (config.kind === 'array') {
        const result = await readArrayState(config.collection, config.idField);
        return { stateKey, found: result.found, value: result.value, updatedAt: result.updatedAt };
      }
      const result = await readObjectState(config.collection);
      return { stateKey, found: result.found, value: result.value, updatedAt: result.updatedAt };
    })
  );

  for (const result of results) {
    if (!result.found) continue;
    state[result.stateKey] = JSON.stringify(result.value);
    if (result.updatedAt && (!latestUpdatedAt || result.updatedAt > latestUpdatedAt)) {
      latestUpdatedAt = result.updatedAt;
    }
  }

  return { state, updatedAt: latestUpdatedAt };
}

async function getStateSnapshotCached(options = {}) {
  const requestedKeys = normalizeRequestedStateKeys(options.keys);
  const isFullSnapshot = requestedKeys.length === 0;

  if (isFullSnapshot && !options.forceFresh && stateSnapshotCache?.snapshot) {
    return cloneStateSnapshot(stateSnapshotCache.snapshot);
  }

  const snapshot = await readStateFromCollections(requestedKeys);
  if (!isFullSnapshot) {
    return cloneStateSnapshot(snapshot);
  }

  return setStateSnapshotCache(snapshot);
}

function filterStateSnapshot(snapshot, requestedKeys) {
  if (!Array.isArray(requestedKeys) || requestedKeys.length === 0) {
    return cloneStateSnapshot(snapshot);
  }

  const allowedKeys = new Set(
    requestedKeys
      .filter((key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(STATE_COLLECTIONS, key))
  );

  if (allowedKeys.size === 0) {
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

async function writeArrayState(collectionName, idField, rawValue, now, destructive = false) {
  const collection = mongoDb.collection(collectionName);
  const parsed = safeParseJSON(rawValue);
  const items = Array.isArray(parsed) ? parsed : [];

  if (items.length === 0) {
    if (destructive) {
      await collection.deleteMany({});
    }
    return;
  }

  const operations = [];
  const ids = [];

  items.forEach((item, index) => {
    const resolvedId = resolveItemId(item, idField, index);
    ids.push(resolvedId);

    const normalized = normalizeArrayItem(item, idField, resolvedId);
    operations.push({
      replaceOne: {
        filter: { _id: resolvedId },
        replacement: {
          _id: resolvedId,
          ...normalized,
          __syncUpdatedAt: now,
          __syncCreatedAt: now
        },
        upsert: true
      }
    });
  });

  if (operations.length > 0) {
    const BATCH_SIZE = 250;
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batch = operations.slice(i, i + BATCH_SIZE);
      await collection.bulkWrite(batch, { ordered: false });
    }
  }

  if (destructive) {
    await collection.deleteMany({ _id: { $nin: ids } });
  }
}

async function writeObjectState(collectionName, rawValue, now) {
  const collection = mongoDb.collection(collectionName);
  const parsed = safeParseJSON(rawValue);

  if (parsed === undefined) {
    await collection.deleteOne({ _id: STATE_DOC_ID });
    return;
  }

  await collection.updateOne(
    { _id: STATE_DOC_ID },
    {
      $set: {
        value: parsed,
        updatedAt: now,
        __syncUpdatedAt: now
      },
      $setOnInsert: {
        createdAt: now,
        __syncCreatedAt: now
      }
    },
    { upsert: true }
  );
}

async function writeSafetyPoolTransactionsMirror(rawValue, now) {
  const parsed = safeParseJSON(rawValue);
  const pool =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { totalAmount: 0, transactions: [] };
  const transactions = Array.isArray(pool.transactions) ? pool.transactions : [];
  const collection = mongoDb.collection(SAFETY_POOL_TRANSACTIONS_COLLECTION);

  if (transactions.length === 0) {
    await collection.deleteMany({});
    return;
  }

  const operations = [];
  const ids = [];
  const seenIds = new Map();

  transactions.forEach((item, index) => {
    let resolvedId = resolveItemId(item, 'id', index);
    const seenCount = (seenIds.get(resolvedId) || 0) + 1;
    seenIds.set(resolvedId, seenCount);
    if (seenCount > 1) {
      resolvedId = `${resolvedId}__dup_${index}`;
    }

    ids.push(resolvedId);
    const normalized = normalizeArrayItem(item, 'id', resolvedId);
    operations.push({
      replaceOne: {
        filter: { _id: resolvedId },
        replacement: {
          _id: resolvedId,
          ...normalized,
          __syncUpdatedAt: now,
          __syncCreatedAt: now
        },
        upsert: true
      }
    });
  });

  if (operations.length > 0) {
    const BATCH_SIZE = 250;
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      const batch = operations.slice(i, i + BATCH_SIZE);
      await collection.bulkWrite(batch, { ordered: false });
    }
  }

  await collection.deleteMany({ _id: { $nin: ids } });
}

async function readStateMetaUpdatedAt() {
  const doc = await mongoDb
    .collection(STATE_META_COLLECTION)
    .findOne({ _id: STATE_DOC_ID }, { projection: { updatedAt: 1 } });
  return doc && typeof doc.updatedAt === 'string' ? doc.updatedAt : null;
}

async function writeStateMetaUpdatedAt(now) {
  await mongoDb.collection(STATE_META_COLLECTION).updateOne(
    { _id: STATE_DOC_ID },
    {
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );
}

async function ensureStateBackupDir() {
  await fs.mkdir(STATE_BACKUP_DIR, { recursive: true });
}

async function writeArrayStateBackupFile(stateKey, config, dirPath, options = {}) {
  const collection = mongoDb.collection(config.collection);
  const fileName = `${stateKey}.json`;
  const stateFilePath = path.join(dirPath, fileName);
  const cursor = collection.find({ _id: { $ne: STATE_DOC_ID } }, { batchSize: 250 });
  const fileHandle = await fs.open(stateFilePath, 'w');
  let found = false;
  let latestUpdatedAt = null;
  let docCount = 0;

  try {
    await fileHandle.writeFile('[\n', 'utf-8');
    let first = true;

    if (typeof options.onProgress === 'function') {
      await options.onProgress({ itemCount: 0 });
    }

    for await (const doc of cursor) {
      found = true;
      docCount += 1;

      const item = cleanupReadDoc(doc);
      if (config.idField && (item[config.idField] === undefined || item[config.idField] === null || String(item[config.idField]).length === 0)) {
        item[config.idField] = String(doc._id);
      }
      if (typeof doc.__syncUpdatedAt === 'string' && (!latestUpdatedAt || doc.__syncUpdatedAt > latestUpdatedAt)) {
        latestUpdatedAt = doc.__syncUpdatedAt;
      }

      const prefix = first ? '  ' : ',\n  ';
      await fileHandle.writeFile(prefix, 'utf-8');
      await fileHandle.writeFile(JSON.stringify(item), 'utf-8');
      first = false;

      if (typeof options.onProgress === 'function' && docCount % 250 === 0) {
        await options.onProgress({ itemCount: docCount });
      }
    }

    if (found) {
      await fileHandle.writeFile('\n]\n', 'utf-8');
      if (typeof options.onProgress === 'function') {
        await options.onProgress({ itemCount: docCount });
      }
      return {
        found: true,
        updatedAt: latestUpdatedAt,
        fileName,
        filePath: stateFilePath,
        itemCount: docCount
      };
    }
  } finally {
    await cursor.close().catch(() => {});
    await fileHandle.close().catch(() => {});
  }

  const legacyDoc = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { value: 1, updatedAt: 1 } });
  if (legacyDoc && Array.isArray(legacyDoc.value)) {
    await fs.writeFile(stateFilePath, JSON.stringify(legacyDoc.value, null, 2), 'utf-8');
    if (typeof options.onProgress === 'function') {
      await options.onProgress({ itemCount: legacyDoc.value.length });
    }
    return {
      found: true,
      updatedAt: typeof legacyDoc.updatedAt === 'string' ? legacyDoc.updatedAt : null,
      fileName,
      filePath: stateFilePath,
      itemCount: legacyDoc.value.length
    };
  }

  await fs.rm(stateFilePath, { force: true }).catch(() => {});
  return { found: false, updatedAt: null, fileName, filePath: stateFilePath, itemCount: 0 };
}

async function writeObjectStateBackupFile(stateKey, config, dirPath) {
  const result = await readObjectState(config.collection);
  const fileName = `${stateKey}.json`;
  const stateFilePath = path.join(dirPath, fileName);

  if (!result.found) {
    return { found: false, updatedAt: null, fileName, filePath: stateFilePath, itemCount: 0 };
  }

  await fs.writeFile(stateFilePath, JSON.stringify(result.value, null, 2), 'utf-8');
  return {
    found: true,
    updatedAt: result.updatedAt,
    fileName,
    filePath: stateFilePath,
    itemCount: result.value && typeof result.value === 'object' ? Object.keys(result.value).length : 1
  };
}

async function createStateBackup(options = {}) {
  await ensureStateBackupDir();
  const now = new Date().toISOString();
  const dirName = createBackupDirName(options.prefix || 'state-backup');
  const dirPath = path.join(STATE_BACKUP_DIR, dirName);
  const manifestPath = path.join(dirPath, 'manifest.json');
  const requestedKeys = normalizeRequestedStateKeys(options.keys);
  const stateEntries =
    requestedKeys.length > 0
      ? requestedKeys.map((stateKey) => [stateKey, STATE_COLLECTIONS[stateKey]])
      : Object.entries(STATE_COLLECTIONS);

  await fs.mkdir(dirPath, { recursive: true });

  let latestUpdatedAt = null;
  const keys = [];
  const files = [];
  const total = stateEntries.length;
  let processed = 0;

  for (const [stateKey, config] of stateEntries) {
    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        phase: 'snapshotting',
        stage: 'collection_started',
        processed,
        total,
        stateKey,
        collection: config.collection,
        itemCount: 0
      });
    }

    const result =
      config.kind === 'array'
        ? await writeArrayStateBackupFile(stateKey, config, dirPath, {
            onProgress:
              typeof options.onProgress === 'function'
                ? async ({ itemCount = 0 } = {}) => {
                    await options.onProgress({
                      phase: 'snapshotting',
                      stage: 'collection_streaming',
                      processed,
                      total,
                      stateKey,
                      collection: config.collection,
                      itemCount
                    });
                  }
                : null
          })
        : await writeObjectStateBackupFile(stateKey, config, dirPath);

    processed += 1;

    if (typeof options.onProgress === 'function') {
      await options.onProgress({
        phase: 'snapshotting',
        stage: 'collection_completed',
        processed,
        total,
        stateKey,
        collection: config.collection,
        itemCount: result.itemCount || 0
      });
    }

    if (!result.found) {
      continue;
    }

    keys.push(stateKey);
    files.push({
      stateKey,
      collection: config.collection,
      fileName: result.fileName,
      updatedAt: result.updatedAt || null,
      itemCount: result.itemCount || 0
    });
    if (result.updatedAt && (!latestUpdatedAt || result.updatedAt > latestUpdatedAt)) {
      latestUpdatedAt = result.updatedAt;
    }
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

  return {
    fileName: dirName,
    filePath: dirPath,
    createdAt: now,
    updatedAt: latestUpdatedAt,
    keys
  };
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

    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch {
      manifest = null;
    }

    items.push({
      fileName,
      filePath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: typeof manifest?.createdAt === 'string' ? manifest.createdAt : null,
      updatedAt: typeof manifest?.updatedAt === 'string' ? manifest.updatedAt : null,
      keys: Array.isArray(manifest?.keys) ? manifest.keys.filter((key) => typeof key === 'string') : []
    });
  }

  return items;
}

function createDefaultStateBackupJob() {
  return {
    status: 'idle',
    phase: 'idle',
    processed: 0,
    total: 0,
    stateKey: null,
    collection: null,
    itemCount: 0,
    backup: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null
  };
}

async function readStateBackupJob() {
  const doc = await mongoDb.collection(STATE_BACKUP_JOB_COLLECTION).findOne({ _id: STATE_BACKUP_JOB_ID });
  if (!doc) {
    return createDefaultStateBackupJob();
  }
  const out = { ...doc };
  delete out._id;
  delete out.createdAt;
  return {
    ...createDefaultStateBackupJob(),
    ...out
  };
}

async function writeStateBackupJob(patch, options = {}) {
  const now = new Date().toISOString();
  const base = options.reset ? createDefaultStateBackupJob() : await readStateBackupJob();
  const next = {
    ...base,
    ...(patch && typeof patch === 'object' ? patch : {})
  };

  next.updatedAt = now;
  if (next.status === 'running') {
    next.startedAt = next.startedAt || now;
    next.finishedAt = null;
    next.error = null;
  } else if (next.status === 'completed' || next.status === 'failed' || next.status === 'idle') {
    next.finishedAt = next.finishedAt || now;
  }

  await mongoDb.collection(STATE_BACKUP_JOB_COLLECTION).updateOne(
    { _id: STATE_BACKUP_JOB_ID },
    {
      $set: next,
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );

  return next;
}

async function triggerStateBackupJob(options = {}) {
  if (activeStateBackupPromise) {
    return activeStateBackupPromise;
  }

  const requestedKeys = normalizeRequestedStateKeys(options.keys);
  const total = requestedKeys.length > 0 ? requestedKeys.length : Object.keys(STATE_COLLECTIONS).length;

  activeStateBackupPromise = (async () => {
    try {
      await writeStateBackupJob({
        status: 'running',
        phase: 'snapshotting',
        processed: 0,
        total,
        stateKey: null,
        collection: null,
        itemCount: 0,
        backup: null,
        error: null
      }, { reset: true });

      const backup = await createStateBackup({
        ...options,
        onProgress:
          typeof options.onProgress === 'function'
            ? async (progress) => {
                await options.onProgress(progress);
                await writeStateBackupJob({
                  status: 'running',
                  phase: typeof progress?.phase === 'string' ? progress.phase : 'snapshotting',
                  processed: Number.isFinite(Number(progress?.processed)) ? Number(progress.processed) : 0,
                  total: Number.isFinite(Number(progress?.total)) ? Number(progress.total) : total,
                  stateKey: typeof progress?.stateKey === 'string' ? progress.stateKey : null,
                  collection: typeof progress?.collection === 'string' ? progress.collection : null,
                  itemCount: Number.isFinite(Number(progress?.itemCount)) ? Number(progress.itemCount) : 0,
                  backup: null,
                  error: null
                });
              }
            : async (progress) => {
                await writeStateBackupJob({
                  status: 'running',
                  phase: typeof progress?.phase === 'string' ? progress.phase : 'snapshotting',
                  processed: Number.isFinite(Number(progress?.processed)) ? Number(progress.processed) : 0,
                  total: Number.isFinite(Number(progress?.total)) ? Number(progress.total) : total,
                  stateKey: typeof progress?.stateKey === 'string' ? progress.stateKey : null,
                  collection: typeof progress?.collection === 'string' ? progress.collection : null,
                  itemCount: Number.isFinite(Number(progress?.itemCount)) ? Number(progress.itemCount) : 0,
                  backup: null,
                  error: null
                });
              }
      });

      await writeStateBackupJob({
        status: 'completed',
        phase: 'completed',
        processed: total,
        total,
        stateKey: null,
        collection: null,
        itemCount: 0,
        backup,
        error: null
      });

      return backup;
    } catch (error) {
      await writeStateBackupJob({
        status: 'failed',
        phase: 'failed',
        stateKey: null,
        collection: null,
        backup: null,
        error: getErrorMessage(error, 'Backup failed')
      }).catch(() => {});
      throw error;
    } finally {
      activeStateBackupPromise = null;
    }
  })();

  return activeStateBackupPromise;
}

function hasFullStateSnapshot(state) {
  return DB_KEYS.every((key) => typeof state?.[key] === 'string');
}

async function writeStateToCollections(nextState, destructive = false, replaceMissing = true) {
  const now = new Date().toISOString();
  const tasks = [];
  const entries = replaceMissing
    ? Object.entries(STATE_COLLECTIONS).map(([stateKey, config]) => [stateKey, config, nextState[stateKey]])
    : Object.entries(nextState)
      .map(([stateKey, rawValue]) => [stateKey, STATE_COLLECTIONS[stateKey], rawValue])
      .filter(([, config]) => !!config);

  for (const [stateKey, config, rawValue] of entries) {
    if (typeof rawValue !== 'string') {
      if (!replaceMissing) continue;
      if (config.kind === 'array') {
        tasks.push(() => mongoDb.collection(config.collection).deleteMany({}));
      } else {
        tasks.push(() => mongoDb.collection(config.collection).deleteOne({ _id: STATE_DOC_ID }));
        if (stateKey === SAFETY_POOL_STATE_KEY) {
          tasks.push(() => mongoDb.collection(SAFETY_POOL_TRANSACTIONS_COLLECTION).deleteMany({}));
        }
      }
      continue;
    }

    if (config.kind === 'array') {
      tasks.push(() => writeArrayState(config.collection, config.idField, rawValue, now, destructive));
    } else {
      tasks.push(() => writeObjectState(config.collection, rawValue, now));
      if (stateKey === SAFETY_POOL_STATE_KEY) {
        tasks.push(() => writeSafetyPoolTransactionsMirror(rawValue, now));
      }
    }
  }

  for (const taskFn of tasks) {
    await taskFn();
  }
  await writeStateMetaUpdatedAt(now);
  const canUpdateCacheFromWrite = replaceMissing || !!stateSnapshotCache?.snapshot;
  if (canUpdateCacheFromWrite) {
    const mergedState = {};
    const previousState = stateSnapshotCache?.snapshot?.state || {};
    for (const key of DB_KEYS) {
      if (Object.prototype.hasOwnProperty.call(nextState, key) && typeof nextState[key] === 'string') {
        mergedState[key] = nextState[key];
      } else if (!replaceMissing && typeof previousState[key] === 'string') {
        mergedState[key] = previousState[key];
      } else if (typeof previousState[key] === 'string') {
        mergedState[key] = previousState[key];
      }
    }
    await setStateSnapshotCache({ state: mergedState, updatedAt: now });
  } else {
    invalidateStateSnapshotCache();
  }
  return { updatedAt: now };
}

async function hasAnyCollectionState() {
  for (const config of Object.values(STATE_COLLECTIONS)) {
    const exists = await mongoDb.collection(config.collection).findOne({}, { projection: { _id: 1 } });
    if (exists) return true;
  }
  return false;
}

async function migrateArraySingletonToItemDocs(collectionName, idField) {
  const collection = mongoDb.collection(collectionName);
  const singleton = await collection.findOne({ _id: STATE_DOC_ID }, { projection: { value: 1, updatedAt: 1 } });
  if (!singleton || !Array.isArray(singleton.value)) {
    return false;
  }

  const existingCount = await collection.countDocuments({ _id: { $ne: STATE_DOC_ID } });
  if (existingCount > 0) {
    return false;
  }

  const now = typeof singleton.updatedAt === 'string' ? singleton.updatedAt : new Date().toISOString();
  const items = singleton.value;
  if (items.length > 0) {
    const operations = items.map((item, index) => {
      const resolvedId = resolveItemId(item, idField, index);
      const normalized = normalizeArrayItem(item, idField, resolvedId);
      return {
        replaceOne: {
          filter: { _id: resolvedId },
          replacement: {
            _id: resolvedId,
            ...normalized,
            __syncUpdatedAt: now,
            __syncCreatedAt: now
          },
          upsert: true
        }
      };
    });
    await collection.bulkWrite(operations, { ordered: false });
  }

  await collection.deleteOne({ _id: STATE_DOC_ID });
  return true;
}

async function migrateLegacyStateIfNeeded() {
  const hasState = await hasAnyCollectionState();
  if (hasState) return;

  const legacyFromCollection = await readLegacySnapshotCollection();
  if (Object.keys(legacyFromCollection.state).length > 0) {
    await writeStateToCollections(legacyFromCollection.state);
    return;
  }

  const legacyFromFile = await readLegacyStateFile();
  if (Object.keys(legacyFromFile.state).length > 0) {
    await writeStateToCollections(sanitizeIncomingState(legacyFromFile.state));
  }
}

async function migrateExistingSingletonArrayCollections() {
  for (const config of Object.values(STATE_COLLECTIONS)) {
    if (config.kind !== 'array') continue;
    await migrateArraySingletonToItemDocs(config.collection, config.idField);
  }
}

async function backfillSafetyPoolTransactionsMirror() {
  const stateKeyConfig = STATE_COLLECTIONS[SAFETY_POOL_STATE_KEY];
  if (!stateKeyConfig || stateKeyConfig.kind !== 'object') return;

  const mirrorCollection = mongoDb.collection(SAFETY_POOL_TRANSACTIONS_COLLECTION);
  const existingCount = await mirrorCollection.countDocuments();
  if (existingCount > 0) return;

  const objectState = await readObjectState(stateKeyConfig.collection);
  if (!objectState.found) return;

  const rawValue = JSON.stringify(objectState.value ?? { totalAmount: 0, transactions: [] });
  const now = objectState.updatedAt || new Date().toISOString();
  await writeSafetyPoolTransactionsMirror(rawValue, now);
}

async function authenticateUser(userId, password) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  const normalizedPassword = typeof password === 'string' ? password : '';
  if (!/^\d{7}$/.test(normalizedUserId)) {
    return { ok: false, status: 400, error: 'User ID must be exactly 7 digits' };
  }

  const userDoc = await mongoDb.collection('users').findOne({ userId: normalizedUserId });
  if (!userDoc) {
    return { ok: false, status: 404, error: 'User ID not found' };
  }

  const user = cleanupReadDoc(userDoc);

  if (user.accountStatus === 'permanent_blocked') {
    return {
      ok: false,
      status: 403,
      error: `Account permanently blocked${user.blockedReason ? `: ${user.blockedReason}` : ''}`
    };
  }

  if (user.accountStatus === 'temp_blocked') {
    const blockedUntil = user.blockedUntil ? new Date(user.blockedUntil) : null;
    if (blockedUntil && blockedUntil > new Date()) {
      return {
        ok: false,
        status: 403,
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

  return {
    ok: true,
    status: 200,
    user
  };
}

async function buildAdminAuditReport() {
  const generatedAt = new Date().toISOString();
  const collectionCounts = {};

  for (const config of Object.values(STATE_COLLECTIONS)) {
    collectionCounts[config.collection] = await mongoDb.collection(config.collection).countDocuments();
  }
  collectionCounts[SAFETY_POOL_TRANSACTIONS_COLLECTION] =
    await mongoDb.collection(SAFETY_POOL_TRANSACTIONS_COLLECTION).countDocuments();

  const snapshot = await readStateFromCollections();
  const presentStateKeys = Object.keys(snapshot.state).sort();
  const missingStateKeys = DB_KEYS.filter((key) => !presentStateKeys.includes(key));

  const users = await mongoDb.collection('users').find({}, { projection: { id: 1, userId: 1, email: 1, password: 1, isAdmin: 1, isActive: 1, accountStatus: 1, deactivationReason: 1 } }).toArray();
  const wallets = await mongoDb.collection('wallets').find({}, { projection: { userId: 1 } }).toArray();
  const matrix = await mongoDb.collection('matrix').find({}, { projection: { userId: 1, parentId: 1, leftChild: 1, rightChild: 1 } }).toArray();
  const safetyPoolTransactions = await mongoDb.collection(SAFETY_POOL_TRANSACTIONS_COLLECTION).countDocuments();

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
    database: MONGODB_DB,
    dbSource: MONGODB_DB_SOURCE,
    storageMode: 'multi_collection_documents',
    collectionCounts,
    stateCoverage: {
      expectedStateKeys: DB_KEYS,
      presentStateKeys,
      missingStateKeys
    },
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
        exists: true,
        userId: adminAccount.userId,
        id: adminAccount.id,
        email: adminAccount.email,
        isAdmin: !!adminAccount.isAdmin,
        isActive: !!adminAccount.isActive,
        accountStatus: adminAccount.accountStatus,
        hasPassword: typeof adminAccount.password === 'string' && adminAccount.password.length > 0
      }
      : {
        exists: false
      }
  };
}

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const mongoHealth = await getMongoHealthDetails();
    sendJson(res, mongoHealth.ok ? 200 : 503, {
      ok: mongoHealth.ok,
      timestamp: new Date().toISOString(),
      storage: 'mongodb',
      mode: 'multi_collection_documents',
      database: MONGODB_DB,
      dbSource: MONGODB_DB_SOURCE,
      mongo: mongoHealth,
      collections: Object.values(STATE_COLLECTIONS).map((c) => c.collection),
      derivedCollections: [SAFETY_POOL_TRANSACTIONS_COLLECTION],
      legacySnapshotCollection: MONGODB_LEGACY_SNAPSHOT_COLLECTION
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    try {
      const requestedKeys = (url.searchParams.get('keys') || '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
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

  if (req.method === 'POST' && url.pathname === '/api/state') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};
      const incomingState = sanitizeIncomingState(parsed?.state);
      const incomingUsersCount = getStateArrayLength(incomingState, 'mlm_users');
      const forceWrite = url.searchParams.get('force') === '1';
      const destructiveWrite = url.searchParams.get('destructive') === '1';
      const isChunked = url.searchParams.get('chunk') === '1';
      const hasBaseUpdatedAt = Object.prototype.hasOwnProperty.call(parsed, 'baseUpdatedAt');
      const baseUpdatedAt =
        parsed?.baseUpdatedAt === null
          ? null
          : (typeof parsed?.baseUpdatedAt === 'string' ? parsed.baseUpdatedAt : undefined);
      let currentUpdatedAt = await readStateMetaUpdatedAt();
      if (currentUpdatedAt === null && hasBaseUpdatedAt) {
        const snapshot = await readStateFromCollections();
        currentUpdatedAt = snapshot.updatedAt || null;
        if (currentUpdatedAt) {
          await writeStateMetaUpdatedAt(currentUpdatedAt);
        }
      }
      const includesUsersSnapshot = Object.prototype.hasOwnProperty.call(incomingState, 'mlm_users');

      if (!forceWrite && !isChunked && includesUsersSnapshot && incomingUsersCount === 0) {
        const existingUsersCount = await mongoDb.collection(STATE_COLLECTIONS.mlm_users.collection).countDocuments({}, { limit: 1 });
        if (existingUsersCount > 0) {
          sendJson(res, 409, {
            ok: false,
            error: 'Rejected empty users snapshot to protect existing server data. Retry with ?force=1 only if this is intentional.'
          });
          return;
        }
      }

      const replaceMissing = isChunked ? false : hasFullStateSnapshot(incomingState);
      const saved = await writeStateToCollections(incomingState, destructiveWrite, replaceMissing);
      sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt, destructive: destructiveWrite });
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to persist state');
      const status = getHttpStatusForRequestError(error);
      console.error(`[POST /api/state] ${message}`);
      sendJson(res, status, { ok: false, error: message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin-audit') {
    try {
      const report = await buildAdminAuditReport();
      sendJson(res, 200, { ok: true, report });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Failed to build admin audit report' });
    }
    return;
  }

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

  if (req.method === 'GET' && url.pathname === '/api/backups/status') {
    try {
      const job = await readStateBackupJob();
      sendJson(res, 200, { ok: true, job, running: !!activeStateBackupPromise || job.status === 'running' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: getErrorMessage(error, 'Failed to read backup status') });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/backups/create') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};

      if (activeStateBackupPromise) {
        const job = await readStateBackupJob();
        sendJson(res, 202, { ok: true, started: false, running: true, job });
        return;
      }

      const backupOptions = {
        prefix: typeof parsed?.prefix === 'string' && parsed.prefix.trim() ? parsed.prefix.trim() : 'state-backup',
        source: typeof parsed?.source === 'string' && parsed.source.trim() ? parsed.source.trim() : 'manual',
        reason: typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : null
      };

      const job = await writeStateBackupJob({
        status: 'running',
        phase: 'queued',
        backup: null,
        error: null
      }, { reset: true });

      void triggerStateBackupJob(backupOptions).catch((error) => {
        console.error(`[state-backup] ${getErrorMessage(error, 'Backup failed')}`);
      });

      sendJson(res, 202, { ok: true, started: true, running: true, job });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500;
      sendJson(res, status, { ok: false, error: getErrorMessage(error, 'Failed to create backup') });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/send-mail') {
    try {
      const body = await getRequestBody(req);
      const parsed = body ? JSON.parse(body) : {};

      const to = normalizeEmailRecipients(parsed?.to);
      const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : '';
      const text = typeof parsed?.text === 'string' ? parsed.text : '';
      const html = typeof parsed?.html === 'string' ? parsed.html : '';
      const from = typeof parsed?.from === 'string' && parsed.from.trim().length > 0 ? parsed.from.trim() : SMTP_FROM;

      if (!to) {
        sendJson(res, 400, { ok: false, error: 'Missing required field: to' });
        return;
      }
      if (!subject) {
        sendJson(res, 400, { ok: false, error: 'Missing required field: subject' });
        return;
      }
      if (!text && !html) {
        sendJson(res, 400, { ok: false, error: 'Provide at least one of: text or html' });
        return;
      }

      const smtpErrors = getSmtpConfigErrors();
      if (smtpErrors.length > 0) {
        sendJson(res, 500, {
          ok: false,
          error: `SMTP is not configured. Missing/invalid env values: ${smtpErrors.join(', ')}`
        });
        return;
      }

      const info = await getSmtpTransporter().sendMail({
        from,
        to,
        subject,
        text: text || undefined,
        html: html || undefined
      });

      sendJson(res, 200, {
        ok: true,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected
      });
    } catch (error) {
      const isJsonError = error instanceof SyntaxError;
      const baseError = isJsonError
        ? 'Invalid JSON request body'
        : error instanceof Error
          ? error.message
          : 'Failed to send email';
      const friendlyError =
        typeof baseError === 'string' && baseError.toLowerCase().includes('greeting never received')
          ? `${baseError}. Check SMTP host/port reachability or force plain SMTP with SMTP_SECURE=false, SMTP_PORT=25, SMTP_IGNORE_TLS=true.`
          : baseError;
      sendJson(res, isJsonError ? 400 : 500, {
        ok: false,
        error: friendlyError
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/cleanup-for-rebuild') {
    try {
      // Clear only the heavy regenerable data - keep users, matrix, pins
      const now = new Date().toISOString();

      // 1. Clear transactions (the biggest memory hog)
      await mongoDb.collection('transactions').deleteMany({});

      // 2. Clear help trackers (regenerated during rebuild)
      await mongoDb.collection('help_trackers').deleteMany({});

      // 3. Clear safety pool and its transactions mirror
      await mongoDb.collection('safety_pool').deleteMany({});
      await mongoDb.collection('safety_pool_transactions').deleteMany({});
      // Write empty safety pool
      await mongoDb.collection('safety_pool').updateOne(
        { _id: STATE_DOC_ID },
        {
          $set: { value: { totalAmount: 0, transactions: [] }, updatedAt: now, __syncUpdatedAt: now },
          $setOnInsert: { createdAt: now, __syncCreatedAt: now }
        },
        { upsert: true }
      );

      // 4. Clear pending matrix contributions
      await mongoDb.collection('matrix_pending_contributions').deleteMany({});

      // 5. Reset all wallet balances to 0 (rebuild will recalculate)
      const wallets = await mongoDb.collection('wallets').find({}).toArray();
      if (wallets.length > 0) {
        const walletOps = wallets.map(w => ({
          updateOne: {
            filter: { _id: w._id },
            update: {
              $set: {
                incomeWallet: 0, matrixWallet: 0, totalReceived: 0, totalGiven: 0,
                giveHelpLocked: 0, lockedIncomeWallet: 0,
                __syncUpdatedAt: now
              }
            }
          }
        }));
        await mongoDb.collection('wallets').bulkWrite(walletOps, { ordered: false });
      }

      // Count what was kept
      const keptUsers = await mongoDb.collection('users').countDocuments();
      const keptMatrix = await mongoDb.collection('matrix').countDocuments();
      const keptPins = await mongoDb.collection('pins').countDocuments();

      sendJson(res, 200, {
        ok: true,
        message: `Cleanup complete. Kept: ${keptUsers} users, ${keptMatrix} matrix nodes, ${keptPins} pins. Cleared: transactions, help trackers, safety pool. Wallet balances reset to $0.`,
        kept: { users: keptUsers, matrix: keptMatrix, pins: keptPins },
        cleared: ['transactions', 'help_trackers', 'safety_pool', 'safety_pool_transactions', 'matrix_pending_contributions'],
        walletsReset: wallets.length
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Cleanup failed' });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

async function deduplicateUsersByUserId() {
  const collection = mongoDb.collection('users');
  const docs = await collection.find({ _id: { $ne: STATE_DOC_ID } }).toArray();

  // Dedup users by userId if more than one doc exists
  if (docs.length > 1) {
    const grouped = new Map();
    for (const doc of docs) {
      const userId = (doc.userId || '').trim();
      if (!userId) continue;
      if (!grouped.has(userId)) grouped.set(userId, []);
      grouped.get(userId).push(doc);
    }

    const idsToDelete = [];
    for (const [userId, group] of grouped) {
      if (group.length <= 1) continue;
      group.sort((a, b) => {
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });
      for (let i = 1; i < group.length; i++) {
        idsToDelete.push(group[i]._id);
      }
      console.log(`[dedup] userId=${userId}: keeping _id=${group[0]._id}, removing ${group.length - 1} duplicate(s)`);
    }

    if (idsToDelete.length > 0) {
      await collection.deleteMany({ _id: { $in: idsToDelete } });
      console.log(`[dedup] Removed ${idsToDelete.length} duplicate user doc(s)`);
      stateSnapshotCache = null;
    }
  }

  // Always clean orphaned PINs/wallets even if no user duplicates were found
  // (handles leftover orphans from previous dedup runs that didn't clean PINs)
  const allUsers = await collection.find({ _id: { $ne: STATE_DOC_ID } }).toArray();
  const validIds = new Set();
  for (const doc of allUsers) {
    if (doc.id) validIds.add(String(doc.id));
    validIds.add(String(doc._id));
  }

  const pinsCol = mongoDb.collection('pins');
  const pinDocs = await pinsCol.find({ _id: { $ne: STATE_DOC_ID } }).toArray();
  const orphanPins = pinDocs.filter((p) => p.ownerId && !validIds.has(String(p.ownerId))).map((p) => p._id);
  if (orphanPins.length > 0) {
    await pinsCol.deleteMany({ _id: { $in: orphanPins } });
    console.log(`[startup] Removed ${orphanPins.length} orphaned pin(s)`);
    stateSnapshotCache = null;
  }

  // Deduplicate PINs per owner — keep only the 10 oldest unused PINs per user,
  // remove extras created by repeated initializeDemoData runs.
  const remainingPins = await pinsCol.find({ _id: { $ne: STATE_DOC_ID } }).toArray();
  const pinsByOwner = new Map();
  for (const pin of remainingPins) {
    const owner = String(pin.ownerId || '');
    if (!owner) continue;
    if (!pinsByOwner.has(owner)) pinsByOwner.set(owner, []);
    pinsByOwner.get(owner).push(pin);
  }
  const excessPinIds = [];
  for (const [owner, pins] of pinsByOwner) {
    // Only dedup auto-generated unused pins (status 'unused') for admin-like owners
    const unused = pins.filter((p) => p.status === 'unused');
    if (unused.length <= 10) continue;
    // Sort by createdAt ascending — keep the 10 oldest
    unused.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    for (let i = 10; i < unused.length; i++) {
      excessPinIds.push(unused[i]._id);
    }
  }
  if (excessPinIds.length > 0) {
    await pinsCol.deleteMany({ _id: { $in: excessPinIds } });
    console.log(`[startup] Removed ${excessPinIds.length} excess duplicate pin(s)`);
    stateSnapshotCache = null;
  }

  const walletsCol = mongoDb.collection('wallets');
  const walletDocs = await walletsCol.find({ _id: { $ne: STATE_DOC_ID } }).toArray();
  const orphanWallets = walletDocs.filter((w) => w.userId && !validIds.has(String(w.userId))).map((w) => w._id);
  if (orphanWallets.length > 0) {
    await walletsCol.deleteMany({ _id: { $in: orphanWallets } });
    console.log(`[startup] Removed ${orphanWallets.length} orphaned wallet(s)`);
    stateSnapshotCache = null;
  }
}

async function start() {
  await connectMongo();
  await migrateLegacyStateIfNeeded();
  await migrateExistingSingletonArrayCollections();
  await backfillSafetyPoolTransactionsMirror();
  await deduplicateUsersByUserId();

  server.listen(PORT, HOST, () => {
    console.log(`Backend listening on http://${HOST}:${PORT}`);
    console.log(`Environment: NODE_ENV=${NODE_ENV} envFile=${ENV_FILE_PATH ? path.basename(ENV_FILE_PATH) : 'process.env'}`);
    console.log(`MongoDB URI: ${redactMongoUri(MONGODB_URI)}`);
    console.log(`MongoDB DB (${MONGODB_DB_SOURCE}): ${MONGODB_DB}`);
    console.log(`MongoDB collections: ${Object.values(STATE_COLLECTIONS).map((c) => c.collection).join(', ')}`);
    console.log(`MongoDB derived collections: ${SAFETY_POOL_TRANSACTIONS_COLLECTION}`);
    console.log(`Legacy snapshot collection: ${MONGODB_LEGACY_SNAPSHOT_COLLECTION}`);
    const smtpErrors = getSmtpConfigErrors();
    if (smtpErrors.length === 0) {
      console.log(
        `SMTP ready: host=${SMTP_HOST} port=${SMTP_PORT} secure=${SMTP_SECURE} ignoreTLS=${SMTP_IGNORE_TLS} requireTLS=${SMTP_REQUIRE_TLS} timeoutMs=${SMTP_TIMEOUT_MS} from=${SMTP_FROM}`
      );
      void getSmtpTransporter().verify()
        .then(() => {
          console.log('SMTP verify: connection OK');
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`SMTP verify failed: ${message}`);
        });
    } else {
      console.log(`SMTP disabled: ${smtpErrors.join(', ')}`);
    }
    if (process.env.MONGODB_DB && DB_FROM_URI && process.env.MONGODB_DB !== DB_FROM_URI) {
      console.warn(`Mongo DB mismatch: URI path is "${DB_FROM_URI}" but MONGODB_DB is "${process.env.MONGODB_DB}".`);
    }

    void getStateSnapshotCached({ forceFresh: true })
      .then(() => {
        console.log('State snapshot cache warmed');
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`State snapshot cache warm failed: ${message}`);
      });
  });
}

function shutdown(signal) {
  console.log(`Received ${signal}. Closing backend...`);
  server.close(async () => {
    await mongoClient.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
