const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function generateFullReport() {
    const backupPath = process.argv[2];
    if (!backupPath) {
        console.error('Usage: node generate-full-audit-report.cjs <path_to_backup_json>');
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: Number(process.env.MYSQL_PORT) || 3306
    });

    try {
        console.log("Starting Full Forensic Audit...");
        
        // 1. Load Live Data
        const [userRows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
        const [walletRows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");
        
        const liveUsers = JSON.parse(userRows[0]?.state_value || '[]');
        const liveWallets = JSON.parse(walletRows[0]?.state_value || '[]');

        // 2. Load Backup Data
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        const oldWallets = backupData.wallets || [];
        const oldTxs = backupData.transactions || [];

        console.log(`Loaded ${liveUsers.length} live users and ${oldWallets.length} users from backup.`);

        // 3. Normalization Helper
        const normalizeId = (id) => String(id).replace('user_', '').trim();
        
        // Create a map of live data for easy lookup
        const liveMap = new Map();
        liveWallets.forEach(w => {
            liveMap.set(normalizeId(w.userId), w);
        });

        // 4. Compare and Build Report
        const reportData = [];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `full-financial-audit-${timestamp}.csv`);

        let affectedCount = 0;

        for (const user of liveUsers) {
            const normId = normalizeId(user.userId);
            const liveW = liveMap.get(normId);
            
            // Try to find in backup
            const oldW = oldWallets.find(w => normalizeId(w.userId) === normId);

            if (!oldW || !liveW) continue;

            const diffIncome = (liveW.incomeWallet || 0) - (oldW.incomeWallet || 0);
            const diffActivation = (liveW.activationWallet || 0) - (oldW.activationWallet || 0);
            const diffRecovery = (liveW.fundRecoveryDue || 0) - (oldW.fundRecoveryDue || 0);

            // Only include in report if there is a difference
            if (diffIncome !== 0 || diffActivation !== 0 || diffRecovery !== 0) {
                affectedCount++;
                reportData.push({
                    'Public ID': user.publicUserId || user.userId,
                    'Name': user.fullName,
                    'Old Income': oldW.incomeWallet || 0,
                    'New Income': liveW.incomeWallet || 0,
                    'Income Diff': diffIncome,
                    'Old Activation': oldW.activationWallet || 0,
                    'New Activation': liveW.activationWallet || 0,
                    'Activation Diff': diffActivation,
                    'Old Debt (Recovery)': oldW.fundRecoveryDue || 0,
                    'New Debt (Recovery)': liveW.fundRecoveryDue || 0,
                    'Debt Diff': diffRecovery
                });
            }
        }

        // 5. Generate CSV
        if (reportData.length > 0) {
            const headers = Object.keys(reportData[0]).join(',');
            const rows = reportData.map(row => 
                Object.values(row).map(val => `"${val}"`).join(',')
            ).join('\n');
            
            await fs.writeFile(reportPath, headers + '\n' + rows);
            console.log(`\nSUCCESS! Audit Complete.`);
            console.log(`Total Affected Users Found: ${affectedCount}`);
            console.log(`Report generated at: ${reportPath}`);
            console.log(`\nYou can now open this file in Excel.`);
        } else {
            console.log("\nNo financial differences found between backup and live database.");
        }

    } catch (error) {
        console.error("Audit failed:", error);
    } finally {
        await pool.end();
    }
}

generateFullReport();
