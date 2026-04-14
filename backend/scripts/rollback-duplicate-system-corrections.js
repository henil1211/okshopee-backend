import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APPLY_MODE = process.argv.includes('--apply');
const MIN_GAP_HOURS = 6;
const MIN_GAP_MS = MIN_GAP_HOURS * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function txTime(tx) {
  const t = new Date(tx?.completedAt || tx?.createdAt || '').getTime();
  return Number.isFinite(t) ? t : 0;
}

function buildUsersById(users) {
  const map = new Map();
  for (const u of users) {
    if (u?.id) map.set(String(u.id), u);
    if (u?.userId) map.set(String(u.userId), u);
  }
  return map;
}

function findDuplicateCorrectionDebits(transactions) {
  const correctionDebits = transactions.filter((tx) =>
    tx?.type === 'fund_recovery'
    && tx?.status === 'completed'
    && toNumber(tx?.amount) < 0
    && String(tx?.description || '').startsWith('System correction:')
  );

  const grouped = new Map();
  for (const tx of correctionDebits) {
    const key = [
      String(tx.userId || ''),
      String(tx.fromUserId || ''),
      normalizeText(tx.description),
      Math.abs(round2(tx.amount)).toFixed(2)
    ].join('__');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(tx);
  }

  const rollbackTargets = [];
  for (const txs of grouped.values()) {
    if (txs.length <= 1) continue;
    txs.sort((a, b) => txTime(a) - txTime(b));
    const baselineTime = txTime(txs[0]);

    for (let i = 1; i < txs.length; i++) {
      const current = txs[i];
      if (txTime(current) - baselineTime >= MIN_GAP_MS) {
        rollbackTargets.push(current);
      }
    }
  }

  return rollbackTargets;
}

async function run() {
  console.log('=== Duplicate System Correction Rollback Utility ===');
  console.log(APPLY_MODE
    ? 'Mode: APPLY (will write to database)'
    : 'Mode: DRY RUN (no database writes)');

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    waitForConnections: true,
  });

  try {
    const [usersRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
    const [txsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_transactions'");
    const [walletsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");

    if (!usersRow.length || !txsRow.length || !walletsRow.length) {
      throw new Error('Could not load users/transactions/wallets from state_store');
    }

    const users = JSON.parse(usersRow[0].state_value || '[]');
    const transactions = JSON.parse(txsRow[0].state_value || '[]');
    const wallets = JSON.parse(walletsRow[0].state_value || '[]');
    const usersById = buildUsersById(users);

    const rollbackTargets = findDuplicateCorrectionDebits(transactions);
    if (rollbackTargets.length === 0) {
      console.log('No duplicate system correction debits found with time-gap heuristic.');
      return;
    }

    const totalRollbackAmount = round2(
      rollbackTargets.reduce((sum, tx) => sum + Math.abs(toNumber(tx.amount)), 0)
    );

    console.log(`Found ${rollbackTargets.length} duplicate correction debit(s).`);
    console.log(`Total rollback amount: $${totalRollbackAmount.toFixed(2)}`);

    const preview = rollbackTargets.slice(0, 20);
    for (const tx of preview) {
      const user = usersById.get(String(tx.userId || ''));
      const displayUser = user?.userId || String(tx.userId || 'Unknown');
      const displayName = user?.fullName || 'Unknown';
      console.log(`- ${displayUser} (${displayName}) | $${Math.abs(toNumber(tx.amount)).toFixed(2)} | ${tx.description} | tx=${tx.id}`);
    }
    if (rollbackTargets.length > preview.length) {
      console.log(`...and ${rollbackTargets.length - preview.length} more`);
    }

    if (!APPLY_MODE) {
      console.log('\nDry run complete. To apply rollback credits, run with --apply');
      console.log('Example: node scripts/rollback-duplicate-system-corrections.js --apply');
      return;
    }

    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    const backupName = `pre-rollback-dup-corrections-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    await fs.writeFile(
      path.join(backupDir, backupName),
      JSON.stringify({ transactions, wallets }, null, 2),
      'utf8'
    );
    console.log(`Backup created: backend/data/backups/${backupName}`);

    const walletsByUserId = new Map();
    for (const w of wallets) walletsByUserId.set(String(w.userId), w);

    const now = new Date().toISOString();
    let appliedCount = 0;

    for (const tx of rollbackTargets) {
      const amount = Math.abs(toNumber(tx.amount));
      if (!(amount > 0)) continue;

      const wallet = walletsByUserId.get(String(tx.userId));
      if (!wallet) continue;

      wallet.incomeWallet = round2(toNumber(wallet.incomeWallet) + amount);
      wallet.totalReceived = round2(toNumber(wallet.totalReceived) + amount);

      transactions.push({
        id: `tx_${Date.now()}_dup_rollback_${Math.random().toString(36).slice(2, 8)}`,
        userId: tx.userId,
        type: 'admin_credit',
        amount,
        status: 'completed',
        description: `Admin rollback: Reversed duplicate system correction debit (source tx: ${tx.id}) to income wallet`,
        createdAt: now,
        completedAt: now
      });

      appliedCount += 1;
    }

    await pool.query(
      "UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'",
      [JSON.stringify(transactions)]
    );
    await pool.query(
      "UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'",
      [JSON.stringify(wallets)]
    );

    console.log(`Applied rollback credits for ${appliedCount} duplicate correction debit(s).`);
    console.log('Done. Restart backend and verify a few affected users.');
  } catch (error) {
    console.error('Rollback script failed:', error);
  } finally {
    await pool.end();
  }
}

run();