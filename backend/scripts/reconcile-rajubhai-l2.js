import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const connection = await pool.getConnection();
  const apply = process.argv.includes('--apply');

  try {
    console.log(`Starting reconciliation for Rajubhai (121) Level 2... [Mode: ${apply ? 'APPLY' : 'DRY-RUN'}]`);
    await connection.beginTransaction();

    // 1. Identify transactions to delete
    const itemsToDelete = [46, 76, 167]; // IDs of $5 fragments/overpayments
    console.log(`Step 1: Deleting duplicate/overpayment contributions: ${itemsToDelete.join(', ')}`);
    
    if (apply) {
      for (const id of itemsToDelete) {
        // Find ledger transaction ID before deleting
        const [rows] = await connection.execute('SELECT processed_txn_id FROM v2_help_pending_contributions WHERE id = ?', [id]);
        const txnId = rows[0]?.processed_txn_id;
        if (txnId) {
          // Nullify reference in contribution table first to avoid FK error
          await connection.execute('UPDATE v2_help_pending_contributions SET processed_txn_id = NULL WHERE id = ?', [id]);
          await connection.execute('DELETE FROM v2_ledger_entries WHERE ledger_txn_id = ?', [txnId]);
          await connection.execute('DELETE FROM v2_ledger_transactions WHERE id = ?', [txnId]);
        }
        await connection.execute('DELETE FROM v2_help_pending_contributions WHERE id = ?', [id]);
      }
    }

    // 2. Update remaining contributions
    console.log('Step 2: Updating source contributions to $10.00 and fixing reasons...');
    const updates = [
      { id: 56, cents: 1000, reason: 'locked_for_give' },    // Raju 4
      { id: 198, cents: 1000, reason: 'locked_for_give' },   // Raju 3
      { id: 199, cents: 1000, reason: 'income_credited' }   // Raju 5
    ];

    if (apply) {
      for (const upd of updates) {
        await connection.execute(
          'UPDATE v2_help_pending_contributions SET amount_cents = ?, reason = ? WHERE id = ?',
          [upd.cents, upd.reason, upd.id]
        );
        // Also update ledger transaction total if it exists
        const [rows] = await connection.execute('SELECT processed_txn_id FROM v2_help_pending_contributions WHERE id = ?', [upd.id]);
        const txnId = rows[0]?.processed_txn_id;
        if (txnId) {
            await connection.execute(
                'UPDATE v2_ledger_transactions SET total_debit_cents = ?, total_credit_cents = ? WHERE id = ?',
                [upd.cents, upd.cents, txnId]
            );
        }
      }
    }

    // 3. Fix Rajubhai Level State
    console.log('Step 3: Correcting v2_help_level_state for Rajubhai (Level 2)...');
    if (apply) {
      await connection.execute(
        `UPDATE v2_help_level_state 
         SET receive_count = 3,
             receive_total_cents = 3000,
             locked_first_two_cents = 2000,
             income_credited_cents = 1000,
             safety_deducted_cents = 0,
             pending_give_cents = 2000,
             last_event_seq = last_event_seq + 1,
             updated_at = NOW(3)
         WHERE user_id = 121 AND level_no = 2`,
      );
    }

    // 4. Adjust Wallet
    console.log('Step 4: Adjusting Rajubhai wallet balance (Removing $10 overpayment)...');
    if (apply) {
      await connection.execute(
        `UPDATE v2_wallet_accounts 
         SET current_amount_cents = 1000, version = version + 1 
         WHERE user_id = 121 AND wallet_type = 'income'`,
      );
    }

    if (apply) {
      await connection.commit();
      console.log('Successfully applied reconciliation for Rajubhai.');
    } else {
      await connection.rollback();
      console.log('Dry-run complete. No changes made.');
    }

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Fatal error during reconciliation:', error);
  } finally {
    connection.release();
    pool.end();
  }
}

main();
