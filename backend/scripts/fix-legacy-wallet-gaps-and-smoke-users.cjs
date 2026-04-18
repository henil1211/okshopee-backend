#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const DEFAULT_SMOKE_USER_CODES = ['9900001', '9900002'];
const STATE_KEYS_TO_LOAD = [
  'mlm_users',
  'mlm_wallets',
  'mlm_matrix',
  'mlm_transactions',
  'mlm_pins',
  'mlm_pin_transfers',
  'mlm_pin_purchase_requests',
  'mlm_notifications',
  'mlm_otp_records'
];

function parseArgs(argv) {
  const args = {
    apply: false,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    smokeUserCodes: [...DEFAULT_SMOKE_USER_CODES],
    label: 'legacy-wallet-smoke-cleanup'
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
      case 'smoke-user-codes':
        args.smokeUserCodes = String(value || '')
          .split(',')
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        break;
      case 'label':
        args.label = String(value || '').trim() || 'legacy-wallet-smoke-cleanup';
        break;
      default:
        break;
    }
  }

  if (!Array.isArray(args.smokeUserCodes) || args.smokeUserCodes.length === 0) {
    args.smokeUserCodes = [...DEFAULT_SMOKE_USER_CODES];
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
    const parsed = JSON.parse(String(raw || ''));
    if (parsed == null) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function toMySqlDateTime(isoString) {
  if (!isoString) return null;
  return isoString.replace('T', ' ').replace('Z', '');
}

function normalizeRef(value) {
  return String(value || '').trim();
}

function hasAnyMatchingRef(row, fields, refs) {
  if (!row || typeof row !== 'object') return false;
  for (const field of fields) {
    const value = normalizeRef(row[field]);
    if (value && refs.has(value)) {
      return true;
    }
  }
  return false;
}

function findSmokeUsers(users, smokeCodesSet) {
  const found = [];
  for (const user of users) {
    const userCode = normalizeRef(user?.userId);
    if (!userCode || !smokeCodesSet.has(userCode)) continue;
    found.push(user);
  }
  return found;
}

function buildRemovedRefs(smokeUsers) {
  const refs = new Set();
  for (const user of smokeUsers) {
    const internalId = normalizeRef(user?.id);
    const userCode = normalizeRef(user?.userId);
    if (internalId) refs.add(internalId);
    if (userCode) refs.add(userCode);
  }
  return refs;
}

function cleanupMatrixForRemovedRefs(matrixRows, removedRefs) {
  const filtered = (Array.isArray(matrixRows) ? matrixRows : [])
    .filter((row) => !hasAnyMatchingRef(row, ['userId'], removedRefs));

  return filtered.map((row) => {
    const next = { ...row };

    if (hasAnyMatchingRef(next, ['parentId'], removedRefs)) {
      next.parentId = null;
    }

    if (hasAnyMatchingRef(next, ['leftChild'], removedRefs)) {
      delete next.leftChild;
    }

    if (hasAnyMatchingRef(next, ['rightChild'], removedRefs)) {
      delete next.rightChild;
    }

    return next;
  });
}

function computeUnusedPinCountByOwner(pins) {
  const counts = new Map();
  for (const pin of Array.isArray(pins) ? pins : []) {
    if (String(pin?.status || '').toLowerCase() !== 'unused') continue;
    const ownerId = normalizeRef(pin?.ownerId);
    if (!ownerId) continue;
    counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
  }
  return counts;
}

function buildDefaultWallet(user, unusedPinCountByOwner) {
  const internalId = normalizeRef(user?.id);
  const userCode = normalizeRef(user?.userId);
  const pinWallet = unusedPinCountByOwner.get(internalId)
    || unusedPinCountByOwner.get(userCode)
    || 0;

  return {
    userId: internalId,
    depositWallet: 0,
    fundRecoveryDue: 0,
    fundRecoveryRecoveredTotal: 0,
    fundRecoveryReason: null,
    pinWallet,
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
  };
}

function computeUsersMissingWallet(users, wallets) {
  const walletRefs = new Set(
    (Array.isArray(wallets) ? wallets : [])
      .map((wallet) => normalizeRef(wallet?.userId))
      .filter(Boolean)
  );

  return (Array.isArray(users) ? users : []).filter((user) => {
    const internalId = normalizeRef(user?.id);
    const userCode = normalizeRef(user?.userId);
    if (!internalId && !userCode) return false;
    if (internalId && walletRefs.has(internalId)) return false;
    if (userCode && walletRefs.has(userCode)) return false;
    return true;
  });
}

async function loadState(conn, { forUpdate = false } = {}) {
  const lockClause = forUpdate ? ' FOR UPDATE' : '';
  const placeholders = STATE_KEYS_TO_LOAD.map(() => '?').join(', ');
  const [rows] = await conn.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN (${placeholders})${lockClause}`,
    STATE_KEYS_TO_LOAD
  );

  const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key), row.state_value]));
  const state = {};

  for (const key of STATE_KEYS_TO_LOAD) {
    const parsed = safeParseJson(byKey.get(key) || '[]', []);
    state[key] = Array.isArray(parsed) ? parsed : [];
  }

  return state;
}

function cloneState(state) {
  return safeParseJson(JSON.stringify(state), {});
}

function buildUpdatedState(state, smokeCodes) {
  const smokeCodesSet = new Set((Array.isArray(smokeCodes) ? smokeCodes : []).map((code) => normalizeRef(code)).filter(Boolean));

  const originalUsers = Array.isArray(state.mlm_users) ? state.mlm_users : [];
  const smokeUsers = findSmokeUsers(originalUsers, smokeCodesSet);
  const removedRefs = buildRemovedRefs(smokeUsers);

  const usersWithoutSmoke = originalUsers.filter((user) => !smokeCodesSet.has(normalizeRef(user?.userId)));

  const walletsWithoutSmoke = (Array.isArray(state.mlm_wallets) ? state.mlm_wallets : [])
    .filter((wallet) => !hasAnyMatchingRef(wallet, ['userId'], removedRefs));

  const matrixWithoutSmoke = cleanupMatrixForRemovedRefs(state.mlm_matrix, removedRefs);

  const transactionsWithoutSmoke = (Array.isArray(state.mlm_transactions) ? state.mlm_transactions : [])
    .filter((tx) => !hasAnyMatchingRef(tx, ['userId', 'fromUserId', 'toUserId'], removedRefs));

  const pinsWithoutSmoke = (Array.isArray(state.mlm_pins) ? state.mlm_pins : [])
    .filter((pin) => !hasAnyMatchingRef(pin, ['ownerId', 'usedById', 'registrationUserId', 'transferredFrom', 'suspendedBy', 'createdBy'], removedRefs));

  const pinTransfersWithoutSmoke = (Array.isArray(state.mlm_pin_transfers) ? state.mlm_pin_transfers : [])
    .filter((row) => !hasAnyMatchingRef(row, ['fromUserId', 'toUserId'], removedRefs));

  const pinRequestsWithoutSmoke = (Array.isArray(state.mlm_pin_purchase_requests) ? state.mlm_pin_purchase_requests : [])
    .filter((row) => !hasAnyMatchingRef(row, ['userId', 'processedBy'], removedRefs));

  const notificationsWithoutSmoke = (Array.isArray(state.mlm_notifications) ? state.mlm_notifications : [])
    .filter((row) => !hasAnyMatchingRef(row, ['userId'], removedRefs));

  const otpWithoutSmoke = (Array.isArray(state.mlm_otp_records) ? state.mlm_otp_records : [])
    .filter((row) => !hasAnyMatchingRef(row, ['userId'], removedRefs));

  const pinCounts = computeUnusedPinCountByOwner(pinsWithoutSmoke);
  const walletRefs = new Set(walletsWithoutSmoke.map((wallet) => normalizeRef(wallet?.userId)).filter(Boolean));

  const addedWallets = [];
  for (const user of usersWithoutSmoke) {
    const internalId = normalizeRef(user?.id);
    const userCode = normalizeRef(user?.userId);
    if (!internalId && !userCode) continue;

    const hasWallet = (internalId && walletRefs.has(internalId)) || (userCode && walletRefs.has(userCode));
    if (hasWallet) continue;

    if (!internalId) continue;

    const wallet = buildDefaultWallet(user, pinCounts);
    walletsWithoutSmoke.push(wallet);
    walletRefs.add(internalId);
    addedWallets.push({
      userCode,
      fullName: String(user?.fullName || ''),
      walletRef: internalId
    });
  }

  const updatedState = {
    ...state,
    mlm_users: usersWithoutSmoke,
    mlm_wallets: walletsWithoutSmoke,
    mlm_matrix: matrixWithoutSmoke,
    mlm_transactions: transactionsWithoutSmoke,
    mlm_pins: pinsWithoutSmoke,
    mlm_pin_transfers: pinTransfersWithoutSmoke,
    mlm_pin_purchase_requests: pinRequestsWithoutSmoke,
    mlm_notifications: notificationsWithoutSmoke,
    mlm_otp_records: otpWithoutSmoke
  };

  const missingAfter = computeUsersMissingWallet(updatedState.mlm_users, updatedState.mlm_wallets);

  return {
    updatedState,
    summary: {
      smokeCodes: Array.from(smokeCodesSet),
      smokeUsersRemoved: smokeUsers.map((user) => ({
        userCode: normalizeRef(user?.userId),
        fullName: String(user?.fullName || ''),
        internalId: normalizeRef(user?.id)
      })),
      removedCounts: {
        users: originalUsers.length - usersWithoutSmoke.length,
        wallets: (Array.isArray(state.mlm_wallets) ? state.mlm_wallets.length : 0) - walletsWithoutSmoke.length + addedWallets.length,
        matrix: (Array.isArray(state.mlm_matrix) ? state.mlm_matrix.length : 0) - matrixWithoutSmoke.length,
        transactions: (Array.isArray(state.mlm_transactions) ? state.mlm_transactions.length : 0) - transactionsWithoutSmoke.length,
        pins: (Array.isArray(state.mlm_pins) ? state.mlm_pins.length : 0) - pinsWithoutSmoke.length,
        pinTransfers: (Array.isArray(state.mlm_pin_transfers) ? state.mlm_pin_transfers.length : 0) - pinTransfersWithoutSmoke.length,
        pinRequests: (Array.isArray(state.mlm_pin_purchase_requests) ? state.mlm_pin_purchase_requests.length : 0) - pinRequestsWithoutSmoke.length,
        notifications: (Array.isArray(state.mlm_notifications) ? state.mlm_notifications.length : 0) - notificationsWithoutSmoke.length,
        otpRecords: (Array.isArray(state.mlm_otp_records) ? state.mlm_otp_records.length : 0) - otpWithoutSmoke.length
      },
      walletsAddedForMissingUsers: addedWallets,
      usersMissingWalletAfter: missingAfter.map((user) => ({
        userCode: normalizeRef(user?.userId),
        fullName: String(user?.fullName || ''),
        internalId: normalizeRef(user?.id)
      }))
    }
  };
}

function buildChangedStateKeys(originalState, updatedState) {
  const changed = [];
  for (const key of STATE_KEYS_TO_LOAD) {
    const before = JSON.stringify(originalState[key] || []);
    const after = JSON.stringify(updatedState[key] || []);
    if (before !== after) {
      changed.push(key);
    }
  }
  return changed;
}

async function writeState(conn, state, keys) {
  const now = toMySqlDateTime(new Date().toISOString());

  for (const key of keys) {
    await conn.execute(
      `INSERT INTO state_store (state_key, state_value, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
      [key, JSON.stringify(state[key] || []), now]
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'legacy-wallet-smoke-cleanup-report.json');
  const summaryPath = path.join(evidenceDir, 'legacy-wallet-smoke-cleanup-summary.txt');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const originalState = await loadState(conn);
    const originalUsersMissingWallet = computeUsersMissingWallet(originalState.mlm_users, originalState.mlm_wallets);

    const { updatedState, summary } = buildUpdatedState(cloneState(originalState), args.smokeUserCodes);
    const changedKeys = buildChangedStateKeys(originalState, updatedState);

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      smokeUserCodes: args.smokeUserCodes,
      originalUsersMissingWalletCount: originalUsersMissingWallet.length,
      changedStateKeys: changedKeys,
      ...summary
    };

    if (args.apply && changedKeys.length > 0) {
      await conn.beginTransaction();
      try {
        await loadState(conn, { forUpdate: true });
        await writeState(conn, updatedState, changedKeys);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    }

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const summaryLines = [
      `GeneratedAt: ${report.generatedAt}`,
      `Mode: ${report.mode}`,
      `SmokeUserCodes: ${args.smokeUserCodes.join(',')}`,
      `OriginalUsersMissingWalletCount: ${report.originalUsersMissingWalletCount}`,
      `RemovedSmokeUsers: ${report.smokeUsersRemoved.length}`,
      `WalletsAddedForMissingUsers: ${report.walletsAddedForMissingUsers.length}`,
      `UsersMissingWalletAfter: ${report.usersMissingWalletAfter.length}`,
      `ChangedStateKeys: ${changedKeys.length > 0 ? changedKeys.join(',') : 'none'}`,
      `Report: ${reportPath}`
    ];

    fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');

    console.log('--- Legacy Wallet Gap + Smoke Cleanup ---');
    summaryLines.forEach((line) => console.log(line));

    if (!args.apply && (report.smokeUsersRemoved.length > 0 || report.walletsAddedForMissingUsers.length > 0 || report.usersMissingWalletAfter.length > 0)) {
      process.exit(2);
    }

    if (args.apply && report.usersMissingWalletAfter.length > 0) {
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
