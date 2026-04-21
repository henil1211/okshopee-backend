import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

/**
 * SYNC V2 MATRIX FROM LEGACY
 * This script reads the JSON matrix from state_store (legacy system)
 * and ensures every node is present in the v2_matrix_nodes table.
 */

function safeParseJSON(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
}

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
        console.log(`[Matrix Sync] Running in ${isDryRun ? 'DRY RUN' : 'APPLY'} mode...`);

        // 1. Get legacy matrix
        const [rows] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_matrix'");
        if (rows.length === 0) {
            console.log('No legacy matrix found in state_store.');
            return;
        }

        const legacyMatrix = safeParseJSON(rows[0].state_value);
        if (!Array.isArray(legacyMatrix)) {
            console.log('Legacy matrix is not a valid array.');
            return;
        }

        console.log(`Processing ${legacyMatrix.length} legacy matrix nodes...`);

        for (const node of legacyMatrix) {
            const userCode = String(node.userId || '').trim();
            const parentUserCode = String(node.parentId || '').trim();
            const matrixLevel = Number(node.level || 0);
            const position = Number(node.position) === 0 ? 'left' : Number(node.position) === 1 ? 'right' : null;
            const isActive = node.isActive ? 1 : 0;

            if (!userCode) continue;

            if (isDryRun) {
                // Just log if missing
                const [v2Rows] = await pool.query('SELECT user_code FROM v2_matrix_nodes WHERE user_code = ?', [userCode]);
                if (v2Rows.length === 0) {
                    console.log(`- [DRY RUN] Would sync ${userCode} (Parent: ${parentUserCode || 'None'})`);
                }
            } else {
                await pool.query(`
                    INSERT INTO v2_matrix_nodes 
                    (user_code, parent_user_code, matrix_level, position, is_active)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                    parent_user_code = VALUES(parent_user_code),
                    matrix_level = VALUES(matrix_level),
                    position = VALUES(position),
                    is_active = VALUES(is_active)
                `, [userCode, parentUserCode || null, matrixLevel, position, isActive]);
            }
        }

        console.log('\n[SUCCESS] Matrix sync complete.');

    } catch (error) {
        console.error('Error during matrix sync:', error);
    } finally {
        await pool.end();
    }
}

main();
