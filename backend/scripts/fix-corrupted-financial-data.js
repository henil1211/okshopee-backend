import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

// --- Helper Functions ---
function getTransactionTime(tx) {
  const value = new Date(tx.completedAt || tx.createdAt || '').getTime();
  return Number.isFinite(value) ? value : 0;
}

function resolveUserByRef(ref, users) {
  return users.find(u => u.id === ref || u.userId === ref);
}

function normalizeIdentityText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveTransactionLevel(tx) {
  if (tx.level !== undefined && tx.level !== null) return Number(tx.level);
  const match = String(tx.description || '').match(/level\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function run() {
  console.log(`Starting Data Cleanup Script ${DRY_RUN ? '(DRY RUN)' : '(LIVE MODE DANGER)'}`);

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
    const [matrixRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_matrix'");

    if (!usersRow.length || !txsRow.length || !walletsRow.length) {
      console.log('Error: Could not retrieve state_store keys. Are they populated?');
      return;
    }

    let users = JSON.parse(usersRow[0].state_value || '[]');
    let transactions = JSON.parse(txsRow[0].state_value || '[]');
    let wallets = JSON.parse(walletsRow[0].state_value || '[]');
    let matrix = JSON.parse(matrixRow[0] ? matrixRow[0].state_value : '[]');

    const initialTxCount = transactions.length;
    let retainedTransactions = [];
    const validUserIds = new Set(users.map(u => u.userId));
    const validInternalIds = new Set(users.map(u => u.id));

    console.log(`\nLoaded ${users.length} users, ${transactions.length} transactions, ${wallets.length} wallets.`);

    // ==========================================
    // PHASE 1: Ghost Help Eradication
    // ==========================================
    let ghostCount = 0;
    let deducedGhostIncome = 0;

    for (const tx of transactions) {
      let isGhost = false;
      if (tx.type === 'receive_help' || tx.type === 'direct_income') {
        if (tx.fromUserId && !validUserIds.has(tx.fromUserId) && !validInternalIds.has(tx.fromUserId)) {
          isGhost = true;
        }
        const match = String(tx.description || '').match(/\((\d{7})\)/);
        if (match && !validUserIds.has(match[1])) {
          isGhost = true;
        }
      }

      if (isGhost) {
        ghostCount++;
        const amt = Math.abs(tx.amount || 0);
        deducedGhostIncome += amt;
        const recip = resolveUserByRef(tx.userId, users);
        const displayId = recip ? recip.userId : tx.userId;
        const displayName = recip ? recip.fullName : 'Unknown';
        console.log(`[Ghost Eradic] Removing TX ${tx.id} for recipient ${displayName} (${displayId}). Amt: ${amt}. Desc: ${tx.description}`);

        const wallet = wallets.find(w => w.userId === tx.userId || w.userId === resolveUserByRef(tx.userId, users)?.userId);
        if (wallet) {
          wallet.incomeWallet -= amt;
          wallet.totalReceived -= amt;
          if (wallet.incomeWallet < 0) {
             wallet.fundRecoveryDue = (wallet.fundRecoveryDue || 0) + Math.abs(wallet.incomeWallet);
             wallet.incomeWallet = 0;
          }
        }
      } else {
        retainedTransactions.push(tx);
      }
    }
    transactions = retainedTransactions;
    console.log(`-> Removed ${ghostCount} ghost transactions. Reversed ${deducedGhostIncome} from wallets.`);


    // ==========================================
    // PHASE 2 & 3: Misattributed & Duplicate Direct Income
    // ==========================================
    const directIncomes = transactions.filter(tx => tx.type === 'direct_income' && tx.status === 'completed');
    const groupedIncomes = new Map();

    for (const tx of directIncomes) {
      const sponsor = resolveUserByRef(tx.userId, users);
      let sourceInternalId = tx.fromUserId;
      let sourceUser = null;
      
      const parsedMatch = String(tx.description || '').match(/Referral income from\s+(.+?)\s+\((\d{7})\)/i);
      
      if (sourceInternalId) {
         sourceUser = resolveUserByRef(sourceInternalId, users);
      } else if (parsedMatch) {
         sourceUser = resolveUserByRef(parsedMatch[2], users);
      }

      if (sponsor && sourceUser) {
        const key = `${sponsor.id}__${sourceUser.id}`;
        if (!groupedIncomes.has(key)) groupedIncomes.set(key, []);
        groupedIncomes.get(key).push(tx);
      }
    }

    let uncreditedReferralsFixed = 0;
    const matrixMap = new Set(matrix.map(m => m.userId));
    
    const activeUsers = users.filter(u => {
       if (matrixMap.has(u.userId)) return true;
       return transactions.some(tx => (tx.userId === u.id || tx.userId === u.userId) && tx.status === 'completed' && (tx.type === 'pin_used' || tx.type === 'activation'));
    });

    for (const referral of activeUsers) {
      const sponsor = resolveUserByRef(referral.sponsorId, users);
      if (!sponsor) continue;

      const hasCredit = transactions.some(tx => 
         tx.type === 'direct_income' && 
         tx.status === 'completed' && 
         (tx.userId === sponsor.id || tx.userId === sponsor.userId) && 
         (tx.fromUserId === referral.id || tx.fromUserId === referral.userId || String(tx.description || '').includes(`(${referral.userId})`))
      );

      if (!hasCredit) {
        // Try to steal a duplicate!
        let stolenTx = null;
        for (const [key, txs] of Array.from(groupedIncomes.entries())) {
           if (key.startsWith(sponsor.id + '__') && txs.length > 1) {
              stolenTx = txs.pop();
              break;
           }
        }

        if (stolenTx) {
           console.log(`[MisattributeFix] Sponsor ${sponsor.userId} missed ref income for ${referral.userId}. Stealing duplicate Tx ${stolenTx.id}.`);
           stolenTx.fromUserId = referral.id;
           stolenTx.description = `Referral income from ${referral.fullName} (${referral.userId})`;
           uncreditedReferralsFixed++;
        }
      }
    }
    console.log(`-> Reassigned ${uncreditedReferralsFixed} duplicates to uncredited active referrals.`);


    // Phase 3: Remove remaining pure duplicates
    let trueDuplicatesRemoved = 0;
    let trueDupAmt = 0;
    retainedTransactions = [];
    const directIncomeIdsToRemove = new Set();

    for (const [key, txs] of groupedIncomes.entries()) {
       if (txs.length > 1) {
          // Sort strictly by chronology
          txs.sort((a,b) => getTransactionTime(a) - getTransactionTime(b));
          // keep the first, delete the rest
          for (let i = 1; i < txs.length; i++) {
             const dup = txs[i];
             directIncomeIdsToRemove.add(dup.id);
             trueDuplicatesRemoved++;
             trueDupAmt += Math.abs(dup.amount || 0);

             const spon = resolveUserByRef(dup.userId, users);
             const displayId = spon ? spon.userId : dup.userId;
             const displayName = spon ? spon.fullName : 'Unknown';
             console.log(`[DuplicateReferral] Removing exact duplicate ${dup.id} for sponsor ${displayName} (${displayId})`);
             const wallet = wallets.find(w => w.userId === dup.userId || w.userId === resolveUserByRef(dup.userId, users)?.userId);
             if (wallet) {
                const amt = Math.abs(dup.amount || 0);
                wallet.incomeWallet -= amt;
                wallet.totalReceived -= amt;
                if (wallet.incomeWallet < 0) {
                   wallet.fundRecoveryDue = (wallet.fundRecoveryDue || 0) + Math.abs(wallet.incomeWallet);
                   wallet.incomeWallet = 0;
                }
             }
          }
       }
    }

    transactions = transactions.filter(tx => !directIncomeIdsToRemove.has(tx.id));
    console.log(`-> Removed ${trueDuplicatesRemoved} redundant referral records. Reversed ${trueDupAmt} from wallets.`);


    // ==========================================
    // PHASE 4: Duplicate Locked Give Help Cleanup
    // ==========================================
    const lockedGiveTxs = transactions.filter(tx => tx.type === 'give_help' && tx.status === 'completed' && tx.amount < 0 && String(tx.description || '').toLowerCase().includes('from locked income'));
    const completedReceiveTxs = transactions.filter(tx => tx.type === 'receive_help' && tx.status === 'completed' && tx.amount > 0 && !!tx.fromUserId);

    const dupLockedGiveIdsToRemove = new Set();
    const dupReceiveIdsToRemove = new Set();
    const groupedLocked = new Map();

    for (const tx of lockedGiveTxs) {
       const sender = resolveUserByRef(tx.userId, users);
       let recipient = resolveUserByRef(tx.toUserId, users);
       if (!recipient) {
          const m = String(tx.description || '').match(/\((\d{7})\)/);
          if (m) recipient = resolveUserByRef(m[1], users);
       }
       const level = resolveTransactionLevel(tx);
       const amount = Math.abs(Number(tx.amount || 0));

       if (sender && recipient && level && amount > 0) {
          const k = `${sender.id}__${recipient.id}__${level}__${amount.toFixed(2)}`;
          if (!groupedLocked.has(k)) groupedLocked.set(k, []);
          groupedLocked.get(k).push(tx);
       }
    }

    let duplicateGiveHelpCount = 0;
    for (const [key, txs] of groupedLocked.entries()) {
       txs.sort((a,b) => getTransactionTime(a) - getTransactionTime(b));
       let cluster = [];
       const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

       const flush = () => {
          if (cluster.length >= 2) {
             const sender = resolveUserByRef(cluster[0].userId, users);
             const matchedReceives = completedReceiveTxs.filter(rtx => {
                const rp = resolveUserByRef(rtx.userId, users);
                const sd = resolveUserByRef(rtx.fromUserId, users);
                return rp && sd && sd.id === sender.id &&
                       key.includes(rp.id) &&
                       resolveTransactionLevel(rtx) === resolveTransactionLevel(cluster[0]) &&
                       Math.abs(Number(rtx.amount || 0)) === Math.abs(Number(cluster[0].amount || 0)) &&
                       getTransactionTime(rtx) >= getTransactionTime(cluster[0]) - DUPLICATE_WINDOW_MS &&
                       getTransactionTime(rtx) <= getTransactionTime(cluster[cluster.length-1]) + DUPLICATE_WINDOW_MS;
             });

             matchedReceives.sort((a, b) => getTransactionTime(a) - getTransactionTime(b));

             // For each extra beyond the 1st
             for (let i = 1; i < cluster.length; i++) {
                const gTx = cluster[i];
                dupLockedGiveIdsToRemove.add(gTx.id);
                duplicateGiveHelpCount++;
                
                const sWallet = wallets.find(w => w.userId === sender.id || w.userId === sender.userId);
                if (sWallet) {
                   sWallet.giveHelpLocked += Math.abs(gTx.amount || 0);
                   sWallet.totalGiven -= Math.abs(gTx.amount || 0);
                }
             }

             for (let i = 1; i < matchedReceives.length; i++) {
                const rTx = matchedReceives[i];
                dupReceiveIdsToRemove.add(rTx.id);
                
                const rWallet = wallets.find(w => w.userId === rTx.userId || w.userId === resolveUserByRef(rTx.userId, users)?.userId);
                if (rWallet) {
                   const amt = Math.abs(rTx.amount || 0);
                   rWallet.incomeWallet -= amt;
                   rWallet.totalReceived -= amt;
                   if (rWallet.incomeWallet < 0) {
                      rWallet.fundRecoveryDue = (rWallet.fundRecoveryDue || 0) + Math.abs(rWallet.incomeWallet);
                      rWallet.incomeWallet = 0;
                   }
                }
             }
          }
          cluster = [];
       };

       for (const tx of txs) {
          if (cluster.length === 0 || (getTransactionTime(tx) - getTransactionTime(cluster[cluster.length-1]) <= DUPLICATE_WINDOW_MS)) {
             cluster.push(tx);
          } else {
             flush();
             cluster.push(tx);
          }
       }
       flush();
    }

    transactions = transactions.filter(tx => !dupLockedGiveIdsToRemove.has(tx.id) && !dupReceiveIdsToRemove.has(tx.id));
    console.log(`-> Removed ${dupLockedGiveIdsToRemove.size} duplicate give_help and ${dupReceiveIdsToRemove.size} duplicate receive_help.`);

    console.log(`\n=== Final Report ===`);
    console.log(`Original TX Count : ${initialTxCount}`);
    console.log(`Final TX Count    : ${transactions.length}`);

    if (DRY_RUN) {
       console.log(`\nDRY RUN complete. No data was saved to MySQL.`);
    } else {
       console.log(`\nCreating automatic backup of state before modification...`);
       const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
       const backupPath = path.join(__dirname, '..', 'data', 'backups', `pre-cleanup-backup-${timestamp}.json`);
       
       await fs.mkdir(path.dirname(backupPath), { recursive: true });
       await fs.writeFile(backupPath, JSON.stringify({
          transactions: JSON.parse(txsRow[0].state_value || '[]'),
          wallets: JSON.parse(walletsRow[0].state_value || '[]')
       }));
       console.log(`Backup saved to ${backupPath}`);

       console.log(`Saving clean data to MySQL...`);
       await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'", [JSON.stringify(transactions)]);
       await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'", [JSON.stringify(wallets)]);
       console.log('Successfully applied all fixes to DB.');
    }

  } catch(e) {
    console.error('Error during execution:', e);
  } finally {
    pool.end();
  }
}

run();
