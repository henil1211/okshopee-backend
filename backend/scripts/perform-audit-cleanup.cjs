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

        // 3. APPLY FULL CLEANUP LOGIC (Phases 1-5)
        let ghostReversed = 0;
        let dupDirectReversed = 0;
        let dupHelpReversed = 0;
        let matrixCascaded = 0;

        const validUserIds = new Set(users.map(u => u.userId));
        const validInternalIds = new Set(users.map(u => u.id));

        // Helper to resolve user
        const resolveUser = (ref) => users.find(u => u.id === ref || u.userId === ref);

        // --- PHASE 1: Ghost Help Eradication ---
        for (const tx of transactions) {
            if (tx.status !== 'completed') continue;

            if ((tx.type === 'receive_help' || tx.type === 'direct_income') && tx.fromUserId) {
                if (!validUserIds.has(tx.fromUserId) && !validInternalIds.has(tx.fromUserId)) {
                    ghostReversed++;
                    reverseTransaction(tx, wallets, users, "Ghost Help");
                }
            }
        }

        // --- PHASE 2/3: Duplicate Direct Income ---
        const directIncomes = transactions.filter(tx => tx.type === 'direct_income' && tx.status === 'completed');
        const groupedIncomes = new Map();
        for (const tx of directIncomes) {
            const key = `${tx.userId}__${tx.fromUserId || tx.description}`;
            if (!groupedIncomes.has(key)) groupedIncomes.set(key, []);
            groupedIncomes.get(key).push(tx);
        }

        for (const [key, txs] of groupedIncomes.entries()) {
            if (txs.length > 1) {
                txs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                for (let i = 1; i < txs.length; i++) {
                    dupDirectReversed++;
                    reverseTransaction(txs[i], wallets, users, "Duplicate Direct Income");
                }
            }
        }

        // --- PHASE 4/5: Audit Trace ---
        console.log("Cleanup logic applied. Comparing final balances...");

        // 4. Generate Audit Comparison Report
        const reportData = [];
        for (const user of users) {
            const before = beforeBalances.get(user.id) || beforeBalances.get(user.userId) || { income: 0, activation: 0, locked: 0, total: 0 };
            const wallet = wallets.find(w => w.userId === user.id || w.userId === user.userId) || {};
            
            const incomeDiff = (wallet.incomeWallet || 0) - before.income;
            
            if (incomeDiff !== 0) {
                reportData.push({
                    'Public ID': user.publicUserId,
                    'Name': user.fullName,
                    'Income BEFORE': before.income.toFixed(2),
                    'Income AFTER': (wallet.incomeWallet || 0).toFixed(2),
                    'Income DIFF': incomeDiff.toFixed(2),
                    'Deposit/Fund': (wallet.activationWallet || 0).toFixed(2),
                    'Locked Income': (wallet.lockedIncomeWallet || 0).toFixed(2),
                    'Total Earned': (wallet.totalIncome || 0).toFixed(2)
                });
            }
        }

        // (Add helper at the end of function)
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

        // 5. Save Report to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `FORENSIC-AUDIT-REPORT-${timestamp}.csv`);

        const headers = Object.keys(reportData[0]).join(',');
        const rows = reportData.map(row => Object.values(row).map(v => `"${v}"`).join(',')).join('\n');
        await fs.writeFile(reportPath, headers + '\n' + rows);

        // 6. Save Data back to Database
        console.log(`Saving fixed data to database...`);
        await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_transactions'", [JSON.stringify(transactions)]);
        await pool.query("UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_wallets'", [JSON.stringify(wallets)]);

        console.log(`\n=== AUDIT COMPLETE ===`);
        console.log(`Transactions Reversed: ${reversedCount}`);
        console.log(`Report created: ${reportPath}`);
        console.log(`You can now open this file in Excel to see the EXACT changes.`);

    } catch (err) {
        console.error("Audit failed:", err);
    } finally {
        await pool.end();
    }
}

runAudit();
