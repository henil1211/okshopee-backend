const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function dumpBackup() {
    const backupPath = process.argv[2];
    if (!backupPath) {
        console.error('Usage: node dump-backup-with-names.cjs <path_to_backup_json>');
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
        console.log("Loading data for Backup Dump...");
        
        // 1. Load Live Users (for naming)
        const [userRows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
        const liveUsers = JSON.parse(userRows[0]?.state_value || '[]');

        // 2. Load Backup Data
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        const oldWallets = backupData.wallets || [];
        const oldTxs = backupData.transactions || [];

        // 4. Discovery Phase: Bridge Old IDs to Real Names/Public IDs
        console.log("Discovery Phase: Bridging backup IDs to identities...");
        const identityBridge = new Map(); // Key: Internal Backup ID -> Value: { name, publicId }
        
        for (const tx of oldTxs) {
            const match = String(tx.description).match(/(.*?)\s?\((.*?)\)/);
            if (match) {
                const nameInTx = match[1].trim();
                const publicIdInTx = match[2].trim();
                
                // Only save the identity if it looks like a real name, not a transaction type
                if (!nameInTx.includes('income') && !nameInTx.includes('help') && !nameInTx.includes('split')) {
                    identityBridge.set(tx.userId, { name: nameInTx, publicId: publicIdInTx });
                }
            }
        }

        // 5. Generate Report from Backup Wallets
        const reportData = [];
        for (const wallet of oldWallets) {
            const id = wallet.userId;
            const normId = normalizeId(id);
            
            // Try to get identity from our transaction bridge
            let identity = identityBridge.get(id);

            // Fallback: If no transaction found, check live users by normalized ID
            if (!identity) {
                const liveU = liveUsers.find(u => normalizeId(u.userId) === normId || String(u.publicUserId) === normId);
                if (liveU) {
                    identity = { name: liveU.fullName, publicId: liveU.publicUserId };
                }
            }

            reportData.push({
                'Internal ID': id,
                'Public ID': identity?.publicId || 'N/A',
                'Name': identity?.name || 'Unknown',
                'Income Wallet': (wallet.incomeWallet || 0).toFixed(2),
                'Deposit (Activation)': (wallet.activationWallet || 0).toFixed(2),
                'Locked Income': (wallet.lockedIncome || 0).toFixed(2),
                'Total Income (Earned)': (wallet.totalIncome || 0).toFixed(2)
            });
        }

        // 6. Save CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `PRE-CLEANUP-DATA-${timestamp}.csv`);

        if (reportData.length === 0) {
            console.log("No data found in backup JSON!");
            return;
        }

        const headers = Object.keys(reportData[0]).join(',');
        const rows = reportData.map(row => 
            Object.values(row).map(val => `"${val}"`).join(',')
        ).join('\n');
        
        await fs.writeFile(reportPath, headers + '\n' + rows);
        
        console.log(`\nSUCCESS! Backup Dump created.`);
        console.log(`Total Wallets Found in Backup: ${reportData.length}`);
        console.log(`Report location: ${reportPath}`);
        console.log(`\nYou can now open this file in Excel to see everyone's balance.`);

    } catch (error) {
        console.error("Dump failed:", error);
    } finally {
        await pool.end();
    }
}

dumpBackup();
