import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

/**
 * RECONCILE V2 HELP STATE
 * This script identifies users where the summary state (v2_help_level_state.given_cents)
 * is GREATER than the actual processed transaction history.
 * It resets the state to match the history to allow the repair script to find the gaps.
 */

async function main() {
    const isDryRun = process.argv.includes('--dry') || !process.argv.includes('--apply');
    
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        console.log(`[Reconciliation] Running in ${isDryRun ? 'DRY RUN' : 'APPLY'} mode...`);

        // 1. Find all levels where state > history (including those with 0 history)
        const [mismatches] = await pool.query(`
            SELECT 
                s.id as state_id,
                s.user_id,
                u.user_code,
                u.full_name,
                s.level_no,
                s.given_cents as state_given_cents,
                IFNULL(CAST(h.history_given_cents AS UNSIGNED), 0) as history_given_cents
            FROM v2_help_level_state s
            JOIN v2_users u ON s.user_id = u.id
            LEFT JOIN (
                SELECT 
                    source_user_id, 
                    level_no, 
                    SUM(amount_cents) as history_given_cents 
                FROM v2_help_pending_contributions 
                WHERE status = 'processed' 
                GROUP BY source_user_id, level_no
            ) h ON s.user_id = h.source_user_id AND s.level_no = h.level_no
            WHERE s.given_cents > IFNULL(h.history_given_cents, 0)
        `);

        if (mismatches.length === 0) {
            console.log('No state/history mismatches found. Database is consistent.');
            return;
        }

        console.log(`Found ${mismatches.length} mismatches.`);
        console.table(mismatches);

        if (isDryRun) {
            console.log('\n[DRY RUN] Would update these states to match history.');
            return;
        }

        // 2. Apply corrections
        for (const m of mismatches) {
            console.log(`Fixing ${m.full_name} (${m.user_code}) Level ${m.level_no}: ${m.state_given_cents} -> ${m.history_given_cents}`);
            await pool.query(
                'UPDATE v2_help_level_state SET given_cents = ?, updated_at = NOW() WHERE id = ?',
                [m.history_given_cents, m.state_id]
            );
        }

        console.log('\n[SUCCESS] All summary states reconciled with transaction history.');

    } catch (error) {
        console.error('Error during reconciliation:', error);
    } finally {
        await pool.end();
    }
}

main();
