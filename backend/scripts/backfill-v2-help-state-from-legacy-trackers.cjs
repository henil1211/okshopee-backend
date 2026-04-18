#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const pendingAmountRaw = Number(process.env.V2_HELP_LEVEL1_AMOUNT_CENTS || 500);

  const args = {
    apply: false,
    mergeMode: 'additive', // additive | max
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    label: 'help-state-backfill',
    userCodes: [],
    allowWalletGap: false,
    pendingContributionAmountCents: Number.isFinite(pendingAmountRaw) && pendingAmountRaw > 0
      ? Math.trunc(pendingAmountRaw)
      : 500
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--apply') {
      args.apply = true;
      continue;
    }

    if (item === '--allow-wallet-gap') {
      args.allowWalletGap = true;
      continue;
    }

    if (!item.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) i += 1;

    switch (key) {
      case 'merge-mode':
        args.mergeMode = String(value || '').trim().toLowerCase() === 'max' ? 'max' : 'additive';
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
      case 'label':
        args.label = value;
        break;
      case 'user-codes':
        args.userCodes = String(value || '')
          .split(',')
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        break;
      case 'pending-contribution-amount-cents': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          args.pendingContributionAmountCents = Math.trunc(parsed);
        }
        break;
      }
      default:
        break;
    }
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

function toCents(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100));
}

function toInt(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

function normalizeCode(value) {
  const code = String(value || '').trim();
  return /^\d{7}$/.test(code) ? code : code;
}

function getLegacyLockedQueueByLevel(tracker) {
  const out = new Map();
  const queue = Array.isArray(tracker?.lockedQueue) ? tracker.lockedQueue : [];

  for (const item of queue) {
    if (!item || typeof item !== 'object') continue;
    if (String(item.status || '').toLowerCase() !== 'locked') continue;
    const levelNo = toInt(item.level);
    if (!levelNo) continue;
    const current = out.get(levelNo) || 0;
    out.set(levelNo, current + toCents(item.amount));
  }

  return out;
}

function mergeMetric(existingValue, candidateValue, mode) {
  if (mode === 'max') return Math.max(toInt(existingValue), toInt(candidateValue));
  return toInt(existingValue) + toInt(candidateValue);
}

async function ensureHelpTables(conn) {
  await conn.query(
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
       UNIQUE KEY uq_v2_help_level_state_user_level (user_id, level_no)
     ) ENGINE=InnoDB`
  );

  await conn.query(
    `CREATE TABLE IF NOT EXISTS v2_help_progress_state (
       user_id BIGINT UNSIGNED PRIMARY KEY,
       current_stage_code VARCHAR(40) NOT NULL DEFAULT 'BASELINE',
       receive_count_in_stage INT UNSIGNED NOT NULL DEFAULT 0,
       receive_total_cents_in_stage BIGINT UNSIGNED NOT NULL DEFAULT 0,
       next_required_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       pending_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
       last_progress_event_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
       baseline_snapshot_at DATETIME(3) NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
     ) ENGINE=InnoDB`
  );

  await conn.query(
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
       KEY idx_v2_help_pending_beneficiary_status (beneficiary_user_id, status, level_no, id)
     ) ENGINE=InnoDB`
  );
}

async function loadStateRows(conn) {
  const [rows] = await conn.query(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN (
       'mlm_users',
       'mlm_help_trackers',
       'mlm_transactions',
       'mlm_wallets',
       'mlm_matrix_pending_contributions',
       'mlm_matrix'
     )`
  );

  const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key), row.state_value]));
  const legacyUsers = safeParseJson(byKey.get('mlm_users') || '[]', []);
  const legacyTrackers = safeParseJson(byKey.get('mlm_help_trackers') || '[]', []);
  const legacyTransactions = safeParseJson(byKey.get('mlm_transactions') || '[]', []);
  const legacyWallets = safeParseJson(byKey.get('mlm_wallets') || '[]', []);
  const legacyPendingContributions = safeParseJson(byKey.get('mlm_matrix_pending_contributions') || '[]', []);
  const legacyMatrix = safeParseJson(byKey.get('mlm_matrix') || '[]', []);

  return {
    legacyUsers: Array.isArray(legacyUsers) ? legacyUsers : [],
    legacyTrackers: Array.isArray(legacyTrackers) ? legacyTrackers : [],
    legacyTransactions: Array.isArray(legacyTransactions) ? legacyTransactions : [],
    legacyWallets: Array.isArray(legacyWallets) ? legacyWallets : [],
    legacyPendingContributions: Array.isArray(legacyPendingContributions) ? legacyPendingContributions : [],
    legacyMatrix: Array.isArray(legacyMatrix) ? legacyMatrix : []
  };
}

async function loadV2Users(conn) {
  const [rows] = await conn.query(
    `SELECT id, user_code, legacy_user_id
     FROM v2_users`
  );
  const v2ByCode = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    v2ByCode.set(String(row.user_code), {
      id: Number(row.id),
      userCode: String(row.user_code),
      legacyUserId: row.legacy_user_id ? String(row.legacy_user_id) : null
    });
  }
  return v2ByCode;
}

function normalizeLegacyLevelFromTransaction(tx) {
  const numericLevel = toInt(tx?.level);
  if (numericLevel > 0) return numericLevel;

  const desc = String(tx?.description || tx?.notes || '').toLowerCase();
  const match = desc.match(/\blevel\s+(\d+)\b/i);
  const parsed = match ? toInt(match[1]) : 0;
  return parsed > 0 ? parsed : 1;
}

function buildCandidatesFromTrackers({ legacyUsers, legacyTrackers, v2ByCode, allowedCodes }) {
  const legacyByInternal = new Map();
  for (const user of legacyUsers) {
    const internal = String(user?.id || '').trim();
    if (!internal) continue;
    legacyByInternal.set(internal, user);
  }

  const aggregate = new Map();
  const unresolved = [];

  for (const tracker of legacyTrackers) {
    if (!tracker || typeof tracker !== 'object') continue;
    const legacyInternalId = String(tracker.userId || '').trim();
    if (!legacyInternalId) continue;

    const legacyUser = legacyByInternal.get(legacyInternalId) || null;
    const userCode = normalizeCode(legacyUser?.userId);
    if (!userCode) continue;
    if (allowedCodes.size > 0 && !allowedCodes.has(userCode)) continue;

    const v2User = v2ByCode.get(userCode) || null;
    if (!v2User?.id) {
      unresolved.push({ userCode, reason: 'missing_v2_user' });
      continue;
    }

    const queueByLevel = getLegacyLockedQueueByLevel(tracker);
    const levels = tracker.levels && typeof tracker.levels === 'object' ? tracker.levels : {};

    for (const [levelKey, rawState] of Object.entries(levels)) {
      const state = rawState && typeof rawState === 'object' ? rawState : {};
      const levelNo = toInt(state.level || levelKey);
      if (!levelNo) continue;

      const receiveCount = toInt(state.receiveEvents);
      const receiveTotalCents = toCents(state.receivedAmount);
      const lockedFirstTwoFromState = toCents(state.lockedAmount);
      const lockedQueueCents = queueByLevel.get(levelNo) || 0;
      const lockedFirstTwoCents = Math.max(lockedFirstTwoFromState, lockedQueueCents);
      const lockedQualificationCents = toCents(state.lockedReceiveAmount);
      const safetyDeductedCents = toCents(state.safetyDeducted);
      const pendingGiveCents = lockedQueueCents;
      const givenCents = toCents(state.givenAmount);
      const incomeCreditedCents = Math.max(
        0,
        receiveTotalCents - lockedFirstTwoCents - lockedQualificationCents - safetyDeductedCents
      );
      const lastEventSeq = Math.max(1, receiveCount + toInt(state.giveEvents));

      const key = `${v2User.id}:${levelNo}`;
      const existing = aggregate.get(key);

      if (!existing) {
        aggregate.set(key, {
          v2UserId: v2User.id,
          userCode,
          levelNo,
          receiveCount,
          receiveTotalCents,
          lockedFirstTwoCents,
          lockedQualificationCents,
          safetyDeductedCents,
          pendingGiveCents,
          givenCents,
          incomeCreditedCents,
          lastEventSeq
        });
      } else {
        existing.receiveCount += receiveCount;
        existing.receiveTotalCents += receiveTotalCents;
        existing.lockedFirstTwoCents += lockedFirstTwoCents;
        existing.lockedQualificationCents += lockedQualificationCents;
        existing.safetyDeductedCents += safetyDeductedCents;
        existing.pendingGiveCents += pendingGiveCents;
        existing.givenCents += givenCents;
        existing.incomeCreditedCents += incomeCreditedCents;
        existing.lastEventSeq += lastEventSeq;
      }
    }
  }

  return {
    candidates: Array.from(aggregate.values()).sort((a, b) => a.v2UserId - b.v2UserId || a.levelNo - b.levelNo),
    unresolved
  };
}

function buildCandidatesFromTransactions({ legacyUsers, legacyTransactions, v2ByCode, allowedCodes }) {
  const legacyByInternal = new Map();
  const legacyByPublicCode = new Map();

  for (const user of legacyUsers) {
    const internal = String(user?.id || '').trim();
    const publicCode = normalizeCode(user?.userId);
    if (internal) legacyByInternal.set(internal, user);
    if (publicCode) legacyByPublicCode.set(publicCode, user);
  }

  const aggregate = new Map();
  const unresolved = [];

  for (const tx of legacyTransactions) {
    if (!tx || typeof tx !== 'object') continue;
    const type = String(tx.type || '').trim().toLowerCase();
    const status = String(tx.status || '').trim().toLowerCase();
    if (status !== 'completed') continue;
    if (type !== 'receive_help' && type !== 'give_help') continue;

    const userRef = String(tx.userId || '').trim();
    if (!userRef) continue;

    const userFromInternal = legacyByInternal.get(userRef) || null;
    const userFromPublic = legacyByPublicCode.get(normalizeCode(userRef)) || null;
    const legacyUser = userFromInternal || userFromPublic;
    const userCode = normalizeCode(legacyUser?.userId || userRef);
    if (!userCode) continue;
    if (allowedCodes.size > 0 && !allowedCodes.has(userCode)) continue;

    const v2User = v2ByCode.get(userCode) || null;
    if (!v2User?.id) {
      unresolved.push({ userCode, reason: 'missing_v2_user' });
      continue;
    }

    const levelNo = normalizeLegacyLevelFromTransaction(tx);
    const key = `${v2User.id}:${levelNo}`;
    const desc = String(tx.description || tx.notes || '').toLowerCase();
    const amount = Number(tx.amount || 0);
    const amountCents = Math.round(Math.abs(amount) * 100);

    const existing = aggregate.get(key) || {
      v2UserId: v2User.id,
      userCode,
      levelNo,
      receiveCount: 0,
      receiveTotalCents: 0,
      lockedFirstTwoCents: 0,
      lockedQualificationCents: 0,
      safetyDeductedCents: 0,
      pendingGiveCents: 0,
      givenCents: 0,
      incomeCreditedCents: 0,
      lastEventSeq: 0
    };

    if (type === 'receive_help' && amount > 0) {
      existing.receiveCount += 1;
      existing.receiveTotalCents += amountCents;
      existing.lastEventSeq += 1;

      if (desc.includes('locked first-two help at level')) {
        existing.lockedFirstTwoCents += amountCents;
      } else if (desc.includes('locked receive help at level')) {
        existing.lockedQualificationCents += amountCents;
      } else if (desc.includes('safety') && desc.includes('diversion')) {
        existing.safetyDeductedCents += amountCents;
      }
    }

    if (type === 'give_help' && amount < 0 && desc.includes('from locked income')) {
      existing.givenCents += amountCents;
      existing.lastEventSeq += 1;
    }

    aggregate.set(key, existing);
  }

  for (const row of aggregate.values()) {
    row.pendingGiveCents = Math.max(0, row.lockedFirstTwoCents - row.givenCents);
    row.incomeCreditedCents = Math.max(
      0,
      row.receiveTotalCents - row.lockedFirstTwoCents - row.lockedQualificationCents - row.safetyDeductedCents
    );
  }

  return {
    candidates: Array.from(aggregate.values()).sort((a, b) => a.v2UserId - b.v2UserId || a.levelNo - b.levelNo),
    unresolved
  };
}

function buildCandidates({ legacyUsers, legacyTrackers, legacyTransactions, v2ByCode, allowedCodes }) {
  const trackerResult = buildCandidatesFromTrackers({
    legacyUsers,
    legacyTrackers,
    v2ByCode,
    allowedCodes
  });

  if (trackerResult.candidates.length > 0) {
    return { ...trackerResult, sourceUsed: 'mlm_help_trackers' };
  }

  const transactionResult = buildCandidatesFromTransactions({
    legacyUsers,
    legacyTransactions,
    v2ByCode,
    allowedCodes
  });

  if (transactionResult.candidates.length > 0) {
    return { ...transactionResult, sourceUsed: 'mlm_transactions' };
  }

  const unresolved = [...trackerResult.unresolved, ...transactionResult.unresolved];
  return { candidates: [], unresolved, sourceUsed: 'none' };
}

function buildLegacyUserLookups(legacyUsers) {
  const byInternal = new Map();
  const byPublicCode = new Map();

  for (const user of legacyUsers) {
    const internal = String(user?.id || '').trim();
    const publicCode = normalizeCode(user?.userId);
    if (internal) byInternal.set(internal, user);
    if (publicCode) byPublicCode.set(publicCode, user);
  }

  return { byInternal, byPublicCode };
}

function resolveLegacyUserByRef(ref, lookups) {
  const rawRef = String(ref || '').trim();
  if (!rawRef) return null;

  const fromInternal = lookups.byInternal.get(rawRef) || null;
  if (fromInternal) return fromInternal;

  const normalizedCode = normalizeCode(rawRef);
  return lookups.byPublicCode.get(normalizedCode) || null;
}

function normalizePendingSide(value) {
  const side = String(value || '').trim().toLowerCase();
  if (side === 'left' || side === 'right') return side;
  return 'unknown';
}

function buildPendingContributionCandidates({
  legacyUsers,
  legacyPendingContributions,
  v2ByCode,
  allowedCodes,
  pendingContributionAmountCents
}) {
  const lookups = buildLegacyUserLookups(legacyUsers);
  const unresolved = [];
  const floorByUserLevel = new Map();
  const pendingRows = [];
  const seenDedupes = new Set();
  const amountCents = Math.max(1, toInt(pendingContributionAmountCents));

  for (let index = 0; index < legacyPendingContributions.length; index += 1) {
    const item = legacyPendingContributions[index];
    if (!item || typeof item !== 'object') continue;

    const status = String(item.status || '').trim().toLowerCase();
    if (status && status !== 'pending') continue;

    const levelNo = toInt(item.level);
    if (!levelNo) continue;

    const sourceLegacyUser = resolveLegacyUserByRef(item.fromUserId, lookups);
    const beneficiaryLegacyUser = resolveLegacyUserByRef(item.toUserId, lookups);
    const sourceUserCode = normalizeCode(sourceLegacyUser?.userId || item.fromUserId);
    const beneficiaryUserCode = normalizeCode(beneficiaryLegacyUser?.userId || item.toUserId);

    if (!sourceUserCode || !beneficiaryUserCode) {
      unresolved.push({
        sourceRef: String(item.fromUserId || ''),
        beneficiaryRef: String(item.toUserId || ''),
        levelNo,
        reason: 'invalid_legacy_user_reference'
      });
      continue;
    }

    if (
      allowedCodes.size > 0
      && !allowedCodes.has(sourceUserCode)
      && !allowedCodes.has(beneficiaryUserCode)
    ) {
      continue;
    }

    const sourceV2User = v2ByCode.get(sourceUserCode) || null;
    const beneficiaryV2User = v2ByCode.get(beneficiaryUserCode) || null;
    if (!sourceV2User?.id || !beneficiaryV2User?.id) {
      unresolved.push({
        sourceUserCode,
        beneficiaryUserCode,
        levelNo,
        reason: 'missing_v2_user'
      });
      continue;
    }

    const sourceLevelNo = Math.max(1, levelNo - 1);
    const floorKey = `${sourceV2User.id}:${sourceLevelNo}`;
    floorByUserLevel.set(floorKey, (floorByUserLevel.get(floorKey) || 0) + amountCents);

    const pendingId = String(item.id || '').trim();
    const sourceEventKey = pendingId
      ? `legacy_pmc_${pendingId}`.slice(0, 180)
      : `legacy_pmc_idx_${index}`;
    const side = normalizePendingSide(item.side);

    const dedupeKey = `${sourceEventKey}|${sourceV2User.id}|${beneficiaryV2User.id}|${levelNo}|${side}`;
    if (seenDedupes.has(dedupeKey)) continue;
    seenDedupes.add(dedupeKey);

    pendingRows.push({
      sourceEventKey,
      sourceV2UserId: sourceV2User.id,
      beneficiaryV2UserId: beneficiaryV2User.id,
      sourceUserCode,
      beneficiaryUserCode,
      levelNo,
      side,
      amountCents
    });
  }

  return {
    pendingRows,
    pendingGiveFloorByUserLevel: floorByUserLevel,
    unresolved
  };
}

async function loadExistingLevelRows(conn, candidateRows) {
  const byKey = new Map();
  for (const row of candidateRows) {
    const [rows] = await conn.query(
      `SELECT *
       FROM v2_help_level_state
       WHERE user_id = ? AND level_no = ?
       LIMIT 1`,
      [row.v2UserId, row.levelNo]
    );
    const found = Array.isArray(rows) && rows[0] ? rows[0] : null;
    byKey.set(`${row.v2UserId}:${row.levelNo}`, found);
  }
  return byKey;
}

function buildMergedRows(candidateRows, existingByKey, mergeMode) {
  const merged = [];

  for (const row of candidateRows) {
    const key = `${row.v2UserId}:${row.levelNo}`;
    const existing = existingByKey.get(key);

    const mergedRow = {
      v2UserId: row.v2UserId,
      userCode: row.userCode,
      levelNo: row.levelNo,
      receiveCount: mergeMetric(existing?.receive_count, row.receiveCount, mergeMode),
      receiveTotalCents: mergeMetric(existing?.receive_total_cents, row.receiveTotalCents, mergeMode),
      lockedFirstTwoCents: mergeMetric(existing?.locked_first_two_cents, row.lockedFirstTwoCents, mergeMode),
      lockedQualificationCents: mergeMetric(existing?.locked_qualification_cents, row.lockedQualificationCents, mergeMode),
      safetyDeductedCents: mergeMetric(existing?.safety_deducted_cents, row.safetyDeductedCents, mergeMode),
      pendingGiveCents: mergeMetric(existing?.pending_give_cents, row.pendingGiveCents, mergeMode),
      givenCents: mergeMetric(existing?.given_cents, row.givenCents, mergeMode),
      incomeCreditedCents: mergeMetric(existing?.income_credited_cents, row.incomeCreditedCents, mergeMode),
      lastEventSeq: mergeMetric(existing?.last_event_seq, row.lastEventSeq, mergeMode),
      hadExisting: !!existing
    };

    merged.push(mergedRow);
  }

  return merged;
}

function applyPendingGiveFloorToMergedRows(mergedRows, pendingGiveFloorByUserLevel, v2ByCode) {
  if (!(pendingGiveFloorByUserLevel instanceof Map) || pendingGiveFloorByUserLevel.size === 0) {
    return mergedRows;
  }

  const userCodeById = new Map();
  for (const row of v2ByCode.values()) {
    userCodeById.set(Number(row.id), String(row.userCode));
  }

  const byKey = new Map(mergedRows.map((row) => [`${row.v2UserId}:${row.levelNo}`, row]));

  for (const [key, floorPendingGiveCentsRaw] of pendingGiveFloorByUserLevel.entries()) {
    const floorPendingGiveCents = toInt(floorPendingGiveCentsRaw);
    if (floorPendingGiveCents <= 0) continue;

    let row = byKey.get(key);
    if (!row) {
      const [v2UserIdRaw, levelNoRaw] = String(key).split(':');
      const v2UserId = toInt(v2UserIdRaw);
      const levelNo = toInt(levelNoRaw);
      if (!v2UserId || !levelNo) continue;

      row = {
        v2UserId,
        userCode: userCodeById.get(v2UserId) || `unknown:${v2UserId}`,
        levelNo,
        receiveCount: 0,
        receiveTotalCents: 0,
        lockedFirstTwoCents: 0,
        lockedQualificationCents: 0,
        safetyDeductedCents: 0,
        pendingGiveCents: 0,
        givenCents: 0,
        incomeCreditedCents: 0,
        lastEventSeq: 0,
        hadExisting: false
      };
      mergedRows.push(row);
      byKey.set(key, row);
    }

    row.pendingGiveCents = Math.max(toInt(row.pendingGiveCents), floorPendingGiveCents);
    row.lockedFirstTwoCents = Math.max(toInt(row.lockedFirstTwoCents), row.pendingGiveCents);
    row.incomeCreditedCents = Math.max(
      0,
      toInt(row.receiveTotalCents) - toInt(row.lockedFirstTwoCents) - toInt(row.lockedQualificationCents) - toInt(row.safetyDeductedCents)
    );
    row.lastEventSeq = Math.max(1, toInt(row.lastEventSeq));
  }

  mergedRows.sort((a, b) => a.v2UserId - b.v2UserId || a.levelNo - b.levelNo);
  return mergedRows;
}

function buildProgressRows(mergedRows) {
  const byUser = new Map();

  for (const row of mergedRows) {
    const existing = byUser.get(row.v2UserId) || {
      v2UserId: row.v2UserId,
      userCode: row.userCode,
      topLevelNo: 0,
      topReceiveCount: 0,
      topReceiveTotalCents: 0,
      pendingGiveCents: 0,
      lastProgressEventSeq: 0
    };

    existing.pendingGiveCents += row.pendingGiveCents;
    existing.lastProgressEventSeq += row.lastEventSeq;

    if (row.levelNo > existing.topLevelNo) {
      existing.topLevelNo = row.levelNo;
      existing.topReceiveCount = row.receiveCount;
      existing.topReceiveTotalCents = row.receiveTotalCents;
    }

    byUser.set(row.v2UserId, existing);
  }

  return Array.from(byUser.values()).map((row) => {
    const levelNo = Math.max(1, row.topLevelNo || 1);
    const stageCode = row.pendingGiveCents > 0
      ? `L${levelNo}_PENDING_GIVE`
      : `L${levelNo}_RECEIVE`;

    return {
      ...row,
      stageCode,
      nextRequiredGiveCents: row.pendingGiveCents
    };
  });
}

async function applyMergedRows(conn, mergedRows, progressRows) {
  for (const row of mergedRows) {
    await conn.query(
      `INSERT INTO v2_help_level_state
        (user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
         locked_qualification_cents, safety_deducted_cents, pending_give_cents,
         given_cents, income_credited_cents, last_event_seq)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        receive_count = VALUES(receive_count),
        receive_total_cents = VALUES(receive_total_cents),
        locked_first_two_cents = VALUES(locked_first_two_cents),
        locked_qualification_cents = VALUES(locked_qualification_cents),
        safety_deducted_cents = VALUES(safety_deducted_cents),
        pending_give_cents = VALUES(pending_give_cents),
        given_cents = VALUES(given_cents),
        income_credited_cents = VALUES(income_credited_cents),
        last_event_seq = VALUES(last_event_seq),
        updated_at = NOW(3)`,
      [
        row.v2UserId,
        row.levelNo,
        row.receiveCount,
        row.receiveTotalCents,
        row.lockedFirstTwoCents,
        row.lockedQualificationCents,
        row.safetyDeductedCents,
        row.pendingGiveCents,
        row.givenCents,
        row.incomeCreditedCents,
        row.lastEventSeq
      ]
    );
  }

  for (const row of progressRows) {
    await conn.query(
      `INSERT INTO v2_help_progress_state
        (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
         next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
        current_stage_code = VALUES(current_stage_code),
        receive_count_in_stage = VALUES(receive_count_in_stage),
        receive_total_cents_in_stage = VALUES(receive_total_cents_in_stage),
        next_required_give_cents = VALUES(next_required_give_cents),
        pending_give_cents = VALUES(pending_give_cents),
        last_progress_event_seq = VALUES(last_progress_event_seq),
        baseline_snapshot_at = NOW(3),
        updated_at = NOW(3)`,
      [
        row.v2UserId,
        row.stageCode,
        row.topReceiveCount,
        row.topReceiveTotalCents,
        row.nextRequiredGiveCents,
        row.pendingGiveCents,
        row.lastProgressEventSeq
      ]
    );
  }
}

async function applyPendingContributionRows(conn, pendingContributionRows) {
  for (const row of pendingContributionRows) {
    await conn.query(
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
        row.sourceEventKey,
        row.sourceV2UserId,
        row.beneficiaryV2UserId,
        row.levelNo,
        normalizePendingSide(row.side),
        row.amountCents
      ]
    );
  }
}

function buildWalletReconciliation({ legacyUsers, legacyWallets, v2ByCode, mergedRows }) {
  const lookups = buildLegacyUserLookups(legacyUsers);
  const pendingByUserId = new Map();

  for (const row of mergedRows) {
    pendingByUserId.set(
      row.v2UserId,
      (pendingByUserId.get(row.v2UserId) || 0) + toInt(row.pendingGiveCents)
    );
  }

  const deltas = [];
  for (const wallet of legacyWallets) {
    if (!wallet || typeof wallet !== 'object') continue;

    const legacyUser = resolveLegacyUserByRef(wallet.userId, lookups);
    const userCode = normalizeCode(legacyUser?.userId || wallet.userId);
    if (!userCode) continue;

    const v2User = v2ByCode.get(userCode) || null;
    if (!v2User?.id) continue;

    const walletLockedCents = toCents(Number(wallet.lockedIncomeWallet || 0) + Number(wallet.giveHelpLocked || 0));
    const derivedPendingCents = toInt(pendingByUserId.get(v2User.id) || 0);
    const deltaCents = walletLockedCents - derivedPendingCents;

    if (deltaCents === 0) continue;

    deltas.push({
      userCode,
      walletLockedCents,
      derivedPendingCents,
      deltaCents
    });
  }

  const positive = deltas.filter((item) => item.deltaCents > 0);
  const negative = deltas.filter((item) => item.deltaCents < 0);

  return {
    totalComparedUsers: deltas.length,
    positiveGapUsers: positive.length,
    negativeGapUsers: negative.length,
    maxPositiveGapCents: positive.length > 0 ? Math.max(...positive.map((item) => item.deltaCents)) : 0,
    maxNegativeGapCents: negative.length > 0 ? Math.min(...negative.map((item) => item.deltaCents)) : 0,
    samples: deltas
      .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
      .slice(0, 50)
  };
}

function summarize({
  mergedRows,
  progressRows,
  unresolved,
  pendingContributionRows,
  unresolvedPendingContributions,
  walletReconciliation,
  args,
  sourceUsed
}) {
  const affectedUsers = new Set(mergedRows.map((row) => row.userCode));
  const pendingSources = new Set(pendingContributionRows.map((row) => row.sourceUserCode));

  return {
    apply: args.apply,
    mergeMode: args.mergeMode,
    sourceUsed,
    selectedUserCodes: args.userCodes,
    pendingContributionAmountCents: args.pendingContributionAmountCents,
    allowWalletGap: args.allowWalletGap,
    candidateRows: mergedRows.length,
    affectedUsers: affectedUsers.size,
    progressRows: progressRows.length,
    unresolvedCount: unresolved.length,
    pendingContributionRows: pendingContributionRows.length,
    pendingContributionSources: pendingSources.size,
    pendingContributionUnresolvedCount: unresolvedPendingContributions.length,
    pendingContributionUnresolved: unresolvedPendingContributions.slice(0, 100),
    walletReconciliation,
    unresolved: unresolved.slice(0, 100),
    sample: mergedRows.slice(0, 20)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    await ensureHelpTables(conn);

    const allowedCodes = new Set(args.userCodes.map((v) => normalizeCode(v)));
    const stateRows = await loadStateRows(conn);
    const v2ByCode = await loadV2Users(conn);

    const { candidates, unresolved, sourceUsed } = buildCandidates({
      legacyUsers: stateRows.legacyUsers,
      legacyTrackers: stateRows.legacyTrackers,
      legacyTransactions: stateRows.legacyTransactions,
      v2ByCode,
      allowedCodes
    });

    const pendingContributionResult = buildPendingContributionCandidates({
      legacyUsers: stateRows.legacyUsers,
      legacyPendingContributions: stateRows.legacyPendingContributions,
      v2ByCode,
      allowedCodes,
      pendingContributionAmountCents: args.pendingContributionAmountCents
    });

    const existingByKey = await loadExistingLevelRows(conn, candidates);
    const mergedRows = buildMergedRows(candidates, existingByKey, args.mergeMode);
    applyPendingGiveFloorToMergedRows(
      mergedRows,
      pendingContributionResult.pendingGiveFloorByUserLevel,
      v2ByCode
    );

    const progressRows = buildProgressRows(mergedRows);
    const walletReconciliation = buildWalletReconciliation({
      legacyUsers: stateRows.legacyUsers,
      legacyWallets: stateRows.legacyWallets,
      v2ByCode,
      mergedRows
    });

    if (
      args.apply
      && !args.allowWalletGap
      && Number(walletReconciliation.positiveGapUsers || 0) > 0
    ) {
      throw new Error(
        `Wallet reconciliation has ${walletReconciliation.positiveGapUsers} users with locked-wallet > derived pending help. `
        + `Review summary.json and rerun with --allow-wallet-gap only after manual validation.`
      );
    }

    const summary = summarize({
      mergedRows,
      progressRows,
      unresolved,
      pendingContributionRows: pendingContributionResult.pendingRows,
      unresolvedPendingContributions: pendingContributionResult.unresolved,
      walletReconciliation,
      args,
      sourceUsed
    });
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

    if (!args.apply) {
      console.log('Dry run complete. No data changed.');
      console.log(JSON.stringify(summary, null, 2));
      console.log(`Evidence: ${evidenceDir}`);
      process.exit(0);
    }

    await conn.beginTransaction();
    await applyMergedRows(conn, mergedRows, progressRows);
    await applyPendingContributionRows(conn, pendingContributionResult.pendingRows);
    await conn.commit();

    console.log('Apply complete.');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Evidence: ${evidenceDir}`);
    process.exit(0);
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback errors
    }
    console.error(error?.message || error);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
