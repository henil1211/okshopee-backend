import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function resolveUser(ref, users) {
  return users.find(u => u.id === ref || u.userId === ref);
}

function resolveTransactionLevel(tx) {
  if (tx.level !== undefined && tx.level !== null) return Number(tx.level);
  const match = String(tx.description || '').match(/level\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

async function runAudit() {
  console.log("=== Phase 1: AUDIT & DETECT (Read-Only) ===");

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
       console.log("Error loading from database.");
       return;
    }

    const users = JSON.parse(usersRow[0].state_value || '[]');
    const originalTransactions = JSON.parse(txsRow[0].state_value || '[]');
    const originalWallets = JSON.parse(walletsRow[0].state_value || '[]');
    
    // Deep clone for projection
    let projectedTransactions = JSON.parse(JSON.stringify(originalTransactions));
    let projectedWallets = JSON.parse(JSON.stringify(originalWallets));

    const validUserIds = new Set(users.map(u => u.userId));
    const validInternalIds = new Set(users.map(u => u.id));

    let auditLog = [];
    const directIncomes = new Map();
    const levelHelps = new Map();

    console.log(`Analyzing ${users.length} users, ${originalTransactions.length} transactions...`);

    // 1. DETECT DUPLICATE DIRECT INCOME
    for (const tx of projectedTransactions) {
      if (tx.type === 'direct_income' && tx.status === 'completed') {
        const idMatch = String(tx.description || '').match(/\((\d{7})\)/);
        let fromUserId = tx.fromUserId || (idMatch ? idMatch[1] : null);
        if (fromUserId) {
          const key = `${tx.userId}__${fromUserId}`;
          if (!directIncomes.has(key)) directIncomes.set(key, []);
          directIncomes.get(key).push(tx);
        }
      }
    }

    for (const [key, txs] of directIncomes.entries()) {
      if (txs.length > 1) {
        txs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        for (let i = 1; i < txs.length; i++) {
          txs[i]._markRemove = true;
          let w = resolveUser(txs[i].userId, projectedWallets);
          if (w) {
            w.incomeWallet -= Math.abs(txs[i].amount);
            w.totalReceived -= Math.abs(txs[i].amount);
          }
          auditLog.push(`DUPLICATE DIRECT INCOME: User ${w?.userId || txs[i].userId} received extra $${txs[i].amount} from ${key.split('__')[1]}`);
        }
      }
    }

    // 2. DETECT MISSING DIRECT INCOME
    for (const u of users) {
      if (u.referredBy) {
        const sponsor = resolveUser(u.referredBy, users);
        if (sponsor) {
          const combos = [`${sponsor.id}__${u.id}`, `${sponsor.id}__${u.userId}`, `${sponsor.userId}__${u.id}`, `${sponsor.userId}__${u.userId}`];
          if (!combos.some(c => directIncomes.has(c))) {
            const tAmount = 5;
            projectedTransactions.push({
              id: `tx_${Date.now()}_missing_${u.id}`,
              userId: sponsor.id,
              type: 'direct_income',
              amount: tAmount,
              fromUserId: u.id,
              status: 'completed',
              description: `Referral income from ${u.fullName} (${u.userId})`,
              createdAt: u.createdAt || new Date().toISOString(),
              completedAt: u.createdAt || new Date().toISOString()
            });
            let w = resolveUser(sponsor.id, projectedWallets);
            if (w) {
              w.incomeWallet += tAmount;
              w.totalReceived += tAmount;
            }
            auditLog.push(`MISSING DIRECT INCOME: Sponsor ${sponsor.userId} missing $5 from ${u.userId} - Added.`);
          }
        }
      }
    }

    // 3. DETECT GHOST & DUPLICATE RECEIVE HELP
    for (const tx of projectedTransactions) {
      if (tx._markRemove) continue;
      if (tx.type === 'receive_help' && tx.status === 'completed') {
        const L = resolveTransactionLevel(tx);
        let ghost = false;
        let fromUser = tx.fromUserId ? resolveUser(tx.fromUserId, users) : null;
        
        if (!tx.fromUserId) ghost = true;
        else if (!fromUser && !validInternalIds.has(tx.fromUserId) && !validUserIds.has(tx.fromUserId)) ghost = true;

        if (ghost) {
          tx._markRemove = true;
          let w = resolveUser(tx.userId, projectedWallets);
          if (w) {
            // Usually L1 or L2 goes to locked in some matrix rules, but let's check description for "locked"
            const isLockedDesc = String(tx.description || '').toLowerCase().includes('locked');
            if (L === 1 || isLockedDesc) w.lockedIncomeWallet -= Math.abs(tx.amount);
            else w.incomeWallet -= Math.abs(tx.amount);
            w.totalReceived -= Math.abs(tx.amount);
          }
          auditLog.push(`GHOST HELP: User ${w?.userId || tx.userId} got fake $${tx.amount} at Level ${L} from phantom ID: ${tx.fromUserId}`);
        } else {
          // Check for duplicate help at ALL levels
          const realFromUserId = fromUser ? fromUser.id : tx.fromUserId;
          const k = `${tx.userId}__${realFromUserId}__L${L}`;
          if (!levelHelps.has(k)) levelHelps.set(k, []);
          levelHelps.get(k).push(tx);
        }
      }
    }

    // Process duplicate helps across all levels
    for (const [k, txs] of levelHelps.entries()) {
      if (txs.length > 1) {
        txs.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        for (let i = 1; i < txs.length; i++) {
          txs[i]._markRemove = true;
          const extractedLevel = Number(k.split('__')[2].replace('L', ''));
          let w = resolveUser(txs[i].userId, projectedWallets);
          if (w) {
            const isLockedDesc = String(txs[i].description || '').toLowerCase().includes('locked');
            if (extractedLevel === 1 || isLockedDesc) w.lockedIncomeWallet -= Math.abs(txs[i].amount);
            else w.incomeWallet -= Math.abs(txs[i].amount);
            w.totalReceived -= Math.abs(txs[i].amount);
          }
          auditLog.push(`DUPLICATE HELP: User ${w?.userId} got double $${txs[i].amount} at Level ${extractedLevel} from ${k.split('__')[1]}`);
        }
      }
    }

    // 4. CASCADE REVERSALS (If Locked Income goes < 0)
    for (let w of projectedWallets) {
       if (w.lockedIncomeWallet < 0) {
         const debt = Math.abs(w.lockedIncomeWallet);
         const theirGives = projectedTransactions.filter(t => t.type === 'give_help' && t.userId === w.id && !t._markRemove && t.status === 'completed');
         theirGives.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
         
         let remainingDebt = debt;
         for (let gTx of theirGives) {
           if (remainingDebt <= 0) break;
           gTx._markRemove = true;
           remainingDebt -= Math.abs(gTx.amount);
           w.giveHelpLocked -= Math.abs(gTx.amount);
           w.totalGiven -= Math.abs(gTx.amount);
           w.lockedIncomeWallet += Math.abs(gTx.amount); 
           
           auditLog.push(`CASCADING FIX: Reversed give_help of $${Math.abs(gTx.amount)} for User ${w.userId} because their locked balance dropped below zero due to ghost/dup fixes.`);

           const matchedReceive = projectedTransactions.find(t => t.type === 'receive_help' && !t._markRemove && t.fromUserId === w.id && t.amount === Math.abs(gTx.amount) && Math.abs(new Date(t.createdAt).getTime() - new Date(gTx.createdAt).getTime()) < 5000);
           if (matchedReceive) {
              matchedReceive._markRemove = true;
              let rec_w = resolveUser(matchedReceive.userId, projectedWallets);
              if (rec_w) {
                if (resolveTransactionLevel(matchedReceive) === 1 || String(matchedReceive.description).toLowerCase().includes('locked')) rec_w.lockedIncomeWallet -= Math.abs(matchedReceive.amount);
                else rec_w.incomeWallet -= Math.abs(matchedReceive.amount);
                rec_w.totalReceived -= Math.abs(matchedReceive.amount);
                auditLog.push(`CASCADING FIX -> Deducted wrongfully received $${matchedReceive.amount} from Upline ${rec_w.userId}`);
              }
           }
         }
       }
       
       // SPENT RECOVERY (Debt)
       // If after all reversals, their incomeWallet drops below 0 (because they withdrew/spent fake funds), store it in fundRecoveryDue
       if (w.incomeWallet < 0) {
         w.fundRecoveryDue = (w.fundRecoveryDue || 0) + Math.abs(w.incomeWallet);
         w.incomeWallet = 0;
       }
       // Process same for locked income (though rare to be spent before unlock)
       if (w.lockedIncomeWallet < 0) {
         w.fundRecoveryDue = (w.fundRecoveryDue || 0) + Math.abs(w.lockedIncomeWallet);
         w.lockedIncomeWallet = 0; 
       }
    }

    // GENERATE WALLET DIFF EXCEL (CSV)
    let csvData = "UserId,Old_Income,New_Income,Income_Diff,Old_Locked,New_Locked,Locked_Diff,Old_Total_Recv,New_Total_Recv,Recv_Diff,Fund_Recovery_Debt,Status\n";
    for (const oldW of originalWallets) {
      const newW = projectedWallets.find(w => w.userId === oldW.userId);
      if (!newW) continue;
      
      const incDiff = newW.incomeWallet - oldW.incomeWallet;
      const lockedDiff = newW.lockedIncomeWallet - oldW.lockedIncomeWallet;
      const recvDiff = newW.totalReceived - oldW.totalReceived;
      const debtCreated = (newW.fundRecoveryDue || 0) - (oldW.fundRecoveryDue || 0);

      if (incDiff !== 0 || lockedDiff !== 0 || recvDiff !== 0 || debtCreated > 0) {
        let status = "Adjusted";
        if (debtCreated > 0) status = "DEBT_CREATED (Spent Fake Funds)";
        
        csvData += `${oldW.userId},${oldW.incomeWallet.toFixed(2)},${newW.incomeWallet.toFixed(2)},${incDiff.toFixed(2)},${oldW.lockedIncomeWallet.toFixed(2)},${newW.lockedIncomeWallet.toFixed(2)},${lockedDiff.toFixed(2)},${oldW.totalReceived.toFixed(2)},${newW.totalReceived.toFixed(2)},${recvDiff.toFixed(2)},${newW.fundRecoveryDue || 0},${status}\n`;
      }
    }

    const dataDir = path.join(__dirname, '..', 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    // Save projections for Script 2
    projectedTransactions = projectedTransactions.filter(t => !t._markRemove);
    await fs.writeFile(path.join(dataDir, 'projected-audit-fixes.json'), JSON.stringify({
      transactions: projectedTransactions,
      wallets: projectedWallets,
      auditLog: auditLog
    }, null, 2));

    await fs.writeFile(path.join(dataDir, 'financial-diff-report.csv'), csvData);

    console.log(`\nAudit Complete! Found ${auditLog.length} issues.`);
    console.log(`Diff excel report generated at: backend/data/financial-diff-report.csv`);
    console.log(`Projected fixes saved to: backend/data/projected-audit-fixes.json`);
    console.log(`\nTo view the detailed issues: cat backend/data/projected-audit-fixes.json`);
    console.log(`\nNEXT STEP: To apply these fixes to the LIVE database safely, run: node apply-financial-fixes.js`);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

runAudit();