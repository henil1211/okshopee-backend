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

function normalizePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function parseQuantityFromText(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const match = text.match(/(\d+)\s*pin/i);
  if (!match) return 0;
  return normalizePositiveInt(match[1]);
}

function resolveLegacyUserFromRef(userMaps, ref) {
  const normalized = String(ref || '').trim();
  if (!normalized) return null;
  return userMaps.byInternalId.get(normalized) || userMaps.byUserCode.get(normalized) || null;
}

function toIsoOrNow(value) {
  return parseIsoOrNull(value) || new Date().toISOString();
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
     WHERE state_key IN ('mlm_users', 'mlm_pins', 'mlm_pin_purchase_requests', 'mlm_transactions')`
  );

  const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key || ''), row.state_value]));
  const users = safeParseJson(map.get('mlm_users') || '[]', []);
  const pins = safeParseJson(map.get('mlm_pins') || '[]', []);
  const pinPurchaseRequests = safeParseJson(map.get('mlm_pin_purchase_requests') || '[]', []);
  const transactions = safeParseJson(map.get('mlm_transactions') || '[]', []);

  return {
    users: Array.isArray(users) ? users : [],
    pins: Array.isArray(pins) ? pins : [],
    pinPurchaseRequests: Array.isArray(pinPurchaseRequests) ? pinPurchaseRequests : [],
    transactions: Array.isArray(transactions) ? transactions : []
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

function createSyntheticIdempotencyKey(userCode, tag) {
  const seed = `${userCode}_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const compact = seed.replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 110);
  return `legacy_pin_backfill:${compact}`;
}

function buildPurchaseHistorySignals({ legacyPinPurchaseRequests, legacyTransactions, userMaps, userCodeFilter }) {
  const eventsByUserCode = new Map();
  const metrics = {
    requestEvents: 0,
    transactionEvents: 0,
    skippedRequestEvents: 0,
    skippedTransactionEvents: 0,
    skippedDuplicateRecoveredTransactions: 0
  };

  const pushEvent = (userCode, event) => {
    const normalizedUserCode = normalizeUserCode(userCode);
    if (!normalizedUserCode) return;
    if (userCodeFilter && normalizedUserCode !== userCodeFilter) return;
    const existing = eventsByUserCode.get(normalizedUserCode) || [];
    existing.push(event);
    eventsByUserCode.set(normalizedUserCode, existing);
  };

  const recoveredRequestIds = new Set();

  for (const request of Array.isArray(legacyPinPurchaseRequests) ? legacyPinPurchaseRequests : []) {
    const status = String(request?.status || '').trim().toLowerCase();
    if (status !== 'completed') {
      metrics.skippedRequestEvents += 1;
      continue;
    }

    const legacyUser = resolveLegacyUserFromRef(userMaps, request?.userId);
    const userCode = normalizeUserCode(legacyUser?.userId || request?.userId);
    const expectedQty = normalizePositiveInt(request?.quantity);
    if (!userCode || expectedQty <= 0) {
      metrics.skippedRequestEvents += 1;
      continue;
    }

    const totalAmountCentsRaw = Math.round(Math.abs(Number(request?.amount || 0)) * 100);
    const totalAmountCents = Number.isFinite(totalAmountCentsRaw) && totalAmountCentsRaw > 0
      ? totalAmountCentsRaw
      : expectedQty * DEFAULT_PIN_PRICE_CENTS;
    const createdAtIso = toIsoOrNow(request?.processedAt || request?.createdAt);
    const requestId = String(request?.id || '').trim();
    if (requestId) recoveredRequestIds.add(requestId);

    pushEvent(userCode, {
      sourceType: 'pin_purchase_request',
      sourceId: requestId || `request_${userCode}_${createdAtIso}`,
      createdAtIso,
      expectedQty,
      totalAmountCents,
      description: `Legacy request backfill (${expectedQty} pins)`
    });
    metrics.requestEvents += 1;
  }

  for (const tx of Array.isArray(legacyTransactions) ? legacyTransactions : []) {
    const txType = String(tx?.type || '').trim().toLowerCase();
    const txStatus = String(tx?.status || '').trim().toLowerCase();
    if (txType !== 'pin_purchase' || txStatus !== 'completed') {
      metrics.skippedTransactionEvents += 1;
      continue;
    }

    const txId = String(tx?.id || '').trim();
    const recoveredMatch = txId.match(/^tx_recover_pin_purchase_(.+)$/i);
    if (recoveredMatch && recoveredRequestIds.has(String(recoveredMatch[1] || '').trim())) {
      metrics.skippedDuplicateRecoveredTransactions += 1;
      continue;
    }

    const legacyUser = resolveLegacyUserFromRef(userMaps, tx?.userId);
    const userCode = normalizeUserCode(legacyUser?.userId || tx?.userId);
    if (!userCode) {
      metrics.skippedTransactionEvents += 1;
      continue;
    }

    const amountAbsCentsRaw = Math.round(Math.abs(Number(tx?.amount || 0)) * 100);
    const amountAbsCents = Number.isFinite(amountAbsCentsRaw) ? amountAbsCentsRaw : 0;
    let expectedQty = parseQuantityFromText(tx?.description);
    if (expectedQty <= 0 && amountAbsCents > 0) {
      expectedQty = Math.max(1, Math.round(amountAbsCents / DEFAULT_PIN_PRICE_CENTS));
    }

    if (expectedQty <= 0) {
      metrics.skippedTransactionEvents += 1;
      continue;
    }

    const totalAmountCents = amountAbsCents > 0
      ? amountAbsCents
      : expectedQty * DEFAULT_PIN_PRICE_CENTS;

    pushEvent(userCode, {
      sourceType: 'pin_purchase_transaction',
      sourceId: txId || `transaction_${userCode}_${Date.now()}`,
      createdAtIso: toIsoOrNow(tx?.completedAt || tx?.createdAt),
      expectedQty,
      totalAmountCents,
      description: String(tx?.description || '').trim() || `Legacy transaction backfill (${expectedQty} pins)`
    });
    metrics.transactionEvents += 1;
  }

  for (const [userCode, events] of eventsByUserCode.entries()) {
    events.sort((left, right) => new Date(left.createdAtIso).getTime() - new Date(right.createdAtIso).getTime());
    eventsByUserCode.set(userCode, events);
  }

  return { eventsByUserCode, metrics };
}

function buildReconstructedPurchaseGroupsForBuyer(pins, purchaseSignals = []) {
  const sortedPins = [...pins].sort((left, right) => new Date(left.createdAtIso).getTime() - new Date(right.createdAtIso).getTime());
  const groups = [];
  const metrics = {
    signalGroupsCreated: 0,
    fallbackGroupsCreated: 0,
    pinsAssignedFromSignals: 0,
    pinsAssignedFromFallback: 0
  };

  let cursor = 0;
  for (const signal of purchaseSignals) {
    if (cursor >= sortedPins.length) break;
    const expectedQty = Math.max(1, normalizePositiveInt(signal?.expectedQty));
    const eventPins = sortedPins.slice(cursor, cursor + expectedQty);
    if (eventPins.length === 0) continue;

    groups.push({
      sourceType: signal.sourceType,
      sourceId: signal.sourceId,
      createdAtIso: signal.createdAtIso,
      description: signal.description,
      pins: eventPins
    });
    metrics.signalGroupsCreated += 1;
    metrics.pinsAssignedFromSignals += eventPins.length;
    cursor += eventPins.length;
  }

  if (cursor < sortedPins.length) {
    const fallbackGroupsByKey = new Map();
    for (const pin of sortedPins.slice(cursor)) {
      const createdAt = parseIsoOrNull(pin.createdAtIso) || new Date().toISOString();
      const dayKey = createdAt.slice(0, 10);
      const key = `${dayKey}:${pin.priceCents}`;
      const existing = fallbackGroupsByKey.get(key) || {
        sourceType: 'fallback_pin_created_day',
        sourceId: key,
        createdAtIso: createdAt,
        description: `Legacy fallback backfill (${dayKey})`,
        pins: []
      };
      existing.pins.push(pin);
      fallbackGroupsByKey.set(key, existing);
    }

    const fallbackGroups = Array.from(fallbackGroupsByKey.values())
      .sort((left, right) => new Date(left.createdAtIso).getTime() - new Date(right.createdAtIso).getTime());
    for (const group of fallbackGroups) {
      groups.push(group);
      metrics.fallbackGroupsCreated += 1;
      metrics.pinsAssignedFromFallback += group.pins.length;
    }
  }

  return { groups, metrics };
}

async function createSyntheticPurchaseTxn(conn, params) {
  const {
    buyerUserId,
    buyerUserCode,
    sourceType,
    sourceId,
    description,
    createdAtIso,
    pins
  } = params;

  const totalAmountCents = pins.reduce((sum, pin) => sum + Number(pin.priceCents || 0), 0);
  const idempotencyKey = createSyntheticIdempotencyKey(buyerUserCode, sourceId || sourceType || 'group');
  const requestHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  const responseBody = JSON.stringify({
    ok: true,
    source: 'legacy_pin_backfill_reconstructed',
    buyerUserCode,
    pinCount: pins.length,
    totalAmountCents,
    sourceType,
    sourceId
  });

  await conn.execute(
    `INSERT INTO v2_idempotency_keys
      (idempotency_key, endpoint_name, actor_user_id, request_hash, status, response_code, response_body, locked_until)
     VALUES
      (?, 'legacy_pin_backfill_reconstructed', ?, ?, 'completed', 200, ?, NULL)`,
    [idempotencyKey, buyerUserId, requestHash, responseBody]
  );

  const createdAt = toMySqlDateTime(createdAtIso);
  const [txResult] = await conn.execute(
    `INSERT INTO v2_ledger_transactions
      (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
       reference_type, reference_id, description, total_debit_cents, total_credit_cents, created_at, posted_at)
     VALUES
      (?, 'v2', 'pin_purchase', 'posted', ?, ?,
       ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUuid(),
      idempotencyKey,
      buyerUserId,
      String(sourceType || 'legacy_backfill').slice(0, 40),
      String(sourceId || `${buyerUserCode}:${pins.length}`).slice(0, 80),
      String(description || `Legacy pin backfill (${pins.length} pins)`).slice(0, 255),
      totalAmountCents,
      totalAmountCents,
      createdAt,
      createdAt
    ]
  );

  return {
    ledgerTxnId: Number(txResult?.insertId || 0),
    idempotencyKey,
    totalAmountCents
  };
}

async function applyBackfill(conn, candidates, purchaseSignalsByUserCode) {
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
    failedItems: [],
    reconstructed: {
      signalGroupsCreated: 0,
      fallbackGroupsCreated: 0,
      pinsAssignedFromSignals: 0,
      pinsAssignedFromFallback: 0
    }
  };

  await conn.beginTransaction();
  try {
    for (const [groupKey, buyerPins] of groupedByBuyer.entries()) {
      const [buyerUserIdRaw, buyerUserCode] = groupKey.split(':');
      const buyerUserId = Number(buyerUserIdRaw);
      const purchaseSignals = purchaseSignalsByUserCode.get(buyerUserCode) || [];
      const grouped = buildReconstructedPurchaseGroupsForBuyer(buyerPins, purchaseSignals);

      results.reconstructed.signalGroupsCreated += grouped.metrics.signalGroupsCreated;
      results.reconstructed.fallbackGroupsCreated += grouped.metrics.fallbackGroupsCreated;
      results.reconstructed.pinsAssignedFromSignals += grouped.metrics.pinsAssignedFromSignals;
      results.reconstructed.pinsAssignedFromFallback += grouped.metrics.pinsAssignedFromFallback;

      for (const purchaseGroup of grouped.groups) {
        const synthetic = await createSyntheticPurchaseTxn(conn, {
          buyerUserId,
          buyerUserCode,
          sourceType: purchaseGroup.sourceType,
          sourceId: purchaseGroup.sourceId,
          description: purchaseGroup.description,
          createdAtIso: purchaseGroup.createdAtIso,
          pins: purchaseGroup.pins
        });

        results.syntheticTransactions.push({
          buyerUserCode,
          buyerUserId,
          ledgerTxnId: synthetic.ledgerTxnId,
          pinCount: purchaseGroup.pins.length,
          totalAmountCents: synthetic.totalAmountCents,
          sourceType: purchaseGroup.sourceType,
          sourceId: purchaseGroup.sourceId
        });

        for (const pin of purchaseGroup.pins) {
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

    const purchaseSignals = buildPurchaseHistorySignals({
      legacyPinPurchaseRequests: legacy.pinPurchaseRequests,
      legacyTransactions: legacy.transactions,
      userMaps,
      userCodeFilter: args.userCode
    });

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      filters: {
        userCode: args.userCode || null,
        limit: args.limit
      },
      purchaseHistorySignals: purchaseSignals.metrics,
      totals: classified.counters,
      warnings: classified.warnings,
      candidatesSample: classified.candidates.slice(0, 50),
      candidateCount: classified.candidates.length,
      ownerUserCodesWithCandidates: classified.ownerUserCodes
    };

    if (args.apply && classified.candidates.length > 0) {
      report.apply = await applyBackfill(conn, classified.candidates, purchaseSignals.eventsByUserCode);

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
    const reconstructedSignalGroups = Number(report?.apply?.reconstructed?.signalGroupsCreated || 0);
    const reconstructedFallbackGroups = Number(report?.apply?.reconstructed?.fallbackGroupsCreated || 0);
    const pinsAssignedFromSignals = Number(report?.apply?.reconstructed?.pinsAssignedFromSignals || 0);
    const pinsAssignedFromFallback = Number(report?.apply?.reconstructed?.pinsAssignedFromFallback || 0);
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
      `SignalRequestEvents: ${purchaseSignals.metrics.requestEvents}`,
      `SignalTransactionEvents: ${purchaseSignals.metrics.transactionEvents}`,
      `SignalSkippedRecoveredTxDups: ${purchaseSignals.metrics.skippedDuplicateRecoveredTransactions}`,
      `InsertedPins: ${insertedPins}`,
      `ApplyDuplicateSkips: ${duplicatesDuringApply}`,
      `ApplyFailedPins: ${failedPins}`,
      `ReconstructedSignalGroups: ${reconstructedSignalGroups}`,
      `ReconstructedFallbackGroups: ${reconstructedFallbackGroups}`,
      `PinsAssignedFromSignals: ${pinsAssignedFromSignals}`,
      `PinsAssignedFromFallback: ${pinsAssignedFromFallback}`,
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
