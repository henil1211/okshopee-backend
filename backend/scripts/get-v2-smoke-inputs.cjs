#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

function parseArgs(argv) {
  const out = {
    senderUserCode: '1000001',
    amountCents: 100,
    pinQuantity: 1
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) {
      i += 1;
    }

    if (key === 'sender') {
      out.senderUserCode = String(value || '').trim();
    }
    if (key === 'amount') {
      out.amountCents = Number(value || 100);
    }
    if (key === 'pin-qty') {
      out.pinQuantity = Number(value || 1);
    }
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'okshopee24';
  const defaultPinPriceCents = Number(process.env.V2_DEFAULT_PIN_PRICE_CENTS || 1100);

  const conn = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [senderRows] = await conn.execute(
      `SELECT u.id, u.user_code, u.status, wa.current_amount_cents
       FROM v2_users u
       LEFT JOIN v2_wallet_accounts wa
         ON wa.user_id = u.id
        AND wa.wallet_type = 'fund'
       WHERE u.user_code = ?
       LIMIT 1`,
      [args.senderUserCode]
    );

    const sender = Array.isArray(senderRows) && senderRows.length > 0 ? senderRows[0] : null;
    if (!sender) {
      console.error(`ERROR: sender user not found in v2_users: ${args.senderUserCode}`);
      process.exit(2);
    }

    const [receiverRows] = await conn.execute(
      `SELECT u.user_code, wa.current_amount_cents
       FROM v2_users u
       INNER JOIN v2_wallet_accounts wa
         ON wa.user_id = u.id
        AND wa.wallet_type = 'fund'
       WHERE u.status = 'active'
         AND u.user_code <> ?
       ORDER BY wa.current_amount_cents DESC, u.id ASC
       LIMIT 10`,
      [args.senderUserCode]
    );

    if (!Array.isArray(receiverRows) || receiverRows.length === 0) {
      console.error('ERROR: no active receiver user with fund wallet found in v2');
      process.exit(3);
    }

    const receiver = receiverRows[0];

    const [pinRevenueRows] = await conn.execute(
      `SELECT id, account_code, is_active
       FROM v2_gl_accounts
       WHERE account_code = 'SYS_PIN_REVENUE'
       LIMIT 1`
    );
    const pinRevenue = Array.isArray(pinRevenueRows) && pinRevenueRows.length > 0 ? pinRevenueRows[0] : null;

    const pinTotalCents = defaultPinPriceCents * Math.max(1, Math.trunc(args.pinQuantity));

    console.log('--- V2 Smoke Input Helper ---');
    console.log(`SENDER_USER_CODE=${sender.user_code}`);
    console.log(`SENDER_STATUS=${sender.status}`);
    console.log(`SENDER_FUND_BALANCE_CENTS=${sender.current_amount_cents == null ? 'NULL' : sender.current_amount_cents}`);
    console.log(`RECEIVER_USER_CODE=${receiver.user_code}`);
    console.log(`RECEIVER_FUND_BALANCE_CENTS=${receiver.current_amount_cents}`);
    console.log(`AMOUNT_CENTS=${Math.max(1, Math.trunc(args.amountCents || 100))}`);
    console.log(`PIN_QUANTITY=${Math.max(1, Math.trunc(args.pinQuantity || 1))}`);
    console.log(`PIN_PRICE_CENTS=${defaultPinPriceCents}`);
    console.log(`PIN_TOTAL_CENTS=${pinTotalCents}`);
    console.log(`SYS_PIN_REVENUE_EXISTS=${pinRevenue ? 'yes' : 'no'}`);
    console.log(`SYS_PIN_REVENUE_ACTIVE=${pinRevenue ? String(Number(pinRevenue.is_active) === 1) : 'false'}`);

    console.log('');
    console.log('Run Step 2 with these values:');
    console.log(`powershell -ExecutionPolicy Bypass -File .\\scripts\\smoke-test-v2-deadlock-retry.ps1 -BackendUrl http://127.0.0.1:4000 -ActorUserCode ${sender.user_code} -SenderUserCode ${sender.user_code} -ReceiverUserCode ${receiver.user_code} -Requests 12 -Parallelism 6 -SaveReport`);

    console.log('');
    console.log('Run Step 3 with these values:');
    console.log(`powershell -ExecutionPolicy Bypass -File .\\scripts\\smoke-test-v2-pin-purchase.ps1 -BackendUrl http://127.0.0.1:4000 -ActorUserCode ${sender.user_code} -BuyerUserCode ${sender.user_code} -Quantity ${Math.max(1, Math.trunc(args.pinQuantity || 1))}`);

    if (sender.status !== 'active') {
      console.log('');
      console.log('WARNING: sender is not active in v2_users. Use another sender.');
    }
    if (sender.current_amount_cents == null) {
      console.log('');
      console.log('WARNING: sender fund wallet is missing. Phase A fix/apply may be required.');
    } else if (Number(sender.current_amount_cents) < Math.max(1, Math.trunc(args.amountCents || 100))) {
      console.log('');
      console.log('WARNING: sender fund wallet balance is lower than transfer amount.');
    }
    if (!pinRevenue || Number(pinRevenue.is_active) !== 1) {
      console.log('');
      console.log('WARNING: SYS_PIN_REVENUE is missing or inactive. Pin purchase will fail.');
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
