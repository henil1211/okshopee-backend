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
          txs[i]._isReversed = true;
          let w = resolveUser(txs[i].userId, projectedWallets);
          if (w) {
            w.incomeWallet -= Math.abs(txs[i].amount);
            w.totalReceived -= Math.abs(txs[i].amount);
          }
          
          projectedTransactions.push({
            id: `tx_${Date.now()}_rev_${Math.random().toString(36).substr(2, 5)}`,
            userId: txs[i].userId,
            type: 'fund_recovery',
            amount: -Math.abs(txs[i].amount),
            fromUserId: txs[i].fromUserId,
            status: 'completed',
            description: `System Reversed: Duplicate direct income received from ${key.split('__')[1]}`,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });

          auditLog.push(`DUPLICATE DIRECT INCOME: User ${w?.userId || txs[i].userId} received extra $${txs[i].amount} from ${key.split('__')[1]}. Added Reversal.`);
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
      if (tx._isReversed) continue;
      if (tx.type === 'receive_help' && tx.status === 'completed') {
        const L = resolveTransactionLevel(tx);
        let ghost = false;
        let fromUser = tx.fromUserId ? resolveUser(tx.fromUserId, users) : null;
        
        if (!tx.fromUserId) ghost = true;
        else if (!fromUser && !validInternalIds.has(tx.fromUserId) && !validUserIds.has(tx.fromUserId)) ghost = true;

        if (ghost) {
          tx._isReversed = true;
          let w = resolveUser(tx.userId, projectedWallets);
          if (w) {
            // Fix: Level 1 help goes to incomeWallet (Unlocked). Level 2+ usually goes to lockedIncomeWallet if description contains "locked"
            const isLockedDesc = String(tx.description || '').toLowerCase().includes('locked');
            if (L > 1 && isLockedDesc) {
              w.lockedIncomeWallet -= Math.abs(tx.amount);
            } else {
              w.incomeWallet -= Math.abs(tx.amount);
            }
            w.totalReceived -= Math.abs(tx.amount);
          }

          projectedTransactions.push({
            id: `tx_${Date.now()}_rev_${Math.random().toString(36).substr(2, 5)}`,
            userId: tx.userId,
            type: 'fund_recovery',
            amount: -Math.abs(tx.amount),
            fromUserId: tx.fromUserId,
            status: 'completed',
            description: `System Reversed: Ghost receive help at Level ${L} from non-existent user ${tx.fromUserId || 'Unknown'}`,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });

          auditLog.push(`GHOST HELP: User ${w?.userId || tx.userId} got fake $${tx.amount} at Level ${L} from phantom ID: ${tx.fromUserId}. Added Reversal.`);
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
          txs[i]._isReversed = true;
          const extractedLevel = Number(k.split('__')[2].replace('L', ''));
          let w = resolveUser(txs[i].userId, projectedWallets);
          if (w) {
            const isLockedDesc = String(txs[i].description || '').toLowerCase().includes('locked');
            if (extractedLevel > 1 && isLockedDesc) {
              w.lockedIncomeWallet -= Math.abs(txs[i].amount);
            } else {
              w.incomeWallet -= Math.abs(txs[i].amount);
            }
            w.totalReceived -= Math.abs(txs[i].amount);
          }

          projectedTransactions.push({
            id: `tx_${Date.now()}_rev_${Math.random().toString(36).substr(2, 5)}`,
            userId: txs[i].userId,
            type: 'fund_recovery',
            amount: -Math.abs(txs[i].amount),
            fromUserId: txs[i].fromUserId,
            status: 'completed',
            description: `System Reversed: Duplicate receive help at Level ${extractedLevel} from ${k.split('__')[1]}`,
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          });

          auditLog.push(`DUPLICATE HELP: User ${w?.userId} got double $${txs[i].amount} at Level ${extractedLevel} from ${k.split('__')[1]}. Added Reversal.`);
        }
      }
    }

    // 4. CASCADE REVERSALS (If Locked Income goes < 0)
    for (let w of projectedWallets) {
       if (w.lockedIncomeWallet < 0) {
         const debt = Math.abs(w.lockedIncomeWallet);
         // FIX: Use w.userId instead of w.id since wallets schema only has userId
         // FIX: DO NOT reverse Level 1 gives, because Level 1 $5 auto-give happens at activation and doesn't come from lockedIncomeWallet!
         const theirGives = projectedTransactions.filter(t => 
           t.type === 'give_help' && 
           t.userId === w.userId && 
           !t._isReversed && 
           t.status === 'completed' &&
           resolveTransactionLevel(t) > 1 
         );
         theirGives.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
         
         let remainingDebt = debt;
         for (let gTx of theirGives) {
           if (remainingDebt <= 0) break;
           gTx._isReversed = true;
           remainingDebt -= Math.abs(gTx.amount);
           w.giveHelpLocked -= Math.abs(gTx.amount);
           w.totalGiven -= Math.abs(gTx.amount);
           w.lockedIncomeWallet += Math.abs(gTx.amount); 
           
           projectedTransactions.push({
             id: `tx_${Date.now()}_rev_${Math.random().toString(36).substr(2, 5)}`,
             userId: w.userId,
             type: 'fund_recovery', // Represents adding funds back to reverse the erroneous give_help
             amount: Math.abs(gTx.amount), 
             fromUserId: 'system',
             status: 'completed',
             description: `System Reversed: Refund for invalid give_help due to cascaded ghost income`,
             createdAt: new Date().toISOString(),
             completedAt: new Date().toISOString()
           });

           auditLog.push(`CASCADING FIX: Reversed give_help of $${Math.abs(gTx.amount)} for User ${w.userId} because their locked balance dropped below zero due to ghost/dup fixes.`);

           const matchedReceive = projectedTransactions.find(t => t.type === 'receive_help' && !t._isReversed && t.fromUserId === w.userId && t.amount === Math.abs(gTx.amount) && Math.abs(new Date(t.createdAt).getTime() - new Date(gTx.createdAt).getTime()) < 5000);
           if (matchedReceive) {
              matchedReceive._isReversed = true;
              let rec_w = resolveUser(matchedReceive.userId, projectedWallets);
              if (rec_w) {
                const isLockedDesc = String(matchedReceive.description).toLowerCase().includes('locked');
                if (resolveTransactionLevel(matchedReceive) > 1 && isLockedDesc) {
                  rec_w.lockedIncomeWallet -= Math.abs(matchedReceive.amount);
                } else {
                  rec_w.incomeWallet -= Math.abs(matchedReceive.amount);
                }
                rec_w.totalReceived -= Math.abs(matchedReceive.amount);

                projectedTransactions.push({
                  id: `tx_${Date.now()}_rev_${Math.random().toString(36).substr(2, 5)}`,
                  userId: rec_w.userId,
                  type: 'fund_recovery',
                  amount: -Math.abs(matchedReceive.amount),
                  fromUserId: matchedReceive.fromUserId,
                  status: 'completed',
                  description: `System Reversed: receive_help from ${matchedReceive.fromUserId} invalid due to cascaded ghost deduction`,
                  createdAt: new Date().toISOString(),
                  completedAt: new Date().toISOString()
                });

                auditLog.push(`CASCADING FIX -> Deducted wrongfully received $${matchedReceive.amount} from Upline ${rec_w.userId}. Added Reversal.`);
              }
           }
         }
       }
    }

    // 5. SPENT RECOVERY (Debt Calculation for all users)
    // Run this as a final pass so all cascading deductions (even on uplines processed earlier) are caught!
    for (let w of projectedWallets) {
       // Look for any manual administrative "Fund Recovery" transactions the user ALREADY paid
       // EXCLUDE the automated 'System Reversed' transactions we just created!
       const manualRecoveries = projectedTransactions.filter(t => 
           t.type === 'fund_recovery' && 
           t.userId === w.userId && 
           t.status === 'completed' && 
           !(t.description || '').startsWith('System Reversed:')
       );
       let historicallyPaid = manualRecoveries.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

       if (w.incomeWallet < 0) {
         let deficit = Math.abs(w.incomeWallet);
         // Forgive the new deficit if they already paid via manual fund_recovery!
         let forgiven = Math.min(deficit, historicallyPaid);
         deficit -= forgiven;
         historicallyPaid -= forgiven;

         w.fundRecoveryDue = (w.fundRecoveryDue || 0) + deficit;
         w.incomeWallet = 0;
       }

       if (w.lockedIncomeWallet < 0) {
         let deficit = Math.abs(w.lockedIncomeWallet);
         let forgiven = Math.min(deficit, historicallyPaid);
         deficit -= forgiven;
         historicallyPaid -= forgiven;

         w.fundRecoveryDue = (w.fundRecoveryDue || 0) + deficit;
         w.lockedIncomeWallet = 0; 
       }
    }

    // GENERATE WALLET DIFF EXCEL (CSV)
    let csvData = "Internal_Id,7_Digit_Id,Name,Old_Income,New_Income,Income_Diff,Old_Locked,New_Locked,Locked_Diff,Old_Total_Recv,New_Total_Recv,Recv_Diff,Old_Total_Given,New_Total_Given,Given_Diff,Fund_Recovery_Debt,Total_Fake_Received,Total_Recovered,Total_Due,Total_Before_Amount,Total_After_Amount,Status\n";
    for (const oldW of originalWallets) {
      const newW = projectedWallets.find(w => w.userId === oldW.userId);
      if (!newW) continue;
      
      const u = resolveUser(oldW.userId, users);
      const publicId = u ? u.userId : 'Unknown';
      const fullName = u ? u.fullName : 'Unknown';

      const incDiff = newW.incomeWallet - oldW.incomeWallet;
      const lockedDiff = newW.lockedIncomeWallet - oldW.lockedIncomeWallet;
      const recvDiff = newW.totalReceived - oldW.totalReceived;
      const givenDiff = (newW.totalGiven || 0) - (oldW.totalGiven || 0);
      const debtCreated = (newW.fundRecoveryDue || 0) - (oldW.fundRecoveryDue || 0);

      const totalFakeReceived = oldW.totalReceived > newW.totalReceived ? oldW.totalReceived - newW.totalReceived : 0;
      const totalDue = debtCreated > 0 ? debtCreated : 0;
      const totalRecovered = totalFakeReceived > 0 ? totalFakeReceived - totalDue : 0;
      const totalBefore = oldW.incomeWallet + oldW.lockedIncomeWallet;
      const totalAfter = newW.incomeWallet + newW.lockedIncomeWallet;

      if (incDiff !== 0 || lockedDiff !== 0 || recvDiff !== 0 || givenDiff !== 0 || debtCreated > 0) {
        let status = "Adjusted";
        if (debtCreated > 0) status = "DEBT_CREATED (Spent Fake Funds)";
        
        csvData += `${oldW.userId},${publicId},${fullName},${oldW.incomeWallet.toFixed(2)},${newW.incomeWallet.toFixed(2)},${incDiff.toFixed(2)},${oldW.lockedIncomeWallet.toFixed(2)},${newW.lockedIncomeWallet.toFixed(2)},${lockedDiff.toFixed(2)},${oldW.totalReceived.toFixed(2)},${newW.totalReceived.toFixed(2)},${recvDiff.toFixed(2)},${(oldW.totalGiven || 0).toFixed(2)},${(newW.totalGiven || 0).toFixed(2)},${givenDiff.toFixed(2)},${newW.fundRecoveryDue || 0},${totalFakeReceived.toFixed(2)},${totalRecovered.toFixed(2)},${totalDue.toFixed(2)},${totalBefore.toFixed(2)},${totalAfter.toFixed(2)},${status}\n`;
      }
    }

    const dataDir = path.join(__dirname, '..', 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    // Save projections for Script 2 (nothing deleted, only reversals appended)
    projectedTransactions = projectedTransactions.filter(t => !t._markRemove);
    // Remove internal mapping properties
    projectedTransactions.forEach(t => { delete t._isReversed; });
    
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