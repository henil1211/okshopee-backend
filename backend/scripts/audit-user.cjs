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

        // 1. Resolve User from Live DB first (to get the mapping)
        const [userRows] = await pool.query(
            "SELECT userId, publicUserId, fullName, email FROM users WHERE userId = ? OR publicUserId = ? OR email = ?",
            [targetId, targetId, targetId]
        );

        if (userRows.length === 0) {
            console.log(`Error: Could not find user "${targetId}" in the LIVE database.`);
            return;
        }

        const user = userRows[0];
        const internalId = user.userId;
        console.log(`User Identified: ${user.fullName} (Internal ID: ${internalId}, Public ID: ${user.publicUserId})`);

        // 2. Load Backup State
        const backupData = JSON.parse(await fs.readFile(backupPath, 'utf8'));
        const oldWallet = (backupData.wallets || []).find(w => String(w.userId) === String(internalId));
        
        // 3. Load Live State
        const [rows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");
        const liveWallets = JSON.parse(rows[0].state_value || '[]');
        const liveWallet = liveWallets.find(w => String(w.userId) === String(internalId));

        if (!oldWallet) {
            console.log(`Error: User found in DB but could NOT be found in this specific backup file.`);
            return;
        }
        if (!liveWallet) {
            console.log(`Error: Wallet for ${user.fullName} is missing in the live state_store.`);
            return;
        }

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
