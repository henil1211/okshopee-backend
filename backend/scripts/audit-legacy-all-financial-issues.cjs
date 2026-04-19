#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readArg(name, fallback = '') {
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

function normalizeUserCode(value) {
  const normalized = String(value || '').trim();
  return /^\d{7}$/.test(normalized) ? normalized : '';
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function txTime(tx) {
  const ts = new Date(tx?.completedAt || tx?.createdAt || '').getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function txLevel(tx) {
  if (tx?.level !== undefined && tx?.level !== null && Number.isFinite(Number(tx.level))) {
    return Number(tx.level);
  }
  const match = String(tx?.description || '').match(/level\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function toIso(value) {
  const ts = new Date(value || '').getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/audit-legacy-all-financial-issues.cjs');
  console.log('  node scripts/audit-legacy-all-financial-issues.cjs --users 6709222,7958187 --limit 500');
  console.log('  node scripts/audit-legacy-all-financial-issues.cjs --host 127.0.0.1 --user root --password "***" --database okshopee24 --json');
  console.log('  node scripts/audit-legacy-all-financial-issues.cjs --state-file data/app-state.local.json --json');
  process.exit(1);
}

function buildUserIndexes(users) {
  const byInternalId = new Map();
  const byUserCode = new Map();

  for (const user of users || []) {
    const internalId = String(user?.id || '').trim();
    const userCode = String(user?.userId || '').trim();
    if (internalId) byInternalId.set(internalId, user);
    if (userCode) byUserCode.set(userCode, user);
  }

  return { byInternalId, byUserCode };
}

function resolveUserByRef(ref, userIndex) {
  const key = String(ref || '').trim();
  if (!key) return null;
  return userIndex.byInternalId.get(key) || userIndex.byUserCode.get(key) || null;
}

function userCodeOfRef(ref, userIndex) {
  const resolved = resolveUserByRef(ref, userIndex);
  if (resolved?.userId) return String(resolved.userId);
  const maybeUserCode = String(ref || '').trim();
  if (/^\d{7}$/.test(maybeUserCode)) return maybeUserCode;
  return '';
}

function buildMatrixIndex(matrix) {
  const byUserCode = new Map();
  for (const node of matrix || []) {
    const userCode = String(node?.userId || '').trim();
    if (!/^\d{7}$/.test(userCode)) continue;
    if (!byUserCode.has(userCode)) {
      byUserCode.set(userCode, {
        userCode,
        parentId: String(node?.parentId || '').trim(),
        level: Number(node?.level || 0),
        position: node?.position
      });
    }
  }
  return byUserCode;
}

function hasActivationEvidence(user, transactions) {
  if (!user) return false;
  const refs = new Set([String(user.id || '').trim(), String(user.userId || '').trim()]);
  return (transactions || []).some((tx) => {
    if (String(tx?.status || '').toLowerCase() !== 'completed') return false;
    if (!(String(tx?.type || '').toLowerCase() === 'pin_used' || String(tx?.type || '').toLowerCase() === 'activation')) {
      return false;
    }
    return refs.has(String(tx?.userId || '').trim());
  });
}

function extractUserCodeFromDescription(text) {
  const match = String(text || '').match(/\((\d{7})\)/);
  return match ? String(match[1]) : '';
}

function isTransferLike(tx) {
  const type = String(tx?.type || '').toLowerCase();
  const desc = String(tx?.description || '').toLowerCase();
  if (type === 'p2p_transfer' || type === 'income_transfer' || type === 'fund_transfer' || type === 'royalty_transfer') {
    return true;
  }
  return desc.includes('transfer');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function readStateFromFile(stateFilePath) {
  const absolutePath = path.resolve(process.cwd(), stateFilePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`State file not found: ${absolutePath}`);
  }

  const payload = parseJson(fs.readFileSync(absolutePath, 'utf8'), {});
  const state = payload && typeof payload === 'object' && payload.state && typeof payload.state === 'object'
    ? payload.state
    : payload;

  return {
    source: `file:${absolutePath}`,
    users: parseJson(state.mlm_users, []),
    transactions: parseJson(state.mlm_transactions, []),
    wallets: parseJson(state.mlm_wallets, []),
    matrix: parseJson(state.mlm_matrix, []),
    pins: parseJson(state.mlm_pins, [])
  };
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    usageAndExit();
  }

  const dbHost = readArg('--host', process.env.MYSQL_HOST || '127.0.0.1');
  const dbPortRaw = Number(readArg('--port', process.env.MYSQL_PORT || '3306'));
  const dbPort = Number.isFinite(dbPortRaw) ? dbPortRaw : 3306;
  const dbUser = readArg('--user', process.env.MYSQL_USER || 'root');
  const dbPassword = readArg('--password', process.env.MYSQL_PASSWORD || '');
  const dbName = readArg('--database', process.env.MYSQL_DATABASE || 'okshopee24');
  const stateFile = readArg('--state-file', '');
  const label = readArg('--label', 'legacy-all-financial-issues-audit');
  const limitRaw = Number(readArg('--limit', '500'));
  const limit = Number.isFinite(limitRaw) ? Math.max(50, Math.min(5000, Math.trunc(limitRaw))) : 500;
  const jsonOnly = hasFlag('--json');

  const usersArg = readArg('--users', '');
  const scopedUsers = usersArg
    .split(',')
    .map((v) => normalizeUserCode(v))
    .filter(Boolean);
  const scopedSet = new Set(scopedUsers);

  const inScope = (...codes) => {
    if (scopedSet.size === 0) return true;
    return codes.some((code) => scopedSet.has(String(code || '').trim()));
  };

  let dataSource = '';
  let users = [];
  let transactions = [];
  let wallets = [];
  let matrix = [];
  let pins = [];
  let pool = null;

  try {
    if (stateFile) {
      const stateData = readStateFromFile(stateFile);
      dataSource = stateData.source;
      users = stateData.users;
      transactions = stateData.transactions;
      wallets = stateData.wallets;
      matrix = stateData.matrix;
      pins = stateData.pins;
    } else {
      pool = mysql.createPool({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPassword,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 5,
        charset: 'utf8mb4'
      });

      const [stateRows] = await pool.query(
        `SELECT state_key, state_value
         FROM state_store
         WHERE state_key IN ('mlm_users', 'mlm_transactions', 'mlm_wallets', 'mlm_matrix', 'mlm_pins')`
      );

      const byKey = new Map((Array.isArray(stateRows) ? stateRows : []).map((row) => [String(row.state_key || ''), row.state_value]));

      users = parseJson(byKey.get('mlm_users'), []);
      transactions = parseJson(byKey.get('mlm_transactions'), []);
      wallets = parseJson(byKey.get('mlm_wallets'), []);
      matrix = parseJson(byKey.get('mlm_matrix'), []);
      pins = parseJson(byKey.get('mlm_pins'), []);
      dataSource = `mysql:${dbName}`;
    }

    const userIndex = buildUserIndexes(users);
    const matrixByUserCode = buildMatrixIndex(matrix);

    const duplicateReferralIncome = [];
    const missingReferralIncome = [];
    const duplicateHelpReceived = [];
    const ghostHelpReceived = [];
    const missingHelpLevel1 = [];
    const transferCreditWithoutDebit = [];
    const transferDebitWithoutCredit = [];
    const giveHelpWithoutJoinedUser = [];
    const giveHelpFromMissingUser = [];

    const referralGroups = new Map();
    const referralPairSet = new Set();
    const helpReceiveGroups = new Map();
    const helpLevel1Set = new Set();

    const completedTransactions = transactions.filter((tx) => String(tx?.status || '').toLowerCase() === 'completed');

    for (const tx of completedTransactions) {
      const type = String(tx?.type || '').toLowerCase();
      const amount = Number(tx?.amount || 0);

      if ((type === 'direct_income' || type === 'referral_income' || type === 'sponsor_income') && amount > 0) {
        const recipientCode = userCodeOfRef(tx.userId, userIndex);
        const sourceCodeFromRef = userCodeOfRef(tx.fromUserId, userIndex);
        const sourceCodeFromDesc = extractUserCodeFromDescription(tx.description);
        const sourceCode = sourceCodeFromRef || sourceCodeFromDesc;
        if (!recipientCode || !sourceCode) continue;

        referralPairSet.add(`${recipientCode}__${sourceCode}`);

        const key = `${recipientCode}__${sourceCode}__${Math.abs(amount).toFixed(2)}`;
        if (!referralGroups.has(key)) referralGroups.set(key, []);
        referralGroups.get(key).push(tx);
      }

      if (type === 'receive_help' && amount > 0) {
        const beneficiaryCode = userCodeOfRef(tx.userId, userIndex);
        const sourceCode = userCodeOfRef(tx.fromUserId, userIndex);
        const levelNo = txLevel(tx);

        if (!beneficiaryCode) continue;

        if (!sourceCode) {
          if (inScope(beneficiaryCode)) {
            ghostHelpReceived.push({
              txId: String(tx.id || ''),
              beneficiaryUserCode: beneficiaryCode,
              sourceRef: String(tx.fromUserId || ''),
              amount,
              levelNo,
              createdAt: toIso(tx.createdAt),
              description: String(tx.description || '')
            });
          }
          continue;
        }

        if (levelNo === 1) {
          helpLevel1Set.add(`${sourceCode}__${beneficiaryCode}`);
        }

        const key = `${beneficiaryCode}__${sourceCode}__L${levelNo}__${Math.abs(amount).toFixed(2)}`;
        if (!helpReceiveGroups.has(key)) helpReceiveGroups.set(key, []);
        helpReceiveGroups.get(key).push(tx);
      }
    }

    for (const [key, txs] of referralGroups.entries()) {
      if (txs.length <= 1) continue;
      txs.sort((a, b) => txTime(a) - txTime(b));
      const [recipientCode, sourceCode] = key.split('__');
      if (!inScope(recipientCode, sourceCode)) continue;

      duplicateReferralIncome.push({
        recipientUserCode: recipientCode,
        sourceUserCode: sourceCode,
        count: txs.length,
        txIds: txs.map((tx) => String(tx.id || '')),
        amountEach: Math.abs(Number(txs[0]?.amount || 0))
      });
    }

    for (const [key, txs] of helpReceiveGroups.entries()) {
      if (txs.length <= 1) continue;
      txs.sort((a, b) => txTime(a) - txTime(b));
      const parts = key.split('__');
      const beneficiaryCode = parts[0];
      const sourceCode = parts[1];
      if (!inScope(beneficiaryCode, sourceCode)) continue;

      duplicateHelpReceived.push({
        beneficiaryUserCode: beneficiaryCode,
        sourceUserCode: sourceCode,
        levelTag: parts[2],
        count: txs.length,
        txIds: txs.map((tx) => String(tx.id || '')),
        amountEach: Math.abs(Number(txs[0]?.amount || 0))
      });
    }

    for (const user of users) {
      const userCode = String(user?.userId || '').trim();
      if (!/^\d{7}$/.test(userCode)) continue;
      if (!inScope(userCode)) continue;

      const joined = hasActivationEvidence(user, completedTransactions) || matrixByUserCode.has(userCode);
      if (!joined) continue;

      const sponsorRef = String(user?.sponsorId || user?.referredBy || '').trim();
      const sponsor = resolveUserByRef(sponsorRef, userIndex);
      const sponsorCode = String(sponsor?.userId || '').trim();
      if (sponsorCode && /^\d{7}$/.test(sponsorCode)) {
        const pairKey = `${sponsorCode}__${userCode}`;
        if (!referralPairSet.has(pairKey) && inScope(sponsorCode, userCode)) {
          missingReferralIncome.push({
            joinedUserCode: userCode,
            sponsorUserCode: sponsorCode,
            joinedUserName: String(user?.fullName || ''),
            sponsorName: String(sponsor?.fullName || ''),
            createdAt: toIso(user?.createdAt)
          });
        }
      }

      const node = matrixByUserCode.get(userCode);
      const parentRef = String(node?.parentId || '').trim();
      const parent = resolveUserByRef(parentRef, userIndex);
      const parentCode = String(parent?.userId || '').trim();
      if (parentCode && /^\d{7}$/.test(parentCode)) {
        if (!helpLevel1Set.has(`${userCode}__${parentCode}`) && inScope(userCode, parentCode)) {
          missingHelpLevel1.push({
            sourceUserCode: userCode,
            beneficiaryUserCode: parentCode,
            sourceUserName: String(user?.fullName || ''),
            beneficiaryName: String(parent?.fullName || ''),
            createdAt: toIso(user?.createdAt)
          });
        }
      }
    }

    const transferCredits = completedTransactions.filter((tx) => Number(tx?.amount || 0) > 0 && isTransferLike(tx));
    const transferDebits = completedTransactions.filter((tx) => Number(tx?.amount || 0) < 0 && isTransferLike(tx));

    for (const creditTx of transferCredits) {
      const senderCode = userCodeOfRef(creditTx.fromUserId, userIndex);
      const receiverCode = userCodeOfRef(creditTx.userId, userIndex);
      if (!receiverCode) continue;
      if (!inScope(senderCode, receiverCode)) continue;

      if (!senderCode) {
        transferCreditWithoutDebit.push({
          creditTxId: String(creditTx.id || ''),
          receiverUserCode: receiverCode,
          senderUserCode: '',
          amount: Number(creditTx.amount || 0),
          reason: 'credit_transfer_missing_sender',
          createdAt: toIso(creditTx.createdAt),
          description: String(creditTx.description || '')
        });
        continue;
      }

      const targetAmount = Math.abs(Number(creditTx.amount || 0));
      const creditTs = txTime(creditTx);

      const matchedDebit = transferDebits.find((debitTx) => {
        const debitSenderCode = userCodeOfRef(debitTx.userId, userIndex);
        if (debitSenderCode !== senderCode) return false;

        const debitAmount = Math.abs(Number(debitTx.amount || 0));
        if (Math.abs(debitAmount - targetAmount) > 0.0001) return false;

        const debitTs = txTime(debitTx);
        if (Math.abs(debitTs - creditTs) > 10 * 60 * 1000) return false;

        const debitReceiverCode = userCodeOfRef(debitTx.toUserId, userIndex);
        if (debitReceiverCode && receiverCode && debitReceiverCode !== receiverCode) return false;

        return true;
      });

      if (!matchedDebit) {
        transferCreditWithoutDebit.push({
          creditTxId: String(creditTx.id || ''),
          receiverUserCode: receiverCode,
          senderUserCode: senderCode,
          amount: Number(creditTx.amount || 0),
          reason: 'credit_transfer_without_matching_debit',
          createdAt: toIso(creditTx.createdAt),
          description: String(creditTx.description || '')
        });
      }
    }

    for (const debitTx of transferDebits) {
      const senderCode = userCodeOfRef(debitTx.userId, userIndex);
      const receiverCode = userCodeOfRef(debitTx.toUserId, userIndex);
      if (!senderCode) continue;
      if (!inScope(senderCode, receiverCode)) continue;

      const targetAmount = Math.abs(Number(debitTx.amount || 0));
      const debitTs = txTime(debitTx);

      const matchedCredit = transferCredits.find((creditTx) => {
        const creditSenderCode = userCodeOfRef(creditTx.fromUserId, userIndex);
        if (creditSenderCode && creditSenderCode !== senderCode) return false;

        const creditReceiverCode = userCodeOfRef(creditTx.userId, userIndex);
        if (receiverCode && creditReceiverCode && receiverCode !== creditReceiverCode) return false;

        const creditAmount = Math.abs(Number(creditTx.amount || 0));
        if (Math.abs(creditAmount - targetAmount) > 0.0001) return false;

        const creditTs = txTime(creditTx);
        if (Math.abs(creditTs - debitTs) > 10 * 60 * 1000) return false;

        return true;
      });

      if (!matchedCredit) {
        transferDebitWithoutCredit.push({
          debitTxId: String(debitTx.id || ''),
          senderUserCode: senderCode,
          receiverUserCode: receiverCode,
          amount: Math.abs(Number(debitTx.amount || 0)),
          reason: 'debit_transfer_without_matching_credit',
          createdAt: toIso(debitTx.createdAt),
          description: String(debitTx.description || '')
        });
      }
    }

    for (const tx of completedTransactions) {
      const type = String(tx?.type || '').toLowerCase();
      const amount = Number(tx?.amount || 0);
      if (type !== 'give_help' || !(amount < 0)) continue;

      const giver = resolveUserByRef(tx.userId, userIndex);
      const giverCode = String(giver?.userId || '').trim();
      const levelNo = txLevel(tx);

      if (!giver) {
        const recipientCode = userCodeOfRef(tx.toUserId, userIndex);
        if (inScope(recipientCode)) {
          giveHelpFromMissingUser.push({
            txId: String(tx.id || ''),
            giverRef: String(tx.userId || ''),
            beneficiaryUserCode: recipientCode,
            amount,
            levelNo,
            createdAt: toIso(tx.createdAt),
            description: String(tx.description || '')
          });
        }
        continue;
      }

      if (!inScope(giverCode, userCodeOfRef(tx.toUserId, userIndex))) continue;

      const joined = hasActivationEvidence(giver, completedTransactions) || matrixByUserCode.has(giverCode);
      if (!joined) {
        giveHelpWithoutJoinedUser.push({
          txId: String(tx.id || ''),
          giverUserCode: giverCode,
          giverName: String(giver.fullName || ''),
          beneficiaryUserCode: userCodeOfRef(tx.toUserId, userIndex),
          amount,
          levelNo,
          createdAt: toIso(tx.createdAt),
          description: String(tx.description || '')
        });
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      scope: {
        usersFilter: scopedUsers,
        limit,
        dataSource,
        usersScanned: Array.isArray(users) ? users.length : 0,
        transactionsScanned: Array.isArray(transactions) ? transactions.length : 0,
        walletsScanned: Array.isArray(wallets) ? wallets.length : 0,
        matrixNodesScanned: Array.isArray(matrix) ? matrix.length : 0,
        pinsScanned: Array.isArray(pins) ? pins.length : 0
      },
      summary: {
        duplicateReferralIncomeCount: duplicateReferralIncome.length,
        missingReferralIncomeCount: missingReferralIncome.length,
        duplicateHelpReceivedCount: duplicateHelpReceived.length,
        ghostHelpReceivedCount: ghostHelpReceived.length,
        missingHelpLevel1Count: missingHelpLevel1.length,
        transferCreditWithoutDebitCount: transferCreditWithoutDebit.length,
        transferDebitWithoutCreditCount: transferDebitWithoutCredit.length,
        giveHelpWithoutJoinedUserCount: giveHelpWithoutJoinedUser.length,
        giveHelpFromMissingUserCount: giveHelpFromMissingUser.length
      },
      findings: {
        duplicateReferralIncome: duplicateReferralIncome.slice(0, limit),
        missingReferralIncome: missingReferralIncome.slice(0, limit),
        duplicateHelpReceived: duplicateHelpReceived.slice(0, limit),
        ghostHelpReceived: ghostHelpReceived.slice(0, limit),
        missingHelpLevel1: missingHelpLevel1.slice(0, limit),
        transferCreditWithoutDebit: transferCreditWithoutDebit.slice(0, limit),
        transferDebitWithoutCredit: transferDebitWithoutCredit.slice(0, limit),
        giveHelpWithoutJoinedUser: giveHelpWithoutJoinedUser.slice(0, limit),
        giveHelpFromMissingUser: giveHelpFromMissingUser.slice(0, limit)
      }
    };

    const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${label}`);
    fs.mkdirSync(evidenceDir, { recursive: true });
    const reportPath = path.join(evidenceDir, 'legacy-all-financial-issues-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    if (jsonOnly) {
      console.log(JSON.stringify({ reportPath, summary: report.summary }));
    } else {
      console.log('--- Legacy All Financial Issues Audit ---');
      console.log(`Report: ${reportPath}`);
      console.log(`Data source: ${dataSource}`);
      console.log(JSON.stringify(report.summary, null, 2));
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
