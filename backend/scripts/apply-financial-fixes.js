import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function applyFixes() {
  console.log("=== Phase 2: APPLY FIXES & REPAIR DATABASE ===");

  const projectorPath = path.join(__dirname, '..', 'data', 'projected-audit-fixes.json');
  let projectedData;
  try {
    const file = await fs.readFile(projectorPath, 'utf8');
    projectedData = JSON.parse(file);
  } catch (e) {
    console.error(`Error: Could not find "backend/data/projected-audit-fixes.json". Please run "node audit-financials.js" first!`);
    return;
  }

  const { transactions, wallets } = projectedData;

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    waitForConnections: true,
  });

  try {
    console.log("Loading current Live state to create a backup before applying fixes...");
    const [txsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_transactions'");
    const [walletsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_wallets'");

    if (!txsRow.length || !walletsRow.length) throw new Error("Could not retrieve original live data for backup!");

    // BACKUP OLD ONES just in case (Before taking action)
    const backupDir = path.join(__dirname, '..', 'data', 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    // timestamp formatting
    const d = new Date();
    const backupName = `pre-fix-backup-${d.toISOString().replace(/T/, '-').replace(/:/g, '-').split('.')[0]}.json`;
    
    await fs.writeFile(path.join(backupDir, backupName), JSON.stringify({
      transactions: JSON.parse(txsRow[0].state_value || '[]'),
      wallets: JSON.parse(walletsRow[0].state_value || '[]')
    }));

    console.log(`✅ Success: Live Database backup generated at 'backend/data/backups/${backupName}'`);

    // 2. NOW APPLY THE NEW PROJECTED STATE
    console.log("\nApplying Fixed Data to Live Database...");
    
    function toMySQLDatetime(isoString) {
      if (!isoString) return null;
      return isoString.replace('T', ' ').replace('Z', '');
    }
    const updateTime = toMySQLDatetime(new Date().toISOString());

    await pool.query("UPDATE state_store SET state_value = ?, updated_at = ? WHERE state_key = 'mlm_transactions'", [JSON.stringify(transactions), updateTime]);
    await pool.query("UPDATE state_store SET state_value = ?, updated_at = ? WHERE state_key = 'mlm_wallets'", [JSON.stringify(wallets), updateTime]);

    console.log("✅ FINISHED! All financial fixes, ghost eliminations, and wallet reversals have been applied to the live database.");

  } catch (err) {
    console.error("\n❌ FAILED TO APPLY:", err);
  } finally {
    pool.end();
  }
}

applyFixes();