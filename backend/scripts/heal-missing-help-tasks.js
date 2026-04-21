import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

/**
 * HEAL MISSING HELP TASKS
 * This script finds active users who have 0 records in v2_help_pending_contributions
 * and generates their missing Level 1 help tasks (10 levels up in the matrix).
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

    const userCodeArg = process.argv.find(arg => arg.startsWith('--user-code='));
    const targetedUserCode = userCodeArg ? userCodeArg.split('=')[1] : null;

    try {
        console.log(`[Healing] Running in ${isDryRun ? 'DRY RUN' : 'APPLY'} mode...`);

        // 1. Find users with 0 contributions
        let query = `
            SELECT u.id, u.user_code, u.full_name 
            FROM v2_users u 
            LEFT JOIN v2_help_pending_contributions c ON u.id = c.source_user_id 
            WHERE u.status = 'active'
        `;
        const params = [];
        if (targetedUserCode) {
            query += ` AND u.user_code = ?`;
            params.push(targetedUserCode);
        }
        query += ` GROUP BY u.id HAVING COUNT(c.id) = 0`;

        const [users] = await pool.query(query, params);

        if (users.length === 0) {
            console.log('No users found missing help contributions.');
            return;
        }

        console.log(`Found ${users.length} users missing contributions.`);

        for (const user of users) {
            console.log(`\nProcessing ${user.full_name} (${user.user_code})...`);
            
            // Resolve 10 levels of uplines
            let currentUserCode = user.user_code;
            let currentLevel = 1;

            while (currentLevel <= 10) {
                // Find parent and side from v2_matrix_nodes
                const [matrixRows] = await pool.query(`
                    SELECT parent_user_code, position
                    FROM v2_matrix_nodes
                    WHERE user_code = ?
                `, [currentUserCode]);

                const matrixNode = matrixRows[0];
                if (!matrixNode || !matrixNode.parent_user_code) {
                    console.log(`  - No more uplines found after Level ${currentLevel - 1}.`);
                    break;
                }

                // Resolve Parent ID
                const [parentUsers] = await pool.query(`
                    SELECT id FROM v2_users WHERE user_code = ?
                `, [matrixNode.parent_user_code]);

                if (parentUsers.length === 0) {
                    console.log(`  - Parent ${matrixNode.parent_user_code} not found in v2_users. Stopping.`);
                    break;
                }

                const beneficiaryId = parentUsers[0].id;
                const side = matrixNode.position || 'unknown';
                const sourceEventKey = `HELP:manual_heal_${user.user_code}_L${currentLevel}`;

                if (isDryRun) {
                    console.log(`  - [DRY RUN] Would create Level ${currentLevel} help to ${matrixNode.parent_user_code} (User ID ${beneficiaryId}, Side: ${side})`);
                } else {
                    await pool.query(`
                        INSERT IGNORE INTO v2_help_pending_contributions
                        (source_event_key, source_user_id, beneficiary_user_id, level_no, side, amount_cents, status)
                        VALUES (?, ?, ?, ?, ?, 500, 'pending')
                    `, [sourceEventKey, user.id, beneficiaryId, currentLevel, side]);
                    console.log(`  - Created Level ${currentLevel} help task.`);
                }

                currentUserCode = matrixNode.parent_user_code;
                currentLevel++;
            }
        }

        if (!isDryRun) {
            console.log('\n[SUCCESS] Missing transactions created for all identified users.');
        }

    } catch (error) {
        console.error('Error during healing:', error);
    } finally {
        await pool.end();
    }
}

main();
