#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const args = {
    apply: false,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    label: 'phase-a-fix'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--apply') {
      args.apply = true;
      continue;
    }

    if (!item.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) {
      i += 1;
    }

    switch (key) {
      case 'host':
        args.host = value;
        break;
      case 'port':
        args.port = Number(value);
        break;
      case 'user':
        args.user = value;
        break;
      case 'password':
        args.password = value;
        break;
      case 'database':
        args.database = value;
        break;
      case 'label':
        args.label = value;
        break;
      default:
        break;
    }
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function printRows(title, rows) {
  console.log(`\n${title}: ${rows.length}`);
  rows.forEach((row) => console.log(JSON.stringify(row)));
}

async function fetchFailures(conn) {
  const [missingWallets] = await conn.query(
    `SELECT
       u.id AS user_id,
       u.user_code,
       IF(f.id IS NULL, 1, 0) AS missing_fund,
       IF(i.id IS NULL, 1, 0) AS missing_income,
       IF(r.id IS NULL, 1, 0) AS missing_royalty
     FROM v2_users u
     LEFT JOIN v2_wallet_accounts f ON f.user_id = u.id AND f.wallet_type = 'fund'
     LEFT JOIN v2_wallet_accounts i ON i.user_id = u.id AND i.wallet_type = 'income'
     LEFT JOIN v2_wallet_accounts r ON r.user_id = u.id AND r.wallet_type = 'royalty'
     WHERE u.status = 'active'
       AND (f.id IS NULL OR i.id IS NULL OR r.id IS NULL)
     ORDER BY u.id`
  );

  const [missingHelp] = await conn.query(
    `SELECT u.id AS user_id, u.user_code
     FROM v2_users u
     LEFT JOIN v2_help_progress_state h ON h.user_id = u.id
     WHERE u.status = 'active'
       AND h.user_id IS NULL
     ORDER BY u.id`
  );

  const [missingBaseline] = await conn.query(
    `SELECT wa.user_id, u.user_code, wa.wallet_type, wa.current_amount_cents
     FROM v2_wallet_accounts wa
     INNER JOIN v2_users u ON u.id = wa.user_id
     LEFT JOIN v2_baseline_balances bb
       ON bb.user_id = wa.user_id
      AND bb.wallet_type = wa.wallet_type
      AND bb.is_active = 1
     WHERE bb.id IS NULL
     ORDER BY wa.user_id, wa.wallet_type`
  );

  const [walletVsBaselineMismatchNoLedger] = await conn.query(
    `SELECT
       u.user_code,
       wa.wallet_type,
       wa.current_amount_cents,
       bb.baseline_amount_cents
     FROM v2_wallet_accounts wa
     INNER JOIN v2_users u ON u.id = wa.user_id
     INNER JOIN v2_baseline_balances bb
       ON bb.user_id = wa.user_id
      AND bb.wallet_type = wa.wallet_type
      AND bb.is_active = 1
     WHERE NOT EXISTS (
       SELECT 1
       FROM v2_ledger_entries le
       INNER JOIN v2_ledger_transactions lt ON lt.id = le.ledger_txn_id
       WHERE le.gl_account_id = wa.gl_account_id
         AND lt.system_version = 'v2'
         AND lt.status = 'posted'
     )
     AND wa.current_amount_cents <> bb.baseline_amount_cents
     ORDER BY u.user_code, wa.wallet_type`
  );

  return {
    missingWallets,
    missingHelp,
    missingBaseline,
    walletVsBaselineMismatchNoLedger
  };
}

async function applyFixes(conn) {
  await conn.query(
    `CREATE TEMPORARY TABLE tmp_missing_wallet_types AS
     SELECT u.id AS user_id, u.user_code, wt.wallet_type
     FROM v2_users u
     JOIN (
       SELECT 'fund' AS wallet_type
       UNION ALL SELECT 'income'
       UNION ALL SELECT 'royalty'
     ) wt
       ON 1=1
     LEFT JOIN v2_wallet_accounts wa
       ON wa.user_id = u.id
      AND wa.wallet_type = wt.wallet_type
     WHERE u.status = 'active'
       AND wa.id IS NULL`
  );

  await conn.query(
    `INSERT INTO v2_gl_accounts
      (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
     SELECT
      CONCAT('USER_', t.user_code, '_', UPPER(t.wallet_type)) AS account_code,
      CONCAT('User ', t.user_code, ' ', t.wallet_type, ' wallet liability') AS account_name,
      'LIABILITY' AS account_type,
      t.user_id,
      t.wallet_type,
      0,
      1
     FROM tmp_missing_wallet_types t
     LEFT JOIN v2_gl_accounts ga
       ON ga.owner_user_id = t.user_id
      AND ga.wallet_type = t.wallet_type
     WHERE ga.id IS NULL`
  );

  await conn.query(
    `INSERT INTO v2_wallet_accounts
      (user_id, wallet_type, gl_account_id, baseline_amount_cents, current_amount_cents, currency, version)
     SELECT
      t.user_id,
      t.wallet_type,
      ga.id,
      0,
      0,
      'INR',
      0
     FROM tmp_missing_wallet_types t
     INNER JOIN v2_gl_accounts ga
       ON ga.owner_user_id = t.user_id
      AND ga.wallet_type = t.wallet_type
     LEFT JOIN v2_wallet_accounts wa
       ON wa.user_id = t.user_id
      AND wa.wallet_type = t.wallet_type
     WHERE wa.id IS NULL`
  );

  await conn.query(
    `INSERT INTO v2_help_progress_state
      (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
       next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
     SELECT
      u.id,
      'BASELINE',
      0,
      0,
      0,
      0,
      0,
      NOW(3)
     FROM v2_users u
     LEFT JOIN v2_help_progress_state h ON h.user_id = u.id
     WHERE u.status = 'active'
       AND h.user_id IS NULL`
  );

  await conn.query(
    `INSERT INTO v2_baseline_balances
      (user_id, wallet_type, baseline_amount_cents, baseline_version, captured_at, captured_by, snapshot_hash, is_active)
     SELECT
      wa.user_id,
      wa.wallet_type,
      wa.current_amount_cents,
      COALESCE((
        SELECT MAX(bb2.baseline_version) + 1
        FROM v2_baseline_balances bb2
        WHERE bb2.user_id = wa.user_id
          AND bb2.wallet_type = wa.wallet_type
      ), 1) AS baseline_version,
      NOW(3),
      'phase_a_fix_script',
      NULL,
      1
     FROM v2_wallet_accounts wa
     LEFT JOIN v2_baseline_balances bb
       ON bb.user_id = wa.user_id
      AND bb.wallet_type = wa.wallet_type
      AND bb.is_active = 1
     WHERE bb.id IS NULL`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const metaPath = path.join(evidenceDir, 'phase-a-fix-meta.txt');
  const detailsPath = path.join(evidenceDir, 'phase-a-fix-details.json');

  const meta = [
    `StartedAt: ${new Date().toISOString()}`,
    `Host: ${args.host}`,
    `Port: ${args.port}`,
    `User: ${args.user}`,
    `Database: ${args.database}`,
    `ApplyMode: ${args.apply ? 'true' : 'false'}`
  ];
  fs.writeFileSync(metaPath, `${meta.join('\n')}\n`, 'utf8');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000,
    multipleStatements: true
  });

  try {
    const before = await fetchFailures(conn);

    printRows('check_1_missing_required_wallets', before.missingWallets);
    printRows('check_2_missing_help_progress_state', before.missingHelp);
    printRows('check_3_missing_active_baseline', before.missingBaseline);
    printRows('check_4_no_posted_v2_ledger_wallet_baseline_mismatch', before.walletVsBaselineMismatchNoLedger);

    if (!args.apply) {
      console.log('\nNo changes applied. Run again with --apply to remediate missing seed rows.');
      fs.writeFileSync(
        detailsPath,
        JSON.stringify({ mode: 'dry-run', before }, null, 2),
        'utf8'
      );
      const hasFailures =
        before.missingWallets.length > 0 ||
        before.missingHelp.length > 0 ||
        before.missingBaseline.length > 0 ||
        before.walletVsBaselineMismatchNoLedger.length > 0;
      process.exit(hasFailures ? 2 : 0);
    }

    await conn.beginTransaction();
    await applyFixes(conn);
    const after = await fetchFailures(conn);
    await conn.commit();

    printRows('after_check_1_missing_required_wallets', after.missingWallets);
    printRows('after_check_2_missing_help_progress_state', after.missingHelp);
    printRows('after_check_3_missing_active_baseline', after.missingBaseline);
    printRows('after_check_4_no_posted_v2_ledger_wallet_baseline_mismatch', after.walletVsBaselineMismatchNoLedger);

    fs.writeFileSync(
      detailsPath,
      JSON.stringify({ mode: 'apply', before, after }, null, 2),
      'utf8'
    );

    fs.appendFileSync(metaPath, `FinishedAt: ${new Date().toISOString()}\nExitCode: 0\n`, 'utf8');
    console.log(`\nEvidence folder: ${evidenceDir}`);

    const pass =
      after.missingWallets.length === 0 &&
      after.missingHelp.length === 0 &&
      after.missingBaseline.length === 0 &&
      after.walletVsBaselineMismatchNoLedger.length === 0;

    if (!pass) {
      console.error('Remediation completed but Phase A still has remaining failures.');
      process.exit(3);
    }

    console.log('Remediation completed and Phase A checks are now clean.');
    process.exit(0);
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      // Ignore rollback errors.
    }

    fs.appendFileSync(
      metaPath,
      `FinishedAt: ${new Date().toISOString()}\nExitCode: 1\nError: ${err.message}\n`,
      'utf8'
    );
    console.error(err.message || err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
