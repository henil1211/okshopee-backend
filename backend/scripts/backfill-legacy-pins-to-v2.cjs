#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DEFAULT_PIN_PRICE_CENTS = 1100;

function parseArgs(argv) {
  const args = {
    apply: false,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    userCode: '',
    limit: 200000,
    label: 'legacy-pins-to-v2'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) i += 1;

    switch (key) {
      case 'apply':
        args.apply = true;
        i -= 1;
        break;
      case 'host':
        args.host = value;
        break;
      case 'port':
        args.port = Number(value);
        break;
      case 'user':
        args.user = value;
        break;
      case 'password':
        args.password = value;
        break;
      case 'database':
        args.database = value;
        break;
      case 'user-code':
        args.userCode = String(value || '').trim();
        break;
      case 'limit':
        args.limit = Number(value || 200000);
        break;
      case 'label':
        args.label = String(value || '').trim() || 'legacy-pins-to-v2';
        break;
      default:
        break;
    }
  }

  if (args.userCode && !/^\d{7}$/.test(args.userCode)) {
    throw new Error('--user-code must be a 7-digit user ID when provided');
  }

  if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 1000000) {
    throw new Error('--limit must be between 1 and 1000000');
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizeUserCode(value) {
  return String(value || '').trim();
}

function normalizeLegacyPinCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized.length > 16) return '';
  return normalized;
}

function mapLegacyPinStatusToV2Status(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'unused') return 'generated';
  if (normalized === 'used') return 'used';
  if (normalized === 'suspended') return 'cancelled';
  if (normalized === 'transferred') return 'generated';
  return null;
}

function parseIsoOrNull(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function toMySqlDateTime(isoString) {
  if (!isoString) return null;
  return isoString.replace('T', ' ').replace('Z', '');
}

function toPriceCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PIN_PRICE_CENTS;
  const cents = Math.round(value * 100);
  if (!Number.isFinite(cents) || cents <= 0) return DEFAULT_PIN_PRICE_CENTS;
  return Math.trunc(cents);
}

function randomUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = crypto.randomBytes(16);
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const value = hex.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function loadLegacyState(conn) {
  const [rows] = await conn.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_pins')`
  );

  const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key || ''), row.state_value]));
  const users = safeParseJson(map.get('mlm_users') || '[]', []);
  const pins = safeParseJson(map.get('mlm_pins') || '[]', []);

  return {
    users: Array.isArray(users) ? users : [],
    pins: Array.isArray(pins) ? pins : []
  };
}

function buildLegacyUserMaps(legacyUsers) {
  const byInternalId = new Map();
  const byUserCode = new Map();

  for (const user of Array.isArray(legacyUsers) ? legacyUsers : []) {
    const userCode = normalizeUserCode(user?.userId);
    const internalId = String(user?.id || '').trim();
    if (internalId) byInternalId.set(internalId, user);
    if (userCode) byUserCode.set(userCode, user);
  }

  return { byInternalId, byUserCode };
}

async function loadV2UsersByCodes(conn, userCodes) {
  const out = new Map();
  const normalized = Array.from(new Set((Array.isArray(userCodes) ? userCodes : [])
    .map((value) => normalizeUserCode(value))
    .filter((value) => /^\d{7}$/.test(value))));

  if (normalized.length === 0) return out;

  const chunkSize = 500;
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT id, user_code
       FROM v2_users
       WHERE user_code IN (${placeholders})`,
      chunk
    );

    for (const row of Array.isArray(rows) ? rows : []) {
      const code = normalizeUserCode(row?.user_code);
      if (!code) continue;
      out.set(code, {
        id: Number(row?.id || 0),
        userCode: code
      });
    }
  }

  return out;
}

async function loadExistingV2PinCodes(conn, pinCodes) {
  const existing = new Set();
  const uniqueCodes = Array.from(new Set((Array.isArray(pinCodes) ? pinCodes : [])
    .map((value) => normalizeLegacyPinCode(value))
    .filter(Boolean)));

  if (uniqueCodes.length === 0) return existing;

  const chunkSize = 500;
  for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
    const chunk = uniqueCodes.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await conn.execute(
      `SELECT pin_code
       FROM v2_pins
       WHERE pin_code IN (${placeholders})`,
      chunk
    );

    for (const row of Array.isArray(rows) ? rows : []) {
      const pinCode = normalizeLegacyPinCode(row?.pin_code);
      if (pinCode) existing.add(pinCode);
    }
  }

  return existing;
}

function classifyLegacyPins(params) {
  const {
    legacyPins,
    userMaps,
    v2UsersByCode,
    existingV2PinCodes,
    userCodeFilter,
    limit
  } = params;

  const counters = {
    totalLegacyPinsScanned: 0,
    candidatePins: 0,
    alreadyInV2: 0,
    skippedByReason: {
      invalid_pin_code: 0,
      owner_not_found: 0,
      owner_not_in_v2: 0,
      status_unsupported: 0,
      user_filter_miss: 0,
      limit_reached: 0
    }
  };

  const warnings = [];
  const candidates = [];
  const v2UserCodesSeen = new Set();

  for (const legacyPin of Array.isArray(legacyPins) ? legacyPins : []) {
    counters.totalLegacyPinsScanned += 1;

    const pinCode = normalizeLegacyPinCode(legacyPin?.pinCode);
    if (!pinCode) {
      counters.skippedByReason.invalid_pin_code += 1;
      continue;
    }

    if (existingV2PinCodes.has(pinCode)) {
      counters.alreadyInV2 += 1;
      continue;
    }

    const ownerRef = String(legacyPin?.ownerId || '').trim();
    const ownerLegacyUser = userMaps.byInternalId.get(ownerRef) || userMaps.byUserCode.get(ownerRef) || null;
    if (!ownerLegacyUser) {
      counters.skippedByReason.owner_not_found += 1;
      continue;
    }

    const ownerUserCode = normalizeUserCode(ownerLegacyUser?.userId);
    if (userCodeFilter && ownerUserCode !== userCodeFilter) {
      counters.skippedByReason.user_filter_miss += 1;
      continue;
    }

    const ownerV2User = v2UsersByCode.get(ownerUserCode) || null;
    if (!ownerV2User || !Number.isFinite(Number(ownerV2User.id)) || Number(ownerV2User.id) <= 0) {
      counters.skippedByReason.owner_not_in_v2 += 1;
      continue;
    }

    const mappedStatus = mapLegacyPinStatusToV2Status(legacyPin?.status);
    if (!mappedStatus) {
      counters.skippedByReason.status_unsupported += 1;
      continue;
    }

    if (candidates.length >= limit) {
      counters.skippedByReason.limit_reached += 1;
      continue;
    }

    let usedByV2UserId = null;
    const usedByRef = String(legacyPin?.usedById || '').trim();
    if (mappedStatus === 'used' && usedByRef) {
      const usedByLegacyUser = userMaps.byInternalId.get(usedByRef) || userMaps.byUserCode.get(usedByRef) || null;
      const usedByUserCode = normalizeUserCode(usedByLegacyUser?.userId || usedByRef);
      const usedByV2User = v2UsersByCode.get(usedByUserCode) || null;
      usedByV2UserId = usedByV2User ? Number(usedByV2User.id) : null;
      if (!usedByV2UserId) {
        warnings.push({
          pinCode,
          warning: 'used_pin_missing_v2_used_by_user',
          usedByRef
        });
      }
    }

    const createdAtIso = parseIsoOrNull(legacyPin?.createdAt) || new Date().toISOString();
    const usedAtIso = parseIsoOrNull(legacyPin?.usedAt);

    candidates.push({
      pinCode,
      buyerUserId: Number(ownerV2User.id),
      buyerUserCode: ownerUserCode,
      priceCents: toPriceCents(legacyPin?.amount),
      status: mappedStatus,
      usedByUserId: mappedStatus === 'used' ? usedByV2UserId : null,
      createdAtIso,
      usedAtIso: mappedStatus === 'used' ? usedAtIso : null,
      legacy: {
        ownerId: ownerRef,
        status: String(legacyPin?.status || '').trim(),
        transferredFrom: String(legacyPin?.transferredFrom || '').trim() || null
      }
    });
    v2UserCodesSeen.add(ownerUserCode);
  }

  counters.candidatePins = candidates.length;

  return {
    counters,
    warnings,
    candidates,
    ownerUserCodes: Array.from(v2UserCodesSeen)
  };
}

function createSyntheticIdempotencyKey(userCode, index) {
  const seed = `${userCode}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 10)}`;
  const compact = seed.replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 110);
  return `legacy_pin_backfill:${compact}`;
}

async function createSyntheticPurchaseTxn(conn, buyerUserId, buyerUserCode, pins) {
  const totalAmountCents = pins.reduce((sum, pin) => sum + Number(pin.priceCents || 0), 0);
  const idempotencyKey = createSyntheticIdempotencyKey(buyerUserCode, pins.length);
  const requestHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  const responseBody = JSON.stringify({
    ok: true,
    source: 'legacy_pin_backfill',
    buyerUserCode,
    pinCount: pins.length,
    totalAmountCents
  });

  await conn.execute(
    `INSERT INTO v2_idempotency_keys
      (idempotency_key, endpoint_name, actor_user_id, request_hash, status, response_code, response_body, locked_until)
     VALUES
      (?, 'legacy_pin_backfill', ?, ?, 'completed', 200, ?, NULL)`,
    [idempotencyKey, buyerUserId, requestHash, responseBody]
  );

  const [txResult] = await conn.execute(
    `INSERT INTO v2_ledger_transactions
      (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
       reference_type, reference_id, description, total_debit_cents, total_credit_cents)
     VALUES
      (?, 'v2', 'pin_purchase', 'posted', ?, ?,
       'legacy_backfill', ?, ?, ?, ?)`,
    [
      randomUuid(),
      idempotencyKey,
      buyerUserId,
      `${buyerUserCode}:${pins.length}`.slice(0, 80),
      `Legacy pin backfill (${pins.length} pins)`,
      totalAmountCents,
      totalAmountCents
    ]
  );

  return {
    ledgerTxnId: Number(txResult?.insertId || 0),
    idempotencyKey,
    totalAmountCents
  };
}

async function applyBackfill(conn, candidates) {
  const groupedByBuyer = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.buyerUserId}:${candidate.buyerUserCode}`;
    const existing = groupedByBuyer.get(key) || [];
    existing.push(candidate);
    groupedByBuyer.set(key, existing);
  }

  const results = {
    insertedPins: 0,
    skippedDuplicatesDuringApply: 0,
    failedPins: 0,
    syntheticTransactions: [],
    failedItems: []
  };

  await conn.beginTransaction();
  try {
    let groupIndex = 0;
    for (const [groupKey, pins] of groupedByBuyer.entries()) {
      const [buyerUserIdRaw, buyerUserCode] = groupKey.split(':');
      const buyerUserId = Number(buyerUserIdRaw);
      const synthetic = await createSyntheticPurchaseTxn(conn, buyerUserId, buyerUserCode, pins);
      results.syntheticTransactions.push({
        buyerUserCode,
        buyerUserId,
        ledgerTxnId: synthetic.ledgerTxnId,
        pinCount: pins.length,
        totalAmountCents: synthetic.totalAmountCents
      });
      groupIndex += 1;

      for (const pin of pins) {
        try {
          await conn.execute(
            `INSERT INTO v2_pins
              (pin_code, buyer_user_id, price_cents, status, purchased_txn_id, used_by_user_id, used_txn_id, expires_at, created_at, used_at)
             VALUES
              (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
            [
              pin.pinCode,
              pin.buyerUserId,
              pin.priceCents,
              pin.status,
              synthetic.ledgerTxnId,
              pin.usedByUserId,
              toMySqlDateTime(pin.createdAtIso),
              toMySqlDateTime(pin.usedAtIso)
            ]
          );
          results.insertedPins += 1;
        } catch (error) {
          if (error && error.code === 'ER_DUP_ENTRY') {
            results.skippedDuplicatesDuringApply += 1;
            continue;
          }
          results.failedPins += 1;
          results.failedItems.push({
            pinCode: pin.pinCode,
            buyerUserCode,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    if (results.failedPins > 0) {
      throw new Error(`Backfill encountered ${results.failedPins} failed pin inserts`);
    }

    await conn.commit();
    return results;
  } catch (error) {
    await conn.rollback();
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'legacy-pins-to-v2-report.json');
  const summaryPath = path.join(evidenceDir, 'legacy-pins-to-v2-summary.txt');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const legacy = await loadLegacyState(conn);
    const userMaps = buildLegacyUserMaps(legacy.users);

    const neededUserCodes = new Set();
    for (const user of legacy.users) {
      const userCode = normalizeUserCode(user?.userId);
      if (userCode) neededUserCodes.add(userCode);
    }

    const v2UsersByCode = await loadV2UsersByCodes(conn, Array.from(neededUserCodes));
    const existingV2PinCodes = await loadExistingV2PinCodes(
      conn,
      legacy.pins.map((pin) => pin?.pinCode)
    );

    const classified = classifyLegacyPins({
      legacyPins: legacy.pins,
      userMaps,
      v2UsersByCode,
      existingV2PinCodes,
      userCodeFilter: args.userCode,
      limit: args.limit
    });

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      filters: {
        userCode: args.userCode || null,
        limit: args.limit
      },
      totals: classified.counters,
      warnings: classified.warnings,
      candidatesSample: classified.candidates.slice(0, 50),
      candidateCount: classified.candidates.length,
      ownerUserCodesWithCandidates: classified.ownerUserCodes
    };

    if (args.apply && classified.candidates.length > 0) {
      report.apply = await applyBackfill(conn, classified.candidates);

      const postExisting = await loadExistingV2PinCodes(
        conn,
        classified.candidates.map((item) => item.pinCode)
      );
      report.postApply = {
        candidatePinsNowPresentInV2: classified.candidates.filter((item) => postExisting.has(item.pinCode)).length,
        remainingMissing: classified.candidates.filter((item) => !postExisting.has(item.pinCode)).map((item) => item.pinCode)
      };
    }

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const insertedPins = Number(report?.apply?.insertedPins || 0);
    const duplicatesDuringApply = Number(report?.apply?.skippedDuplicatesDuringApply || 0);
    const failedPins = Number(report?.apply?.failedPins || 0);
    const remainingMissingCount = Array.isArray(report?.postApply?.remainingMissing)
      ? report.postApply.remainingMissing.length
      : classified.candidates.length;

    const summaryLines = [
      `GeneratedAt: ${report.generatedAt}`,
      `Mode: ${report.mode}`,
      `LegacyPinsScanned: ${classified.counters.totalLegacyPinsScanned}`,
      `AlreadyInV2: ${classified.counters.alreadyInV2}`,
      `CandidatePins: ${classified.counters.candidatePins}`,
      `SkippedInvalidPinCode: ${classified.counters.skippedByReason.invalid_pin_code}`,
      `SkippedOwnerNotFound: ${classified.counters.skippedByReason.owner_not_found}`,
      `SkippedOwnerNotInV2: ${classified.counters.skippedByReason.owner_not_in_v2}`,
      `SkippedStatusUnsupported: ${classified.counters.skippedByReason.status_unsupported}`,
      `SkippedUserFilterMiss: ${classified.counters.skippedByReason.user_filter_miss}`,
      `InsertedPins: ${insertedPins}`,
      `ApplyDuplicateSkips: ${duplicatesDuringApply}`,
      `ApplyFailedPins: ${failedPins}`,
      `RemainingMissingAfterApply: ${remainingMissingCount}`,
      `Report: ${reportPath}`
    ];

    fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');

    console.log('--- Legacy Pins -> V2 Backfill ---');
    summaryLines.forEach((line) => console.log(line));

    if (!args.apply && classified.candidates.length > 0) {
      process.exit(2);
    }

    if (args.apply && (failedPins > 0 || remainingMissingCount > 0)) {
      process.exit(3);
    }

    process.exit(0);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
