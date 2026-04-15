#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const ROUND_EPSILON = 0.009;
const MATCH_WINDOW_MS = 15 * 60 * 1000;
const LOCKED_SETTLEMENT_WINDOW_MS = 10 * 60 * 1000;
const MAX_LEVEL = 20;

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function parseJsonMaybe(value, fallback) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (Array.isArray(current)) return current;
    if (typeof current !== 'string') return fallback;
    try {
      current = JSON.parse(current);
    } catch {
      return fallback;
    }
  }

  if (Array.isArray(current)) return current;
  return fallback;
}

function loadState(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const state = raw.state || {};
  return {
    users: parseJsonMaybe(state.mlm_users, []),
    transactions: parseJsonMaybe(state.mlm_transactions, []),
    wallets: parseJsonMaybe(state.mlm_wallets, []),
    payments: parseJsonMaybe(state.mlm_payments, []),
    pinPurchaseRequests: parseJsonMaybe(state.mlm_pin_purchase_requests, [])
  };
}

async function loadStateFromMySql(envPath) {
  dotenv.config({ path: envPath });

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'okshopee24';

  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 2
  });

  try {
    const [rows] = await pool.query(
      `SELECT state_key, state_value
       FROM state_store
       WHERE state_key IN (
         'mlm_users',
         'mlm_transactions',
         'mlm_wallets',
         'mlm_payments',
         'mlm_pin_purchase_requests'
       )`
    );

    const map = new Map(rows.map((row) => [String(row.state_key), row.state_value]));

    return {
      sourceLabel: `mysql:${host}/${database}`,
      users: parseJsonMaybe(map.get('mlm_users') || '[]', []),
      transactions: parseJsonMaybe(map.get('mlm_transactions') || '[]', []),
      wallets: parseJsonMaybe(map.get('mlm_wallets') || '[]', []),
      payments: parseJsonMaybe(map.get('mlm_payments') || '[]', []),
      pinPurchaseRequests: parseJsonMaybe(map.get('mlm_pin_purchase_requests') || '[]', [])
    };
  } finally {
    await pool.end();
  }
}

function getTxTime(tx) {
  const t = new Date(tx?.completedAt || tx?.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function resolveLevel(tx) {
  const numericLevel = Number(tx?.level);
  if (Number.isFinite(numericLevel) && numericLevel >= 1 && numericLevel <= MAX_LEVEL) {
    return numericLevel;
  }
  const desc = String(tx?.description || '');
  const match = desc.match(/\blevel\s+(\d+)\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LEVEL) return null;
  return parsed;
}

function isLockedFirstTwoReceiveDescription(description, level) {
  const desc = String(description || '').toLowerCase();
  const prefix = typeof level === 'number'
    ? `locked first-two help at level ${level}`
    : 'locked first-two help at level';
  return desc.includes(prefix);
}

function isLockedQualifiedReceiveDescription(description, level) {
  const desc = String(description || '').toLowerCase();
  const prefix = typeof level === 'number'
    ? `locked receive help at level ${level}`
    : 'locked receive help at level';
  return desc.includes(prefix);
}

function isReleasedLockedReceiveDescription(description, level) {
  const desc = String(description || '').toLowerCase();
  const prefix = typeof level === 'number'
    ? `released locked receive help at level ${level}`
    : 'released locked receive help at level';
  return desc.includes(prefix);
}

function parseWithdrawalFee(description) {
  if (!description) return 0;
  const match = String(description).match(/Fee:\s*\$([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return 0;
  const fee = Number(match[1]);
  return Number.isFinite(fee) ? fee : 0;
}

function getUnsettledLockedReceiveEffectiveAmount(tx, allTransactions) {
  if (tx?.type !== 'receive_help' || tx?.status !== 'completed') return 0;
  if (
    !isLockedFirstTwoReceiveDescription(tx.description)
    && !isLockedQualifiedReceiveDescription(tx.description)
  ) {
    return 0;
  }

  const directAmount = Number(tx.amount || 0);
  if (directAmount > 0) {
    return Math.abs(directAmount);
  }

  const displayAmount = Number(tx.displayAmount || 0);
  if (!(displayAmount > 0)) return 0;

  const level = resolveLevel(tx);
  if (!level) return 0;

  const txTime = getTxTime(tx);
  const expectedGiveLevel = Math.min(MAX_LEVEL, level + 1);
  const settledByGiveHelp = allTransactions.some((candidate) =>
    candidate.userId === tx.userId
    && candidate.type === 'give_help'
    && candidate.status === 'completed'
    && Number(candidate.amount || 0) < 0
    && String(candidate.description || '').toLowerCase().includes('from locked income')
    && resolveLevel(candidate) === expectedGiveLevel
    && Math.abs(getTxTime(candidate) - txTime) <= LOCKED_SETTLEMENT_WINDOW_MS
  );

  return settledByGiveHelp ? 0 : Math.abs(displayAmount);
}

function buildUserMaps(users) {
  const byId = new Map();
  const byUserId = new Map();
  for (const user of users) {
    if (!user || !user.id) continue;
    byId.set(user.id, user);
    if (user.userId) byUserId.set(String(user.userId), user);
  }
  return { byId, byUserId };
}

function computeFundWallet(userId, transactions, payments, pinPurchaseRequests) {
  const txs = transactions
    .filter((tx) => tx.userId === userId)
    .sort((a, b) => getTxTime(a) - getTxTime(b));

  let balance = 0;
  let relevantCount = 0;

  for (const tx of txs) {
    const desc = String(tx.description || '').toLowerCase();

    if (tx.type === 'deposit' && tx.status === 'completed' && Number(tx.amount || 0) > 0) {
      balance += Number(tx.amount || 0);
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'admin_credit' && tx.status === 'completed' && Number(tx.amount || 0) > 0 && (desc.includes('deposit wallet') || desc.includes('fund wallet'))) {
      balance += Number(tx.amount || 0);
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'admin_debit' && tx.status === 'completed' && Number(tx.amount || 0) < 0 && (desc.includes('deposit wallet') || desc.includes('fund wallet'))) {
      balance -= Math.abs(Number(tx.amount || 0));
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'fund_recovery' && tx.status === 'completed' && Number(tx.amount || 0) < 0) {
      balance -= Math.abs(Number(tx.amount || 0));
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'p2p_transfer' && tx.status === 'completed') {
      balance += Number(tx.amount || 0);
      relevantCount += 1;
      continue;
    }

    if (
      tx.type === 'income_transfer'
      && tx.status === 'completed'
      && Number(tx.amount || 0) < 0
      && desc.includes('to your fund wallet')
    ) {
      const amount = Math.abs(Number(tx.amount || 0));
      const hasExistingCredit = txs.some((creditTx) =>
        creditTx.userId === tx.userId
        && creditTx.type === 'p2p_transfer'
        && creditTx.status === 'completed'
        && Math.abs(Number((creditTx.displayAmount ?? creditTx.amount) || 0) - amount) <= ROUND_EPSILON
        && (
          creditTx.sourceTransferTxId === tx.id
          || (
            String(creditTx.description || '').toLowerCase().includes('income wallet transfer')
            && Math.abs(getTxTime(creditTx) - getTxTime(tx)) <= MATCH_WINDOW_MS
          )
        )
      );

      if (!hasExistingCredit) {
        balance += amount;
        relevantCount += 1;
      }
      continue;
    }

    if (tx.type === 'pin_purchase' && tx.status === 'completed' && Number(tx.amount || 0) < 0 && desc.includes('fund wallet')) {
      balance -= Math.abs(Number(tx.amount || 0));
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'activation' && tx.status === 'completed' && Number(tx.amount || 0) < 0 && desc.includes('fund wallet')) {
      balance -= Math.abs(Number(tx.amount || 0));
      relevantCount += 1;
      continue;
    }

    if (tx.type === 'system_fee' && tx.status === 'completed' && Number(tx.amount || 0) < 0 && desc.includes('deposit wallet')) {
      balance -= Math.abs(Number(tx.amount || 0));
      relevantCount += 1;
      continue;
    }
  }

  for (const payment of payments) {
    if (payment.userId !== userId) continue;
    if (payment.status !== 'completed') continue;

    const paymentAmount = Number(payment.amount || 0);
    if (!(paymentAmount > 0)) continue;

    const paymentTime = new Date(payment.verifiedAt || payment.createdAt || 0).getTime();
    const hasDepositTx = txs.some((tx) =>
      tx.userId === payment.userId
      && tx.type === 'deposit'
      && tx.status === 'completed'
      && Number(tx.amount || 0) === paymentAmount
      && Math.abs(getTxTime(tx) - paymentTime) <= MATCH_WINDOW_MS
    );
    if (hasDepositTx) continue;

    balance += paymentAmount;
    relevantCount += 1;
  }

  for (const request of pinPurchaseRequests) {
    if (request.userId !== userId) continue;
    if (request.status !== 'completed' || !request.paidFromWallet) continue;

    const requestAmount = Math.abs(Number(request.amount || 0));
    if (!(requestAmount > 0)) continue;

    const requestTime = new Date(request.processedAt || request.createdAt || 0).getTime();
    const hasPinPurchaseTx = txs.some((tx) =>
      tx.userId === request.userId
      && tx.type === 'pin_purchase'
      && tx.status === 'completed'
      && Math.abs(Number(tx.amount || 0)) === requestAmount
      && Number(tx.amount || 0) < 0
      && Math.abs(getTxTime(tx) - requestTime) <= MATCH_WINDOW_MS
    );
    if (hasPinPurchaseTx) continue;

    balance -= requestAmount;
    relevantCount += 1;
  }

  return {
    value: Math.max(0, round2(balance)),
    relevantCount
  };
}

function computeIncomeLedger(userId, transactions) {
  const txs = transactions
    .filter((tx) => tx.userId === userId)
    .sort((a, b) => getTxTime(a) - getTxTime(b));

  let incomeWallet = 0;
  let matrixWallet = 0;
  let totalReceived = 0;
  let totalGiven = 0;
  let relevantCount = 0;

  for (const tx of txs) {
    const txDesc = String(tx.description || '').toLowerCase();
    const txType = String(tx.type || '');
    const txAmount = Number(tx.amount || 0);

    const isNonEarningCreditType =
      txType === 'activation'
      || txType === 'income_transfer'
      || txType === 'royalty_transfer'
      || txType === 'pin_used'
      || txType === 'pin_purchase'
      || txType === 'pin_transfer'
      || txType === 'deposit'
      || txType === 'p2p_transfer'
      || txType === 'reentry';
    const isIncomeWalletAdminCredit = txType !== 'admin_credit' || txDesc.includes('income wallet');

    const lifetimeCreditAmount = txType === 'receive_help'
      ? Math.abs(Number((tx.displayAmount ?? tx.amount) || 0))
      : txAmount;
    if (lifetimeCreditAmount > 0 && !isNonEarningCreditType && isIncomeWalletAdminCredit) {
      totalReceived += lifetimeCreditAmount;
    }

    switch (txType) {
      case 'direct_income':
      case 'level_income':
        incomeWallet += txAmount;
        matrixWallet += txAmount;
        relevantCount += 1;
        break;
      case 'royalty_income':
        relevantCount += 1;
        break;
      case 'royalty_transfer':
        if (txAmount > 0 && txDesc.includes('income wallet')) {
          incomeWallet += txAmount;
        }
        relevantCount += 1;
        break;
      case 'receive_help': {
        const isLockedReceive = isLockedQualifiedReceiveDescription(txDesc)
          || isLockedFirstTwoReceiveDescription(txDesc);
        if (!isLockedReceive) {
          incomeWallet += txAmount;
          matrixWallet += txAmount;
        }
        relevantCount += 1;
        break;
      }
      case 'give_help':
        if (!txDesc.includes('from locked income') && !txDesc.includes('from matrix contribution')) {
          if (txAmount >= 0) {
            incomeWallet += txAmount;
            matrixWallet += txAmount;
          } else {
            const incomeOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
            const matrixOutflow = Math.min(Math.abs(txAmount), Math.max(0, matrixWallet));
            incomeWallet -= incomeOutflow;
            matrixWallet -= matrixOutflow;
          }
        }
        totalGiven += Math.abs(txAmount);
        relevantCount += 1;
        break;
      case 'safety_pool':
        if (txAmount >= 0) {
          incomeWallet += txAmount;
        } else {
          const safetyOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= safetyOutflow;
        }
        relevantCount += 1;
        break;
      case 'withdrawal': {
        const fee = parseWithdrawalFee(tx.description || '');
        const withdrawalOutflow = txAmount < 0 ? Math.abs(txAmount) : Math.abs(txAmount) + fee;
        const appliedOutflow = Math.min(withdrawalOutflow, Math.max(0, incomeWallet));
        incomeWallet -= appliedOutflow;
        relevantCount += 1;
        break;
      }
      case 'income_transfer':
        if (txAmount >= 0) {
          incomeWallet += txAmount;
        } else {
          const transferOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= transferOutflow;
          totalGiven += Math.abs(txAmount);
        }
        relevantCount += 1;
        break;
      case 'admin_credit':
        if (txDesc.includes('income wallet')) {
          incomeWallet += txAmount;
          relevantCount += 1;
        }
        break;
      case 'admin_debit':
        if (txDesc.includes('income wallet')) {
          const debitOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= debitOutflow;
          totalGiven += Math.abs(txAmount);
          relevantCount += 1;
        }
        break;
      case 'fund_recovery':
        if (txDesc.includes('income wallet')) {
          const recoveryOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= recoveryOutflow;
          relevantCount += 1;
        }
        break;
      case 'system_fee':
        if (txDesc.includes('income wallet')) {
          const feeOutflow = Math.min(Math.abs(txAmount), Math.max(0, incomeWallet));
          incomeWallet -= feeOutflow;
        }
        relevantCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    incomeWallet: Math.max(0, round2(incomeWallet)),
    matrixWallet: Math.max(0, round2(matrixWallet)),
    totalReceived: Math.max(0, round2(totalReceived)),
    totalGiven: Math.max(0, round2(totalGiven)),
    relevantCount
  };
}

function computeLockedIncome(userId, transactions) {
  const txs = transactions
    .filter((tx) => tx.userId === userId)
    .sort((a, b) => getTxTime(a) - getTxTime(b));

  let locked = 0;
  for (const tx of txs) {
    const desc = String(tx.description || '').toLowerCase();
    const effectiveLockedReceiveAmount = getUnsettledLockedReceiveEffectiveAmount(tx, txs);
    if (effectiveLockedReceiveAmount > 0) {
      locked += effectiveLockedReceiveAmount;
      continue;
    }
    if (tx.type === 'receive_help' && Number(tx.amount || 0) > 0 && isReleasedLockedReceiveDescription(desc)) {
      locked -= Number(tx.amount || 0);
      continue;
    }
    if (tx.type === 'give_help' && desc.includes('from locked income')) {
      locked -= Math.abs(Number(tx.amount || 0));
    }
  }

  return Math.max(0, round2(locked));
}

function formatMoney(v) {
  return Number(v || 0).toFixed(2);
}

async function main() {
  const sourceArg = String(process.argv[2] || '').trim();
  const isMySqlMode = sourceArg === '--mysql' || sourceArg === 'mysql';
  const argUserRef = (isMySqlMode ? process.argv[3] : process.argv[3]) || '';

  let sourceLabel = '';
  let data;

  if (isMySqlMode) {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
      console.error(`Env file not found for mysql mode: ${envPath}`);
      process.exit(1);
    }

    data = await loadStateFromMySql(envPath);
    sourceLabel = data.sourceLabel;
  } else {
    const inputPath = sourceArg
      ? path.resolve(sourceArg)
      : path.resolve(__dirname, '..', 'data', 'app-state.local.json');

    if (!fs.existsSync(inputPath)) {
      console.error(`Input state file not found: ${inputPath}`);
      process.exit(1);
    }

    data = loadState(inputPath);
    sourceLabel = inputPath;
  }

  const { users, transactions, wallets, payments, pinPurchaseRequests } = data;
  const walletByUserId = new Map(wallets.map((w) => [String(w.userId), w]));
  const { byId: userById, byUserId } = buildUserMaps(users);

  const scopedUsers = argUserRef
    ? (() => {
        const user = userById.get(String(argUserRef)) || byUserId.get(String(argUserRef));
        return user ? [user] : [];
      })()
    : users;

  if (argUserRef && scopedUsers.length === 0) {
    console.error(`User not found for reference: ${argUserRef}`);
    process.exit(2);
  }

  let fundMismatches = 0;
  let incomeMismatches = 0;
  let lockedMismatches = 0;
  let usersWithAnyMismatch = 0;
  let totalFundDelta = 0;
  let totalIncomeDelta = 0;
  let totalLockedDelta = 0;

  const rows = [];

  for (const user of scopedUsers) {
    const wallet = walletByUserId.get(String(user.id));
    if (!wallet) continue;

    const expectedFund = computeFundWallet(user.id, transactions, payments, pinPurchaseRequests);
    const expectedIncome = computeIncomeLedger(user.id, transactions);
    const expectedLocked = computeLockedIncome(user.id, transactions);

    const currentFund = Number(wallet.depositWallet || 0);
    const currentIncome = Number(wallet.incomeWallet || 0);
    const currentLocked = Number(wallet.lockedIncomeWallet || 0);

    const fundDelta = round2(expectedFund.value - currentFund);
    const incomeDelta = round2(expectedIncome.incomeWallet - currentIncome);
    const lockedDelta = round2(expectedLocked - currentLocked);

    const hasFund = Math.abs(fundDelta) > ROUND_EPSILON;
    const hasIncome = Math.abs(incomeDelta) > ROUND_EPSILON;
    const hasLocked = Math.abs(lockedDelta) > ROUND_EPSILON;

    if (hasFund) fundMismatches += 1;
    if (hasIncome) incomeMismatches += 1;
    if (hasLocked) lockedMismatches += 1;
    if (hasFund || hasIncome || hasLocked) usersWithAnyMismatch += 1;

    totalFundDelta = round2(totalFundDelta + fundDelta);
    totalIncomeDelta = round2(totalIncomeDelta + incomeDelta);
    totalLockedDelta = round2(totalLockedDelta + lockedDelta);

    rows.push({
      userId: user.userId,
      internalId: user.id,
      name: user.fullName,
      current: {
        fund: round2(currentFund),
        income: round2(currentIncome),
        locked: round2(currentLocked)
      },
      expected: {
        fund: expectedFund.value,
        income: expectedIncome.incomeWallet,
        locked: expectedLocked
      },
      delta: {
        fund: fundDelta,
        income: incomeDelta,
        locked: lockedDelta
      },
      hasMismatch: hasFund || hasIncome || hasLocked,
      details: {
        fundRelevantCount: expectedFund.relevantCount,
        incomeRelevantCount: expectedIncome.relevantCount
      }
    });
  }

  const impacted = rows
    .filter((r) => r.hasMismatch)
    .sort((a, b) => {
      const aAbs = Math.max(Math.abs(a.delta.fund), Math.abs(a.delta.income), Math.abs(a.delta.locked));
      const bAbs = Math.max(Math.abs(b.delta.fund), Math.abs(b.delta.income), Math.abs(b.delta.locked));
      return bAbs - aAbs;
    });

  const summary = {
    sourceFile: sourceLabel,
    generatedAt: new Date().toISOString(),
    scopedUsers: scopedUsers.length,
    walletsFoundForScopedUsers: rows.length,
    fallbackCoverage: {
      completedPayments: payments.filter((p) => p.status === 'completed').length,
      completedPinRequests: pinPurchaseRequests.filter((p) => p.status === 'completed').length,
      paidFromWalletPinRequests: pinPurchaseRequests.filter((p) => p.status === 'completed' && p.paidFromWallet).length
    },
    mismatchCounts: {
      usersWithAnyMismatch,
      fundMismatches,
      incomeMismatches,
      lockedMismatches
    },
    totalDelta: {
      fund: totalFundDelta,
      income: totalIncomeDelta,
      locked: totalLockedDelta
    },
    topImpacted: impacted.slice(0, 25),
    allRows: rows
  };

  const outDir = path.resolve(__dirname, '..', 'data');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sourceTag = isMySqlMode ? 'mysql' : 'file';
  const outPath = path.join(outDir, `wallet-ledger-resync-report-${sourceTag}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('=== Wallet Ledger Resync Verification ===');
  console.log(`Source: ${sourceLabel}`);
  console.log(`Scoped users: ${summary.scopedUsers}`);
  console.log(`Wallet rows checked: ${summary.walletsFoundForScopedUsers}`);
  console.log(`Completed payments available: ${summary.fallbackCoverage.completedPayments}`);
  console.log(`Completed PIN requests available: ${summary.fallbackCoverage.completedPinRequests}`);
  console.log(`Users with mismatch: ${summary.mismatchCounts.usersWithAnyMismatch}`);
  console.log(`Fund mismatches: ${summary.mismatchCounts.fundMismatches}`);
  console.log(`Income mismatches: ${summary.mismatchCounts.incomeMismatches}`);
  console.log(`Locked mismatches: ${summary.mismatchCounts.lockedMismatches}`);
  console.log(`Total delta (fund/income/locked): ${formatMoney(summary.totalDelta.fund)} / ${formatMoney(summary.totalDelta.income)} / ${formatMoney(summary.totalDelta.locked)}`);

  if (summary.topImpacted.length > 0) {
    const top = summary.topImpacted[0];
    console.log('Top impacted user:');
    console.log(`  ${top.name} (${top.userId})`);
    console.log(`  Fund: ${formatMoney(top.current.fund)} -> ${formatMoney(top.expected.fund)} (delta ${formatMoney(top.delta.fund)})`);
    console.log(`  Income: ${formatMoney(top.current.income)} -> ${formatMoney(top.expected.income)} (delta ${formatMoney(top.delta.income)})`);
    console.log(`  Locked: ${formatMoney(top.current.locked)} -> ${formatMoney(top.expected.locked)} (delta ${formatMoney(top.delta.locked)})`);
  }

  console.log(`Report saved to: ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
