#!/usr/bin/env node

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readArg(name, fallback = '') {
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || fallback).trim();
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizeUserCode(value) {
  const normalized = String(value || '').trim();
  return /^\d{7}$/.test(normalized) ? normalized : '';
}

function parsePositiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100) / 100;
}

function extractUserCodeFromDescription(text) {
  const match = String(text || '').match(/\((\d{7})\)/);
  return match ? String(match[1]) : '';
}

function resolveUserByAnyRef(users, ref) {
  const key = String(ref || '').trim();
  if (!key) return null;
  return users.find((u) => String(u?.id || '') === key || String(u?.userId || '') === key) || null;
}

function txLevel(tx) {
  if (tx?.level != null && Number.isFinite(Number(tx.level))) {
    return Number(tx.level);
  }
  const match = String(tx?.description || '').match(/level\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function findMostCommonPositiveAmount(transactions, matcher, fallback) {
  const counts = new Map();
  for (const tx of transactions) {
    if (!matcher(tx)) continue;
    const amount = Number(tx?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = Math.round(amount * 100) / 100;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return fallback;

  let bestAmount = fallback;
  let bestCount = -1;
  for (const [amount, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      bestAmount = amount;
    }
  }
  return bestAmount;
}

function hasActivationEvidence(member, transactions, matrix) {
  if (!member) return false;
  const refs = new Set([String(member.id || ''), String(member.userId || '')]);
  const activationSeen = (transactions || []).some((tx) => {
    const status = String(tx?.status || '').toLowerCase();
    const type = String(tx?.type || '').toLowerCase();
    if (status !== 'completed') return false;
    if (type !== 'pin_used' && type !== 'activation') return false;
    return refs.has(String(tx?.userId || '').trim());
  });
  if (activationSeen) return true;

  const memberCode = String(member.userId || '').trim();
  return (matrix || []).some((node) => String(node?.userId || '').trim() === memberCode);
}

function ensureWalletForUser(wallets, user) {
  const userId = String(user?.id || '').trim();
  const userCode = String(user?.userId || '').trim();
  let wallet = (wallets || []).find((w) => String(w?.userId || '') === userId || String(w?.userId || '') === userCode) || null;
  if (!wallet) {
    wallet = {
      userId,
      depositWallet: 0,
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
    };
    wallets.push(wallet);
  }
  return wallet;
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/credit-missing-referral-help.cjs --sponsor 2963494 --member 1132870');
  console.log('  node scripts/credit-missing-referral-help.cjs --sponsor 2963494 --member 1132870 --apply');
  console.log('  node scripts/credit-missing-referral-help.cjs --sponsor 2963494 --member 1132870 --apply --referral-amount 5 --help-amount 5');
  console.log('');
  console.log('Notes:');
  console.log('  - Dry run by default. Use --apply to persist changes.');
  console.log('  - Updates only legacy state_store keys: mlm_transactions and mlm_wallets.');
  console.log('  - Idempotent by semantic checks (will not duplicate existing referral/help records).');
  process.exit(1);
}

async function main() {
  const sponsorUserCode = normalizeUserCode(readArg('--sponsor', ''));
  const memberUserCode = normalizeUserCode(readArg('--member', ''));
  const apply = hasFlag('--apply');

  if (!sponsorUserCode || !memberUserCode) {
    usageAndExit();
  }

  const requestedReferralAmount = parsePositiveAmount(readArg('--referral-amount', ''));
  const requestedHelpAmount = parsePositiveAmount(readArg('--help-amount', ''));

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  const result = {
    sponsorUserCode,
    memberUserCode,
    dryRun: !apply,
    referralAdded: false,
    helpAdded: false,
    referralAmount: 0,
    helpAmount: 0,
    referralTxId: null,
    helpTxId: null,
    warnings: []
  };

  const connection = await pool.getConnection();
  let txOpen = false;

  try {
    await connection.beginTransaction();
    txOpen = true;

    const [rows] = await connection.execute(
      `SELECT state_key, state_value
       FROM state_store
       WHERE state_key IN ('mlm_users', 'mlm_wallets', 'mlm_transactions', 'mlm_matrix')
       FOR UPDATE`
    );

    const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row?.state_key || ''), row?.state_value]));
    const users = parseJson(byKey.get('mlm_users'), []);
    const wallets = parseJson(byKey.get('mlm_wallets'), []);
    const transactions = parseJson(byKey.get('mlm_transactions'), []);
    const matrix = parseJson(byKey.get('mlm_matrix'), []);

    const sponsor = resolveUserByAnyRef(users, sponsorUserCode);
    const member = resolveUserByAnyRef(users, memberUserCode);

    if (!sponsor) {
      throw new Error(`Sponsor not found in mlm_users: ${sponsorUserCode}`);
    }
    if (!member) {
      throw new Error(`Member not found in mlm_users: ${memberUserCode}`);
    }

    const memberSponsorCode = normalizeUserCode(String(member?.sponsorId || member?.referredBy || ''));
    if (memberSponsorCode !== normalizeUserCode(sponsor.userId)) {
      throw new Error(
        `Member ${memberUserCode} is not sponsored by ${sponsorUserCode} (detected sponsor: ${memberSponsorCode || 'none'})`
      );
    }

    if (!hasActivationEvidence(member, transactions, matrix)) {
      throw new Error(`Member ${memberUserCode} has no activation/matrix join evidence; refusing to credit.`);
    }

    const referralAmount = Number.isFinite(requestedReferralAmount)
      ? requestedReferralAmount
      : findMostCommonPositiveAmount(
        transactions,
        (tx) => String(tx?.type || '').toLowerCase() === 'direct_income' && String(tx?.status || '').toLowerCase() === 'completed',
        5
      );

    const helpAmount = Number.isFinite(requestedHelpAmount)
      ? requestedHelpAmount
      : findMostCommonPositiveAmount(
        transactions,
        (tx) => {
          if (String(tx?.type || '').toLowerCase() !== 'receive_help') return false;
          if (String(tx?.status || '').toLowerCase() !== 'completed') return false;
          return txLevel(tx) === 1;
        },
        referralAmount
      );

    result.referralAmount = referralAmount;
    result.helpAmount = helpAmount;

    const sponsorRefs = new Set([String(sponsor.id || ''), String(sponsor.userId || '')]);
    const memberRefs = new Set([String(member.id || ''), String(member.userId || '')]);

    const referralExists = transactions.some((tx) => {
      if (String(tx?.status || '').toLowerCase() !== 'completed') return false;
      const type = String(tx?.type || '').toLowerCase();
      if (!(type === 'direct_income' || type === 'referral_income' || type === 'sponsor_income')) return false;
      if (!sponsorRefs.has(String(tx?.userId || '').trim())) return false;

      const fromRef = String(tx?.fromUserId || '').trim();
      if (fromRef && memberRefs.has(fromRef)) return true;

      const fromCodeInDesc = extractUserCodeFromDescription(tx?.description);
      return !!fromCodeInDesc && fromCodeInDesc === String(member.userId || '');
    });

    const helpExists = transactions.some((tx) => {
      if (String(tx?.status || '').toLowerCase() !== 'completed') return false;
      if (String(tx?.type || '').toLowerCase() !== 'receive_help') return false;
      if (!sponsorRefs.has(String(tx?.userId || '').trim())) return false;
      if (txLevel(tx) !== 1) return false;

      const fromRef = String(tx?.fromUserId || '').trim();
      if (fromRef && memberRefs.has(fromRef)) return true;

      const fromCodeInDesc = extractUserCodeFromDescription(tx?.description);
      return !!fromCodeInDesc && fromCodeInDesc === String(member.userId || '');
    });

    const sponsorWallet = ensureWalletForUser(wallets, sponsor);
    const nowIso = new Date().toISOString();
    const baseTs = Date.now();

    if (!referralExists) {
      const referralTxId = `tx_${baseTs}_fix_ref_${member.userId}_${sponsor.userId}`;
      transactions.push({
        id: referralTxId,
        userId: String(sponsor.id || ''),
        type: 'direct_income',
        amount: referralAmount,
        fromUserId: String(member.id || ''),
        status: 'completed',
        description: `Referral income correction from ${String(member.fullName || 'Member').trim()} (${member.userId})`,
        createdAt: String(member.activatedAt || member.createdAt || nowIso),
        completedAt: nowIso
      });
      sponsorWallet.incomeWallet = Number(sponsorWallet.incomeWallet || 0) + referralAmount;
      sponsorWallet.totalReceived = Number(sponsorWallet.totalReceived || 0) + referralAmount;
      result.referralAdded = true;
      result.referralTxId = referralTxId;
    }

    if (!helpExists) {
      const helpTxId = `tx_${baseTs + 1}_fix_help_l1_${member.userId}_${sponsor.userId}`;
      transactions.push({
        id: helpTxId,
        userId: String(sponsor.id || ''),
        type: 'receive_help',
        amount: helpAmount,
        fromUserId: String(member.id || ''),
        level: 1,
        status: 'completed',
        description: `Locked first-two help correction at level 1 from ${String(member.fullName || 'Member').trim()} (${member.userId})`,
        createdAt: String(member.activatedAt || member.createdAt || nowIso),
        completedAt: nowIso
      });
      sponsorWallet.lockedIncomeWallet = Number(sponsorWallet.lockedIncomeWallet || 0) + helpAmount;
      sponsorWallet.totalReceived = Number(sponsorWallet.totalReceived || 0) + helpAmount;
      result.helpAdded = true;
      result.helpTxId = helpTxId;
    }

    if (!result.referralAdded) {
      result.warnings.push('Referral credit already exists for this sponsor/member pair.');
    }
    if (!result.helpAdded) {
      result.warnings.push('Level-1 help credit already exists for this sponsor/member pair.');
    }

    if (apply && (result.referralAdded || result.helpAdded)) {
      await connection.execute(
        `UPDATE state_store
         SET state_value = ?, updated_at = NOW(3)
         WHERE state_key = 'mlm_transactions'`,
        [JSON.stringify(transactions)]
      );

      await connection.execute(
        `UPDATE state_store
         SET state_value = ?, updated_at = NOW(3)
         WHERE state_key = 'mlm_wallets'`,
        [JSON.stringify(wallets)]
      );
    }

    if (apply) {
      await connection.commit();
    } else {
      await connection.rollback();
    }
    txOpen = false;

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (txOpen) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback failure
      }
    }
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
