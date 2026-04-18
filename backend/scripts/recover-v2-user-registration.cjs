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
    userCode: '',
    label: 'recover-registration-user'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) i += 1;

    switch (key) {
      case 'apply':
        args.apply = true;
        i -= 1;
        break;
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
      case 'user-code':
        args.userCode = String(value || '').trim();
        break;
      case 'label':
        args.label = String(value || '').trim() || 'recover-registration-user';
        break;
      default:
        break;
    }
  }

  if (!/^\d{7}$/.test(args.userCode)) {
    throw new Error('--user-code is required and must be a 7-digit user ID');
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function toCents(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(Math.round(value * 100));
}

function mapLegacyStatus(legacyUser) {
  const isActive = !!legacyUser?.isActive;
  const accountStatus = String(legacyUser?.accountStatus || '').toLowerCase();
  if (!isActive || accountStatus === 'permanent_blocked' || accountStatus === 'temp_blocked') {
    return 'blocked';
  }
  return 'active';
}

function nextBaselineVersion(rows) {
  const maxVersion = rows.reduce((max, row) => {
    const value = Number(row.baseline_version || 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  return maxVersion + 1;
}

async function loadLegacyState(conn) {
  const [rows] = await conn.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_wallets')`
  );

  const map = new Map((Array.isArray(rows) ? rows : []).map((r) => [String(r.state_key), String(r.state_value || '[]')]));
  const users = JSON.parse(map.get('mlm_users') || '[]');
  const wallets = JSON.parse(map.get('mlm_wallets') || '[]');
  return {
    users: Array.isArray(users) ? users : [],
    wallets: Array.isArray(wallets) ? wallets : []
  };
}

async function fetchUserState(conn, userCode) {
  const [v2UserRows] = await conn.execute(
    `SELECT id, legacy_user_id, user_code, full_name, email, status
     FROM v2_users
     WHERE user_code = ?
     LIMIT 1`,
    [userCode]
  );

  const v2User = Array.isArray(v2UserRows) && v2UserRows.length > 0 ? v2UserRows[0] : null;
  const v2UserId = v2User ? Number(v2User.id) : 0;

  let walletRows = [];
  let helpRows = [];
  let baselineRows = [];
  if (v2UserId > 0) {
    const [walletResult] = await conn.execute(
      `SELECT wallet_type, current_amount_cents, baseline_amount_cents, gl_account_id
       FROM v2_wallet_accounts
       WHERE user_id = ?
       ORDER BY wallet_type`,
      [v2UserId]
    );
    walletRows = Array.isArray(walletResult) ? walletResult : [];

    const [helpResult] = await conn.execute(
      `SELECT user_id, current_stage_code
       FROM v2_help_progress_state
       WHERE user_id = ?
       LIMIT 1`,
      [v2UserId]
    );
    helpRows = Array.isArray(helpResult) ? helpResult : [];

    const [baselineResult] = await conn.execute(
      `SELECT wallet_type, baseline_amount_cents, baseline_version, is_active
       FROM v2_baseline_balances
       WHERE user_id = ?
       ORDER BY wallet_type, baseline_version DESC`,
      [v2UserId]
    );
    baselineRows = Array.isArray(baselineResult) ? baselineResult : [];
  }

  return {
    v2User,
    wallets: walletRows,
    helpRows,
    baselines: baselineRows
  };
}

async function applyRecovery(conn, legacyUser, legacyWallet, existingV2) {
  const actions = [];
  let v2UserId = existingV2.v2User ? Number(existingV2.v2User.id) : 0;

  if (!v2UserId) {
    const status = mapLegacyStatus(legacyUser);
    const [insertResult] = await conn.execute(
      `INSERT INTO v2_users
        (legacy_user_id, user_code, full_name, email, status)
       VALUES
        (?, ?, ?, ?, ?)`,
      [
        String(legacyUser?.id || '').trim() || null,
        String(legacyUser.userId || '').trim(),
        String(legacyUser.fullName || '').trim() || `User ${legacyUser.userId}`,
        String(legacyUser.email || '').trim() || null,
        status
      ]
    );
    v2UserId = Number(insertResult.insertId || 0);
    actions.push({ step: 'insert_v2_user', v2UserId, status });
  }

  const targetWallets = [
    { walletType: 'fund', amountCents: toCents(legacyWallet?.depositWallet) },
    { walletType: 'income', amountCents: toCents(legacyWallet?.incomeWallet) },
    { walletType: 'royalty', amountCents: toCents(legacyWallet?.royaltyWallet) }
  ];

  for (const target of targetWallets) {
    const accountCode = `USER_${legacyUser.userId}_${target.walletType.toUpperCase()}`;

    const [glRows] = await conn.execute(
      `SELECT id FROM v2_gl_accounts WHERE owner_user_id = ? AND wallet_type = ? LIMIT 1`,
      [v2UserId, target.walletType]
    );
    let glAccountId = Array.isArray(glRows) && glRows.length > 0 ? Number(glRows[0].id) : 0;

    if (!glAccountId) {
      const [insertGl] = await conn.execute(
        `INSERT INTO v2_gl_accounts
          (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
         VALUES
          (?, ?, 'LIABILITY', ?, ?, 0, 1)`,
        [
          accountCode,
          `User ${legacyUser.userId} ${target.walletType} wallet liability`,
          v2UserId,
          target.walletType
        ]
      );
      glAccountId = Number(insertGl.insertId || 0);
      actions.push({ step: 'insert_gl_account', walletType: target.walletType, glAccountId });
    }

    const [walletRows] = await conn.execute(
      `SELECT id FROM v2_wallet_accounts WHERE user_id = ? AND wallet_type = ? LIMIT 1`,
      [v2UserId, target.walletType]
    );

    if (!Array.isArray(walletRows) || walletRows.length === 0) {
      await conn.execute(
        `INSERT INTO v2_wallet_accounts
          (user_id, wallet_type, gl_account_id, baseline_amount_cents, current_amount_cents, currency, version)
         VALUES
          (?, ?, ?, ?, ?, 'INR', 0)`,
        [v2UserId, target.walletType, glAccountId, target.amountCents, target.amountCents]
      );
      actions.push({ step: 'insert_wallet', walletType: target.walletType, amountCents: target.amountCents });
    }

    const [activeBaselineRows] = await conn.execute(
      `SELECT id FROM v2_baseline_balances WHERE user_id = ? AND wallet_type = ? AND is_active = 1`,
      [v2UserId, target.walletType]
    );

    if (!Array.isArray(activeBaselineRows) || activeBaselineRows.length === 0) {
      const [allBaselineRows] = await conn.execute(
        `SELECT baseline_version FROM v2_baseline_balances WHERE user_id = ? AND wallet_type = ?`,
        [v2UserId, target.walletType]
      );

      const baselineVersion = nextBaselineVersion(Array.isArray(allBaselineRows) ? allBaselineRows : []);
      await conn.execute(
        `INSERT INTO v2_baseline_balances
          (user_id, wallet_type, baseline_amount_cents, baseline_version, captured_at, captured_by, snapshot_hash, is_active)
         VALUES
          (?, ?, ?, ?, NOW(3), 'recover_v2_user_registration_script', NULL, 1)`,
        [v2UserId, target.walletType, target.amountCents, baselineVersion]
      );
      actions.push({ step: 'insert_baseline', walletType: target.walletType, baselineVersion, amountCents: target.amountCents });
    }
  }

  const [helpRows] = await conn.execute(
    `SELECT user_id FROM v2_help_progress_state WHERE user_id = ? LIMIT 1`,
    [v2UserId]
  );
  if (!Array.isArray(helpRows) || helpRows.length === 0) {
    await conn.execute(
      `INSERT INTO v2_help_progress_state
        (user_id, current_stage_code, receive_count_in_stage, receive_total_cents_in_stage,
         next_required_give_cents, pending_give_cents, last_progress_event_seq, baseline_snapshot_at)
       VALUES
        (?, 'BASELINE', 0, 0, 0, 0, 0, NOW(3))`,
      [v2UserId]
    );
    actions.push({ step: 'insert_help_progress_state' });
  }

  return actions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, `registration-recovery-${args.userCode}.json`);
  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const legacy = await loadLegacyState(conn);
    const legacyUser = legacy.users.find((u) => String(u?.userId || '').trim() === args.userCode) || null;
    if (!legacyUser) {
      throw new Error(`Legacy user not found in state_store.mlm_users for userCode=${args.userCode}`);
    }

    const legacyWallet = legacy.wallets.find((w) => String(w?.userId || '').trim() === String(legacyUser.id || '').trim())
      || legacy.wallets.find((w) => String(w?.userId || '').trim() === args.userCode)
      || null;

    const before = await fetchUserState(conn, args.userCode);

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      userCode: args.userCode,
      legacyUser: {
        id: legacyUser.id,
        userId: legacyUser.userId,
        fullName: legacyUser.fullName,
        email: legacyUser.email,
        isActive: legacyUser.isActive,
        accountStatus: legacyUser.accountStatus || null
      },
      legacyWallet: legacyWallet
        ? {
          userId: legacyWallet.userId,
          depositWallet: Number(legacyWallet.depositWallet || 0),
          incomeWallet: Number(legacyWallet.incomeWallet || 0),
          royaltyWallet: Number(legacyWallet.royaltyWallet || 0)
        }
        : null,
      before,
      actions: []
    };

    if (args.apply) {
      await conn.beginTransaction();
      try {
        const actions = await applyRecovery(conn, legacyUser, legacyWallet, before);
        report.actions = actions;
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
      report.after = await fetchUserState(conn, args.userCode);
    }

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const hasV2User = !!before.v2User;
    const walletTypesBefore = new Set((before.wallets || []).map((w) => String(w.wallet_type)));
    const missingWalletTypesBefore = ['fund', 'income', 'royalty'].filter((t) => !walletTypesBefore.has(t));

    console.log('--- V2 Registration Recovery ---');
    console.log(`UserCode: ${args.userCode}`);
    console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
    console.log(`LegacyUserFound: yes`);
    console.log(`LegacyWalletFound: ${legacyWallet ? 'yes' : 'no'}`);
    console.log(`V2UserFoundBefore: ${hasV2User ? 'yes' : 'no'}`);
    console.log(`MissingWalletTypesBefore: ${missingWalletTypesBefore.length > 0 ? missingWalletTypesBefore.join(',') : 'none'}`);
    console.log(`HelpProgressRowBefore: ${(before.helpRows || []).length > 0 ? 'yes' : 'no'}`);
    console.log(`ActionsApplied: ${report.actions.length}`);
    console.log(`Report: ${reportPath}`);

    if (!args.apply && (!hasV2User || missingWalletTypesBefore.length > 0 || (before.helpRows || []).length === 0)) {
      process.exit(2);
    }

    process.exit(0);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
