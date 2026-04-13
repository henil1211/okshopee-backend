import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const backupFilename = process.argv[2];
  if (!backupFilename) {
    console.error('Error: Please provide the backup filename as an argument.');
    console.error('Example: node scripts/restore-from-backup.js pre-cleanup-backup-2026-04-13T12-30-00.json');
    return;
  }

  const backupPath = path.join(__dirname, '..', 'data', 'backups', backupFilename);
  
  try {
    const rawData = await fs.readFile(backupPath, 'utf8');
    const backupData = JSON.parse(rawData);

    if (!backupData.transactions || !backupData.wallets) {
       console.error('Error: Invalid backup file format.');
       return;
    }

    console.log(`Connecting to database to restore ${backupFilename}...`);

    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'okshopee24',
      waitForConnections: true,
    });

    console.log(`Restoring mlm_transactions (${backupData.transactions.length} records)...`);
    await pool.query("UPDATE state_store SET state_value = ? WHERE state_key = 'mlm_transactions'", [JSON.stringify(backupData.transactions)]);
    
    console.log(`Restoring mlm_wallets (${backupData.wallets.length} records)...`);
    await pool.query("UPDATE state_store SET state_value = ? WHERE state_key = 'mlm_wallets'", [JSON.stringify(backupData.wallets)]);

    console.log('\n[SUCCESS] Production Database fully restored to backup state.');
    pool.end();
  } catch (err) {
    console.error('Restoration Failed:', err);
  }
}

run();
