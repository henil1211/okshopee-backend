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
        
        // Helper to handle ID format inconsistencies (numbers vs user_ prefix)
        const normalizeId = (id) => {
            if (!id) return '';
            return String(id).replace('user_', '').trim();
        };

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

        // 4. Discovery Phase: Build a map from Backup Identities to Backup IDs
        console.log("Discovery Phase: Mapping identities from backup transactions...");
        const backupIdentityMap = new Map(); // Key: PublicId or Name -> Value: Internal Backup ID
        
        for (const tx of oldTxs) {
            // Pattern: "Name (PublicId)"
            const match = String(tx.description).match(/(.*?)\s?\((.*?)\)/);
            if (match) {
                const nameInTx = match[1].trim();
                const publicIdInTx = match[2].trim();
                backupIdentityMap.set(nameInTx.toLowerCase(), tx.userId);
                backupIdentityMap.set(publicIdInTx, tx.userId);
            }
            if (tx.userId) {
                backupIdentityMap.set(normalizeId(tx.userId), tx.userId);
            }
        }

        // 5. Compare and Build Report
        const reportData = [];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `full-financial-audit-${timestamp}.csv`);

        let affectedCount = 0;

        console.log("Comparing Users (Identity-Discovery Search)...");

        for (const user of liveUsers) {
            const liveNormId = normalizeId(user.userId);
            const liveW = liveWallets.find(w => normalizeId(w.userId) === liveNormId);
            
            // Link to Backup ID
            const backupId = 
                backupIdentityMap.get(String(user.publicUserId)) || 
                backupIdentityMap.get(String(user.fullName).toLowerCase()) ||
                backupIdentityMap.get(liveNormId);

            let oldW = null;
            if (backupId) {
                oldW = oldWallets.find(w => String(w.userId) === String(backupId));
            } else {
                // Last ditch effort: direct match in backup wallets
                oldW = oldWallets.find(w => normalizeId(w.userId) === liveNormId);
            }

            if (!oldW || !liveW) continue;

            const diffIncome = Number(liveW.incomeWallet || 0) - Number(oldW.incomeWallet || 0);
            const diffActivation = Number(liveW.activationWallet || 0) - Number(oldW.activationWallet || 0);
            const diffRecovery = Number(liveW.fundRecoveryDue || 0) - Number(oldW.fundRecoveryDue || 0);

            // Print some debugging for Kiran or others if needed
            if (user.publicUserId === '1330217' || user.fullName.includes('Kiran')) {
                console.log(`Matched Kiran: LiveID=${user.userId}, BackupID=${backupId}, Diff=${diffIncome}`);
            }

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
