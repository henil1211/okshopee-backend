const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runAudit() {
    console.log("Starting Forensic Audit & Cleanup...");
    
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    try {
        // 1. Load Everything
        const [uRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
        const [tRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_transactions'");
        const [wRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");

        let users = JSON.parse(uRow[0].state_value || '[]');
        let transactions = JSON.parse(tRow[0].state_value || '[]');
        let wallets = JSON.parse(wRow[0].state_value || '[]');

        console.log(`Loaded ${users.length} users and ${wallets.length} wallets.`);

        // 2. Take Balance Snapshot (BEFORE)
        const beforeBalances = new Map();
        wallets.forEach(w => {
            beforeBalances.set(w.userId, {
                income: w.incomeWallet || 0,
                activation: w.activationWallet || 0,
                locked: w.lockedIncomeWallet || 0,
                total: w.totalIncome || 0
            });
        });

        // 3. APPLY AGGRESSIVE CLEANUP LOGIC
        let ghostReversed = 0;
        let dupReversed = 0;

        const validInternalIds = new Set(users.map(u => u.id));

        // --- PHASE 1: Real Ghost Eradication (In case some are still missing) ---
        for (const tx of transactions) {
            if (tx.status !== 'completed') continue;
            if (!validInternalIds.has(tx.userId)) continue; // Recipient must exist

            if (tx.fromUserId && !validInternalIds.has(tx.fromUserId)) {
                // Check if fromUserId is a 7-digit ID instead of internal ID
                const fromUserObj = users.find(u => u.userId === tx.fromUserId);
                if (!fromUserObj) {
                    ghostReversed++;
                    reverseTransaction(tx, wallets, users, "Orphaned Sender (Ghost)");
                }
            }
        }

        // --- PHASE 2: Time-Windowed Duplicate Detection (The "Fake Money" Fix) ---
        console.log("Analyzing for duplicate income clusters...");
        const groups = new Map(); // Key: recipient_amount_normalizedDesc
        
        for (const tx of transactions) {
            if (tx.status !== 'completed' || tx.amount <= 0) continue;
            if (tx.type !== 'receive_help' && tx.type !== 'direct_income') continue;

            // Normalize description to find patterns like "Income from X"
            const desc = (tx.description || '').replace(/\d{10,}/g, '').trim(); 
            const key = `${tx.userId}_${tx.amount}_${desc}`;
            
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(tx);
        }

        for (const [key, txs] of groups.entries()) {
            if (txs.length > 1) {
                // Cluster by time (within 10 minutes)
                txs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                
                let lastTime = 0;
                for (let i = 1; i < txs.length; i++) {
                    const currentTime = new Date(txs[i].createdAt).getTime();
                    const prevTime = new Date(txs[i-1].createdAt).getTime();
                    
                    if (currentTime - prevTime < 10 * 60 * 1000) { // 10 minute window
                        dupReversed++;
                        reverseTransaction(txs[i], wallets, users, "Duplicate Systematic Entry");
                    }
                }
            }
        }

        // 4. Generate Audit Comparison Report (FULL USER LIST)
        console.log("Generating Comprehensive Audit Report...");
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportData = [];

        for (const user of users) {
            const before = beforeBalances.get(user.id) || beforeBalances.get(user.userId) || { income: 0, activation: 0, locked: 0, total: 0 };
            const wallet = wallets.find(w => w.userId === user.id || w.userId === user.userId) || {};
            
            const incomeDiff = (wallet.incomeWallet || 0) - before.income;
            
            // Log ALL users who have a balance, to provide a complete report
            if (before.income > 0 || (wallet.incomeWallet || 0) > 0 || before.activation > 0 || before.locked > 0) {
                reportData.push({
                    'Public ID': user.userId || user.publicUserId || 'N/A',
                    'Name': user.fullName || user.username || 'Unknown',
                    'Income BEFORE': before.income.toFixed(2),
                    'Income AFTER': (wallet.incomeWallet || 0).toFixed(2),
                    'Income DIFF': incomeDiff.toFixed(2),
                    'Deposit/Fund': (wallet.activationWallet || 0).toFixed(2),
                    'Locked Income': (wallet.lockedIncomeWallet || 0).toFixed(2),
                    'Total Earned': (wallet.totalIncome || 0).toFixed(2)
                });
            }
        }

        // 5. Save Report to CSV
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `FINAL-VERIFIED-AUDIT-${timestamp}.csv`);

        const headers = Object.keys(reportData[0]).join(',');
        const rows = reportData.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
        await fs.writeFile(reportPath, headers + '\n' + rows);

        // 6. Save Data back to Database
        console.log(`Saving fixed data to database...`);
        await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'", [JSON.stringify(transactions)]);
        await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'", [JSON.stringify(wallets)]);

        console.log(`\n=== AUDIT COMPLETE ===`);
        console.log(`Total Adjustments Made: ${ghostReversed + dupReversed}`);
        console.log(`Report created: ${reportPath}`);
        console.log(`You can now open this file in Excel to see the EXACT changes.`);

        function reverseTransaction(tx, wallets, users, reason) {
            const amt = Math.abs(tx.amount || 0);
            const w = wallets.find(wal => wal.userId === tx.userId);
            if (w) {
                w.incomeWallet -= amt;
                w.totalReceived -= amt;
                if (w.incomeWallet < 0) {
                    w.fundRecoveryDue = (w.fundRecoveryDue || 0) + Math.abs(w.incomeWallet);
                    w.incomeWallet = 0;
                }
            }
            tx.status = 'reversed';
            tx.description = `${tx.description} [REVERSED: ${reason}]`;
        }
        console.log(`You can now open this file in Excel to see the EXACT changes.`);

    } catch (err) {
        console.error("Audit failed:", err);
    } finally {
        await pool.end();
    }
}

runAudit();
