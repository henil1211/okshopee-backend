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

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function txTime(tx) {
  const ts = new Date(tx?.completedAt || tx?.createdAt || '').getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function resolveLevel(tx) {
  if (tx?.level !== undefined && tx?.level !== null && Number.isFinite(Number(tx.level))) {
    return Number(tx.level);
  }
  const m = String(tx?.description || '').match(/level\s+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function appendReason(description, reason) {
  const text = String(description || '');
  if (text.includes(`[REVERSED: ${reason}]`)) return text;
  return `${text} [REVERSED: ${reason}]`;
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/repair-legacy-help-overcredit-by-users.cjs --users 6709222 --host 127.0.0.1 --user root --password "***" --database okshopee24 --dry-run');
  console.log('  node scripts/repair-legacy-help-overcredit-by-users.cjs --users 6709222,7958187 --dry-run');
  console.log('  node scripts/repair-legacy-help-overcredit-by-users.cjs --users 6709222,7958187 --apply');
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

function resolveUserByRef(ref, userIndexes) {
  const key = String(ref || '').trim();
  if (!key) return null;
  return userIndexes.byInternalId.get(key) || userIndexes.byUserCode.get(key) || null;
}

function buildWalletIndex(wallets) {
  const byRef = new Map();
  for (const wallet of wallets || []) {
    const ref = String(wallet?.userId || '').trim();
    if (ref && !byRef.has(ref)) byRef.set(ref, wallet);
  }
  return byRef;
}

function resolveWalletForUser(user, walletIndex) {
  if (!user) return null;
  const internalId = String(user.id || '').trim();
  const userCode = String(user.userId || '').trim();
  return walletIndex.get(internalId) || walletIndex.get(userCode) || null;
}

function isCompletedReceiveHelp(tx) {
  return String(tx?.type || '').toLowerCase() === 'receive_help'
    && String(tx?.status || '').toLowerCase() === 'completed'
    && Number(tx?.amount || 0) > 0;
}

function isCompletedLockedGiveHelp(tx) {
  return String(tx?.type || '').toLowerCase() === 'give_help'
    && String(tx?.status || '').toLowerCase() === 'completed'
    && Number(tx?.amount || 0) < 0
    && String(tx?.description || '').toLowerCase().includes('from locked income');
}

function adjustWalletForReversedReceive(wallet, amount) {
  if (!wallet) return;
  const amt = Math.abs(Number(amount || 0));
  wallet.incomeWallet = Number(wallet.incomeWallet || 0) - amt;
  wallet.totalReceived = Number(wallet.totalReceived || 0) - amt;
  if (wallet.incomeWallet < 0) {
    wallet.fundRecoveryDue = Number(wallet.fundRecoveryDue || 0) + Math.abs(wallet.incomeWallet);
    wallet.incomeWallet = 0;
  }
}

function adjustWalletForReversedGive(wallet, amount) {
  if (!wallet) return;
  const amt = Math.abs(Number(amount || 0));
  wallet.giveHelpLocked = Number(wallet.giveHelpLocked || 0) + amt;
  wallet.totalGiven = Number(wallet.totalGiven || 0) - amt;
}

async function main() {
  const usersArg = readArg('--users', '');
  const apply = hasFlag('--apply');
  const dryRun = !apply || hasFlag('--dry-run');
  const dbHost = readArg('--host', process.env.MYSQL_HOST || '127.0.0.1');
  const dbPort = Number(readArg('--port', process.env.MYSQL_PORT || '3306'));
  const dbUser = readArg('--user', process.env.MYSQL_USER || 'root');
  const dbPassword = readArg('--password', process.env.MYSQL_PASSWORD || '');
  const dbName = readArg('--database', process.env.MYSQL_DATABASE || 'okshopee24');

  const userCodes = usersArg
    .split(',')
    .map((v) => normalizeUserCode(v))
    .filter(Boolean);

  if (userCodes.length === 0) {
    usageAndExit();
  }

  const pool = mysql.createPool({
    host: dbHost,
    port: Number.isFinite(dbPort) ? dbPort : 3306,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    waitForConnections: true,
    connectionLimit: 4
  });

  try {
    const [usersRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
    const [txsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_transactions'");
    const [walletsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");

    if (!usersRow.length || !txsRow.length || !walletsRow.length) {
      throw new Error('Missing required state_store rows: mlm_users/mlm_transactions/mlm_wallets');
    }

    const users = parseJsonArray(usersRow[0].state_value);
    const transactions = parseJsonArray(txsRow[0].state_value);
    const wallets = parseJsonArray(walletsRow[0].state_value);

    const userIndexes = buildUserIndexes(users);
    const walletIndex = buildWalletIndex(wallets);

    const targets = userCodes
      .map((code) => userIndexes.byUserCode.get(code))
      .filter(Boolean);

    if (targets.length === 0) {
      throw new Error('None of the provided user codes were found in mlm_users');
    }

    const summary = {
      mode: dryRun ? 'dry-run' : 'apply',
      requestedUsers: userCodes,
      foundUsers: targets.map((u) => ({ userCode: u.userId, fullName: u.fullName })),
      reversedGhostReceive: 0,
      reversedDuplicateReceive: 0,
      reversedExcessGive: 0,
      reversedLinkedUplineReceive: 0,
      changedTransactionIds: []
    };

    const markChanged = (tx, reason) => {
      tx.status = 'reversed';
      tx.description = appendReason(tx.description, reason);
      summary.changedTransactionIds.push(String(tx.id || ''));
    };

    for (const targetUser of targets) {
      const targetRefs = new Set([String(targetUser.id || '').trim(), String(targetUser.userId || '').trim()]);
      const targetWallet = resolveWalletForUser(targetUser, walletIndex);

      const isTargetTx = (tx) => targetRefs.has(String(tx?.userId || '').trim());

      // 1) Reverse ghost receive-help entries with missing sender.
      for (const tx of transactions) {
        if (!isTargetTx(tx) || !isCompletedReceiveHelp(tx)) continue;
        const sender = resolveUserByRef(tx.fromUserId, userIndexes);
        if (sender) continue;

        adjustWalletForReversedReceive(targetWallet, tx.amount);
        markChanged(tx, 'Ghost receive-help (missing sender record)');
        summary.reversedGhostReceive += 1;
      }

      // 2) Reverse duplicate receive-help entries for same sender+level+amount.
      const receiveGroups = new Map();
      for (const tx of transactions) {
        if (!isTargetTx(tx) || !isCompletedReceiveHelp(tx)) continue;
        const senderRef = String(tx.fromUserId || '').trim() || 'unknown';
        const levelNo = resolveLevel(tx);
        const amount = Math.abs(Number(tx.amount || 0)).toFixed(2);
        const groupKey = `${senderRef}__L${levelNo}__A${amount}`;
        if (!receiveGroups.has(groupKey)) receiveGroups.set(groupKey, []);
        receiveGroups.get(groupKey).push(tx);
      }

      for (const groupTxs of receiveGroups.values()) {
        groupTxs.sort((a, b) => txTime(a) - txTime(b));
        for (let i = 1; i < groupTxs.length; i += 1) {
          const tx = groupTxs[i];
          adjustWalletForReversedReceive(targetWallet, tx.amount);
          markChanged(tx, 'Duplicate receive-help credit');
          summary.reversedDuplicateReceive += 1;
        }
      }

      // 3) Reverse excess locked give-help created due to over-credited receive-help.
      const receiveByLevel = new Map();
      const giveByLevel = new Map();

      for (const tx of transactions) {
        if (!isTargetTx(tx)) continue;

        if (isCompletedReceiveHelp(tx)) {
          const levelNo = resolveLevel(tx);
          const amt = Math.abs(Number(tx.amount || 0));
          receiveByLevel.set(levelNo, Number(receiveByLevel.get(levelNo) || 0) + amt);
        }

        if (isCompletedLockedGiveHelp(tx)) {
          const levelNo = resolveLevel(tx);
          const list = giveByLevel.get(levelNo) || [];
          list.push(tx);
          giveByLevel.set(levelNo, list);
        }
      }

      for (const [levelNo, giveTxs] of giveByLevel.entries()) {
        const totalReceive = Number(receiveByLevel.get(levelNo) || 0);
        const maxAllowedGive = Math.floor(totalReceive / 10) * 10;
        const currentGive = giveTxs.reduce((sum, tx) => sum + Math.abs(Number(tx.amount || 0)), 0);

        let excess = currentGive - maxAllowedGive;
        if (excess <= 0) continue;

        // Reverse latest give-help first.
        giveTxs.sort((a, b) => txTime(b) - txTime(a));

        for (const giveTx of giveTxs) {
          if (excess <= 0) break;
          const giveAmount = Math.abs(Number(giveTx.amount || 0));

          adjustWalletForReversedGive(targetWallet, giveAmount);
          markChanged(giveTx, 'Excess give-help from over-credited receives');
          summary.reversedExcessGive += 1;
          excess -= giveAmount;

          // Reverse nearest linked upline receive-help.
          const giveTs = txTime(giveTx);
          const linkedCandidates = transactions
            .filter((tx) => isCompletedReceiveHelp(tx))
            .filter((tx) => {
              const fromRef = String(tx.fromUserId || '').trim();
              if (!targetRefs.has(fromRef)) return false;
              if (resolveLevel(tx) !== levelNo) return false;
              if (Math.abs(Number(tx.amount || 0)) !== giveAmount) return false;
              return true;
            })
            .map((tx) => ({ tx, diff: Math.abs(txTime(tx) - giveTs) }))
            .sort((a, b) => a.diff - b.diff);

          const linked = linkedCandidates.length > 0 ? linkedCandidates[0].tx : null;
          if (linked) {
            const beneficiary = resolveUserByRef(linked.userId, userIndexes);
            const beneficiaryWallet = resolveWalletForUser(beneficiary, walletIndex);
            adjustWalletForReversedReceive(beneficiaryWallet, linked.amount);
            markChanged(linked, `Linked to reversed give-help ${String(giveTx.id || '')}`);
            summary.reversedLinkedUplineReceive += 1;
          }
        }
      }
    }

    summary.changedTransactionIds = [...new Set(summary.changedTransactionIds)].filter(Boolean);

    if (!dryRun && summary.changedTransactionIds.length > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.resolve(__dirname, '..', 'data', 'backups');
      const backupPath = path.join(backupDir, `pre-repair-legacy-help-overcredit-${timestamp}.json`);
      fs.mkdirSync(backupDir, { recursive: true });

      fs.writeFileSync(
        backupPath,
        JSON.stringify({
          users,
          walletsBefore: parseJsonArray(walletsRow[0].state_value),
          transactionsBefore: parseJsonArray(txsRow[0].state_value),
          requestedUsers: userCodes
        }, null, 2),
        'utf8'
      );

      await pool.query(
        "UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'",
        [JSON.stringify(transactions)]
      );
      await pool.query(
        "UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'",
        [JSON.stringify(wallets)]
      );

      summary.backupPath = backupPath;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
