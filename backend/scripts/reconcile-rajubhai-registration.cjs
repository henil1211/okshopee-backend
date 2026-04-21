const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { randomUUID } = require('node:crypto');

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0
  });

  const connection = await pool.getConnection();

  try {
    const targetUserId = 121; // Rajubhai (7958187)
    const targetGlId = 377;   // Rajubhai Income GL
    const suspenseGlId = 4;   // System Suspense Account
    const amountCents = 2000; // $20.00 total for 2 referrals
    const txUuid = randomUUID();
    const idempotencyKey = `RECONCILE-${randomUUID()}`;

    console.log(`Starting reconciliation for Rajubhai (ID: ${targetUserId})...`);

    await connection.beginTransaction();

    // 1. Create Idempotency Key record (requirement for foreign key)
    await connection.execute(
      `INSERT INTO v2_idempotency_keys 
        (idempotency_key, endpoint_name, actor_user_id, status, request_hash)
       VALUES (?, 'manual_repair', 1, 'completed', 'N/A')`,
      [idempotencyKey]
    );

    // 2. Create Ledger Transaction
    const [txnResult] = await connection.execute(
      `INSERT INTO v2_ledger_transactions 
        (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id, reference_type, reference_id, description, total_debit_cents, total_credit_cents)
       VALUES 
        (?, 'v2', 'admin_adjustment', 'posted', ?, 1, 'manual_repair', 'RAJUBHAI_REG_RECONCILE', ?, ?, ?)`,
      [
        txUuid,
        idempotencyKey,
        `Missing registration income reconcile ($5 referral + $5 help) for राजू 1 and राजू 2`,
        amountCents,
        amountCents
      ]
    );
    const ledgerTxnId = txnResult.insertId;

    // 3. Create Ledger Entries
    // Debit Suspense
    await connection.execute(
      `INSERT INTO v2_ledger_entries 
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES (?, 1, ?, NULL, NULL, 'debit', ?)`,
      [ledgerTxnId, suspenseGlId, amountCents]
    );

    // Credit User Income Wallet
    await connection.execute(
      `INSERT INTO v2_ledger_entries 
        (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
       VALUES (?, 2, ?, ?, 'income', 'credit', ?)`,
      [ledgerTxnId, targetGlId, targetUserId, amountCents]
    );

    // 4. Update Wallet Account Balance
    const [walletResult] = await connection.execute(
      `UPDATE v2_wallet_accounts 
       SET current_amount_cents = current_amount_cents + ?, version = version + 1
       WHERE user_id = ? AND wallet_type = 'income'`,
      [amountCents, targetUserId]
    );

    if (walletResult.affectedRows === 0) {
      throw new Error(`Failed to update income wallet for user ${targetUserId}`);
    }

    await connection.commit();
    console.log(`Successfully credited $20.00 to Rajubhai (121).`);
    console.log(`Ledger Transaction ID: ${ledgerTxnId}`);
    console.log(`Transaction UUID: ${txUuid}`);
    console.log(`Idempotency Key: ${idempotencyKey}`);

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Transaction failed:', err);
  } finally {
    if (connection) connection.release();
    pool.end();
  }
}

main();
