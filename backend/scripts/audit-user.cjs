const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function auditUser() {
    const targetId = process.argv[2];
    const backupPath = process.argv[3];

    if (!targetId || !backupPath) {
        console.log('Usage: node scripts/audit-user.cjs [USER_ID] [PATH_TO_BACKUP_JSON]');
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
        console.log(`\n=== Forensic Audit for User ID: ${targetId} ===`);

        // 1. Load Backup State
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        const searchId = String(targetId).trim();

        const findInList = (list) => {
            return list.find(u => 
                String(u.userId) === searchId || 
                String(u.publicUserId) === searchId ||
                String(u.fullName || '').toLowerCase().includes(searchId.toLowerCase())
            );
        };

        const oldWallet = findInList(backupData.wallets || []);
        
        // 2. Load Live State
        const [rows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");
        const liveWallets = JSON.parse(rows[0].state_value || '[]');
        const liveWallet = findInList(liveWallets);

        if (!oldWallet) {
            console.log(`Error: Could not find user "${targetId}" in the BACKUP file.`);
            return;
        }
        if (!liveWallet) {
            console.log(`Error: Could not find user "${targetId}" in the LIVE database.`);
            return;
        }

        console.log(`User Found: ${liveWallet.fullName} (ID: ${liveWallet.userId})`);

        console.log(`\nWALLET BALANCES:`);
        console.log(`--------------------------------------------------`);
        console.log(`Type            | BEFORE       | AFTER        | DIFF`);
        console.log(`--------------------------------------------------`);
        
        const formatRow = (label, oldV, newV) => {
            const diff = (newV || 0) - (oldV || 0);
            const diffStr = diff === 0 ? '0.00' : (diff > 0 ? `+${diff.toFixed(2)}` : `${diff.toFixed(2)}`);
            console.log(`${label.padEnd(15)} | $${(oldV || 0).toFixed(2).padEnd(11)} | $${(newV || 0).toFixed(2).padEnd(11)} | ${diffStr}`);
        };

        formatRow('Income Wallet', oldWallet.incomeWallet, liveWallet.incomeWallet);
        formatRow('Matrix Wallet', oldWallet.matrixWallet, liveWallet.matrixWallet);
        formatRow('Recovery Due', oldWallet.fundRecoveryDue, liveWallet.fundRecoveryDue);
        formatRow('Total Received', oldWallet.totalReceived, liveWallet.totalReceived);
        formatRow('Total Given', oldWallet.totalGiven, liveWallet.totalGiven);
        console.log(`--------------------------------------------------`);

        const diff = (liveWallet.incomeWallet || 0) - (oldWallet.incomeWallet || 0);
        if (diff < 0) {
            console.log(`\n✅ VERIFIED: The user's balance was successfully DEBITED by $${Math.abs(diff).toFixed(2)}.`);
        } else if (diff === 0) {
            console.log(`\n⚠️  NOTICE: No change in visible balance (maybe this user overspent and went into debt?).`);
        }

        if ((liveWallet.fundRecoveryDue || 0) > (oldWallet.fundRecoveryDue || 0)) {
            const debtInc = (liveWallet.fundRecoveryDue || 0) - (oldWallet.fundRecoveryDue || 0);
            console.log(`✅ VERIFIED: User overspent fake money. Added $${debtInc.toFixed(2)} to Recovery Due (Debt).`);
        }

    } catch (e) {
        console.error('Audit failed:', e);
    } finally {
        pool.end();
    }
}

auditUser();
