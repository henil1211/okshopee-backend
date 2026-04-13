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

        // 3. Normalization Helper
        const normalizeId = (id) => String(id || '').replace('user_', '').trim();

        // 4. Build Identity Map from Backup Transactions (The most reliable way)
        const backupIdentityMap = new Map(); 
        for (const tx of oldTxs) {
            const match = String(tx.description).match(/(.*?)\s?\((.*?)\)/);
            if (match) {
                const nameInTx = match[1].trim();
                const publicIdInTx = match[2].trim();
                backupIdentityMap.set(normalizeId(tx.userId), { name: nameInTx, publicId: publicIdInTx });
            }
        }

        // 5. Generate Report
        const reportData = [];
        for (const wallet of oldWallets) {
            const normId = normalizeId(wallet.userId);
            
            // Try to get name from transaction history map
            let identity = backupIdentityMap.get(normId);

            // Fallback: Try to get name from live users
            if (!identity) {
                const liveU = liveUsers.find(u => normalizeId(u.userId) === normId || String(u.publicUserId) === normId);
                if (liveU) {
                    identity = { name: liveU.fullName, publicId: liveU.publicUserId };
                }
            }

            reportData.push({
                'Internal ID': wallet.userId,
                'Public ID': identity?.publicId || 'Unknown',
                'Name': identity?.name || 'Unknown User',
                'Income Wallet': wallet.incomeWallet || 0,
                'Activation Wallet': wallet.activationWallet || 0,
                'Debt (Recovery)': wallet.fundRecoveryDue || 0
            });
        }

        // 6. Save CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportDir = path.join(__dirname, '..', 'data', 'reports');
        await fs.mkdir(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `backup-data-dump-${timestamp}.csv`);

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
