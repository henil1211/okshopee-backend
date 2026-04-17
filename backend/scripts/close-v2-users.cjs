#!/usr/bin/env node

const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const args = {
    status: 'closed',
    userCodes: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;

    if (token.startsWith('--status=')) {
      args.status = token.split('=')[1] || args.status;
      continue;
    }

    if (token === '--status') {
      args.status = String(argv[i + 1] || '').trim() || args.status;
      i += 1;
      continue;
    }

    args.userCodes.push(token);
  }

  return args;
}

async function main() {
  const { status, userCodes } = parseArgs(process.argv.slice(2));

  if (!userCodes.length) {
    console.error('Usage: node scripts/close-v2-users.cjs <userCode1> <userCode2> ... [--status closed]');
    process.exit(1);
  }

  const normalizedStatus = String(status || '').trim().toLowerCase();
  const allowedStatuses = new Set(['active', 'blocked', 'closed']);
  if (!allowedStatuses.has(normalizedStatus)) {
    console.error(`Invalid status: ${status}. Allowed: active, blocked, closed`);
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectTimeout: 30000
  });

  try {
    const placeholders = userCodes.map(() => '?').join(',');

    const [updateResult] = await conn.execute(
      `UPDATE v2_users SET status = ? WHERE user_code IN (${placeholders})`,
      [normalizedStatus, ...userCodes]
    );

    const [rows] = await conn.execute(
      `SELECT user_code, status FROM v2_users WHERE user_code IN (${placeholders}) ORDER BY user_code`,
      userCodes
    );

    console.log(`Updated rows: ${updateResult.affectedRows || 0}`);
    console.table(rows);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
