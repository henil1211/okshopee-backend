import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'; // Load dotenv

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') }); // Load .env configuration

// Helper function to resolve user by internal ID or public user ID
function resolveUser(ref, users) {
  return users.find(u => u.id === ref || u.userId === ref);
}

function resolveTransactionLevel(tx) {
  if (tx.level !== undefined && tx.level !== null) return Number(tx.level);
  const match = String(tx.description || '').match(/level\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function run() {
  console.log("=== Starting Deep Financial Correction Script (Live Database Mode) ===");

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
       console.log("Error loading from DB state_store.");
       return;
    }

    let state = {
       mlm_users: JSON.parse(usersRow[0].state_value || '[]'),
       mlm_transactions: JSON.parse(txsRow[0].state_value || '[]'),
       mlm_wallets: JSON.parse(walletsRow[0].state_value || '[]')
    };

    let users = state.mlm_users;
    let transactions = state.mlm_transactions;
    let wallets = state.mlm_wallets;

    console.log(`Loaded ${users.length} users, ${transactions.length} transactions, ${wallets.length} wallets.`);

    const validUserIds = new Set(users.map(u => u.userId));
    const validInternalIds = new Set(users.map(u => u.id));

    let retainedTransactions = [];
    const directIncomes = new Map();
    let duplicatesRemovedCount = 0;
    
    // --- CASE 1 & 3: Duplicate and Missing Referral Income ---
    console.log("\n--- Phase 1: Fixing Direct Income (Referrals) ---");
    for (const tx of transactions) {
      let keepTx = true;
      if (tx.type === 'direct_income' && tx.status === 'completed') {
        const idMatch = String(tx.description || '').match(/\((\d{7})\)/);
        let fromUserId = tx.fromUserId || (idMatch ? idMatch[1] : null);

        if (fromUserId) {
          const key = `${tx.userId}__${fromUserId}`;
          if (!directIncomes.has(key)) {
            directIncomes.set(key, []);
          }
          directIncomes.get(key).push(tx);
        }
      }
    }

    for (const [key, txs] of directIncomes.entries()) {
      if (txs.length > 1) {
        // Sort explicitly by date to keep the first one
        txs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        // Keep index 0, mark the rest for removal
        for (let i = 1; i < txs.length; i++) {
          txs[i]._markRemove = true;
          duplicatesRemovedCount++;
          
          let w = resolveUser(txs[i].userId, wallets);
          if (w) {
            w.incomeWallet -= Math.abs(txs[i].amount);
            w.totalReceived -= Math.abs(txs[i].amount);
          }
          console.log(`[Removed Duplicate Direct Income] user: ${txs[i].userId} amount: ${txs[i].amount}`);
        }
      }
    }

    // Checking for MISSING direct incomes (Case 3 part 2)
    let missingAddedCount = 0;
    for (const u of users) {
      if (u.referredBy) {
        const sponsor = resolveUser(u.referredBy, users);
        if (sponsor) {
          const key = `${sponsor.id}__${u.id}`;
          const keyAlt = `${sponsor.id}__${u.userId}`;
          const alt2 = `${sponsor.userId}__${u.id}`; // possible variations 
          const alt3 = `${sponsor.userId}__${u.userId}`;

          if (!directIncomes.has(key) && !directIncomes.has(keyAlt) && !directIncomes.has(alt2) && !directIncomes.has(alt3)) {
            // Missing entirely!
            missingAddedCount++;
            const tAmount = 5;
            transactions.push({
              id: `tx_${Date.now()}_missing_${u.id}_${Math.random().toString(36).substring(2,6)}`,
              userId: sponsor.id,
              type: 'direct_income',
              amount: tAmount,
              fromUserId: u.id,
              status: 'completed',
              description: `Referral income from ${u.fullName} (${u.userId})`,
              createdAt: u.createdAt || new Date().toISOString(),
              completedAt: u.createdAt || new Date().toISOString()
            });
            let w = resolveUser(sponsor.id, wallets);
            if (w) {
              w.incomeWallet += tAmount;
              w.totalReceived += tAmount;
            }
            console.log(`[Added Missing Direct Income] for sponsor ${sponsor.userId} from user ${u.userId}`);
          }
        }
      }
    }

    // --- CASE 2: Duplicate Receive Help from non-existing IDs (Ghost) and Real Users ---
    console.log("\n--- Phase 2: Fixing Duplicate / Ghost Receive Help ---");
    let ghostRemovedCount = 0;
    const l1Helps = new Map();
    
    // Pass 2: mark bad ghost helps and duplicated L1 helps
    for (const tx of transactions) {
      if (tx._markRemove) continue; 
      
      if (tx.type === 'receive_help' && tx.status === 'completed') {
        const L = resolveTransactionLevel(tx);
        
        let ghost = false;
        let fromUser = tx.fromUserId ? resolveUser(tx.fromUserId, users) : null;
        
        // Ghost Detection
        if (!tx.fromUserId) {
          ghost = true;
        } else if (!fromUser && !validInternalIds.has(tx.fromUserId) && !validUserIds.has(tx.fromUserId)) {
          ghost = true;
        }

        if (ghost) {
          tx._markRemove = true;
          ghostRemovedCount++;
          
          let w = resolveUser(tx.userId, wallets);
          if (w) {
            // Depending on frontend DB logic, L1 helps usually go to lockedIncomeWallet
            if (L === 1) {
              w.lockedIncomeWallet -= Math.abs(tx.amount); 
            } else {
              w.incomeWallet -= Math.abs(tx.amount);
            }
            w.totalReceived -= Math.abs(tx.amount);
          }
          console.log(`[Removed Ghost Receive Help] ID: ${tx.id} from: ${tx.fromUserId} amt: ${tx.amount}`);
        } else if (L === 1) {
          // Check for Duplicate Help from same user at Level 1
          const realFromUserId = fromUser ? fromUser.id : tx.fromUserId;
          const k = `${tx.userId}__${realFromUserId}__L1`;
          if (!l1Helps.has(k)) {
            l1Helps.set(k, []);
          }
          l1Helps.get(k).push(tx);
        }
      }
    }

    let duplicateHelpRemovedCount = 0;
    for (const [k, txs] of l1Helps.entries()) {
      if (txs.length > 1) {
        txs.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        for (let i = 1; i < txs.length; i++) {
          txs[i]._markRemove = true;
          duplicateHelpRemovedCount++;
          
          let w = resolveUser(txs[i].userId, wallets);
          if (w) {
            w.lockedIncomeWallet -= Math.abs(txs[i].amount);
            w.totalReceived -= Math.abs(txs[i].amount);
          }
          console.log(`[Removed Duplicate L1 Help] tx: ${txs[i].id} amt: ${txs[i].amount}`);
        }
      }
    }

    // --- CASE 2b: Cascading Give Help Reversal ---
    // If a user received duplicate help and then they "gave help" because locked reached threshold...
    // The easiest way is to recalculate "giveHelpLocked" and ensure "lockedIncomeWallet" isn't < 0.
    console.log("\n--- Phase 3: Balancing Wallets & Give Help Reversals ---");
    let brokenGiveHelpsReversed = 0;

    for (let w of wallets) {
       if (w.incomeWallet < 0) w.incomeWallet = 0;
       if (w.lockedIncomeWallet < 0) {
         // They gave a help from money they actually didn't legitimately have locked yet!
         const debt = Math.abs(w.lockedIncomeWallet);
         // Find give_help transactions this user made from locked income at level 1 or 2
         const theirGives = transactions.filter(t => t.type === 'give_help' && t.userId === w.userId && !t._markRemove && t.status === 'completed');
         theirGives.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Latest first
         
         let remainingDebt = debt;
         for (let gTx of theirGives) {
           if (remainingDebt <= 0) break;
           
           gTx._markRemove = true; // Undo this give help!
           brokenGiveHelpsReversed++;
           remainingDebt -= Math.abs(gTx.amount);
           w.giveHelpLocked -= Math.abs(gTx.amount); // reverse logic
           w.totalGiven -= Math.abs(gTx.amount);
           w.lockedIncomeWallet += Math.abs(gTx.amount); 

           console.log(`[Reversed Incorrect Give Help] user: ${w.userId}, tx: ${gTx.id}`);
           
           // Also find the receive_help that perfectly matched this give_help up the line!
           // They are usually paired. But let's just find the receive_help that corresponds to this id.
           const matchedReceive = transactions.find(t => t.type === 'receive_help' && !t._markRemove && t.fromUserId === w.userId && t.amount === Math.abs(gTx.amount) && Math.abs(new Date(t.createdAt).getTime() - new Date(gTx.createdAt).getTime()) < 5000);
           if (matchedReceive) {
              matchedReceive._markRemove = true;
              let rec_w = resolveUser(matchedReceive.userId, wallets);
              if (rec_w) {
                if (resolveTransactionLevel(matchedReceive) === 1) {
                  rec_w.lockedIncomeWallet -= Math.abs(matchedReceive.amount);
                } else {
                  rec_w.incomeWallet -= Math.abs(matchedReceive.amount);
                }
                rec_w.totalReceived -= Math.abs(matchedReceive.amount);
                console.log(`  -> [Reversed Cascaded Receive Help] for user: ${rec_w.userId}, tx: ${matchedReceive.id}`);
              }
           }
         }
       }
    }

    transactions = transactions.filter(t => !t._markRemove);

    console.log(`\n=== Summary ===`);
    console.log(`- Duplicate Referral Incomes Removed: ${duplicatesRemovedCount}`);
    console.log(`- Missing Referral Incomes Added: ${missingAddedCount}`);
    console.log(`- Ghost Helps Removed: ${ghostRemovedCount}`);
    console.log(`- Duplicate Valid L1 Helps Removed: ${duplicateHelpRemovedCount}`);
    console.log(`- Unwarranted Give Helps Reversed due to debt: ${brokenGiveHelpsReversed}`);
    console.log(`Total Remaining Transactions: ${transactions.length}`);

    // BACKUP OLD ONES just in case
    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, `pre-fix-backup-${Date.now()}.json`), JSON.stringify(state));

    await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'", [JSON.stringify(transactions)]);
    await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'", [JSON.stringify(wallets)]);
    
    console.log('Live Database updated successfully!');
    
  } catch (error) {
    console.error("Error executing script:", error);
  } finally {
    pool.end();
  }
}

run();