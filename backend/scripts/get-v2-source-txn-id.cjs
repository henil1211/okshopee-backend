#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

async function main() {
  const userCode = String(process.argv[2] || '1000001').trim();
  if (!userCode) {
    console.error('Usage: node scripts/get-v2-source-txn-id.cjs <sourceUserCode>');
    process.exit(1);
  }

  const envPath = path.resolve(__dirname, '..', '.env');
  dotenv.config({ path: envPath });

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'okshopee24';

  const conn = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [userRows] = await conn.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1`,
      [userCode]
    );

    const sourceUser = Array.isArray(userRows) ? userRows[0] : null;
    if (!sourceUser) {
      console.error(`Source user not found in v2_users: ${userCode}`);
      process.exit(2);
    }

    const [txRows] = await conn.execute(
      `SELECT id, tx_type, status, created_at
       FROM v2_ledger_transactions
       WHERE initiator_user_id = ?
         AND status = 'posted'
       ORDER BY id DESC
       LIMIT 1`,
      [sourceUser.id]
    );

    const txn = Array.isArray(txRows) ? txRows[0] : null;
    if (!txn) {
      console.error(`No posted v2 ledger transaction found for sourceUserCode=${userCode}`);
      process.exit(3);
    }

    console.log(`SOURCE_USER_CODE=${sourceUser.user_code}`);
    console.log(`SOURCE_USER_STATUS=${sourceUser.status}`);
    console.log(`SOURCE_TXN_ID=${txn.id}`);
    console.log(`SOURCE_TXN_TYPE=${txn.tx_type}`);
    console.log(`SOURCE_TXN_STATUS=${txn.status}`);
    console.log(`SOURCE_TXN_CREATED_AT=${txn.created_at}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
