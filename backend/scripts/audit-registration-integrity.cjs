#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const args = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    userCode: '',
    email: '',
    phone: '',
    limit: 300,
    label: 'registration-integrity'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) i += 1;

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
      case 'user-code':
        args.userCode = String(value || '').trim();
        break;
      case 'email':
        args.email = String(value || '').trim().toLowerCase();
        break;
      case 'phone':
        args.phone = String(value || '').replace(/\D/g, '');
        break;
      case 'limit':
        args.limit = Number(value || 300);
        break;
      case 'label':
        args.label = String(value || '').trim() || 'registration-integrity';
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 20 || args.limit > 5000) {
    throw new Error('--limit must be between 20 and 5000');
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getTimeValue(row) {
  const t = new Date(row?.createdAt || row?.timestamp || row?.sentAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function readLegacyState(conn) {
  const [rows] = await conn.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_wallets', 'mlm_matrix', 'mlm_pins', 'mlm_email_logs')`
  );

  const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key), row.state_value]));

  return {
    users: parseArray(map.get('mlm_users')),
    wallets: parseArray(map.get('mlm_wallets')),
    matrix: parseArray(map.get('mlm_matrix')),
    pins: parseArray(map.get('mlm_pins')),
    emailLogs: parseArray(map.get('mlm_email_logs'))
  };
}

function buildUserIndex(users) {
  const byInternalId = new Map();
  const byUserCode = new Map();
  const byEmail = new Map();
  const byPhone = new Map();

  for (const user of users) {
    if (!user || typeof user !== 'object') continue;
    const internalId = String(user.id || '').trim();
    const userCode = String(user.userId || '').trim();
    const email = String(user.email || '').trim().toLowerCase();
    const phone = normalizePhone(user.phone || user.mobile);

    if (internalId) byInternalId.set(internalId, user);
    if (userCode) byUserCode.set(userCode, user);
    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(user);
    }
    if (phone) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone).push(user);
    }
  }

  return { byInternalId, byUserCode, byEmail, byPhone };
}

function userExistsByAnyRef(ref, userIndex) {
  const key = String(ref || '').trim();
  if (!key) return false;
  return userIndex.byInternalId.has(key) || userIndex.byUserCode.has(key);
}

function toUserSummary(user, walletsByRef, matrixByRef) {
  const internalId = String(user?.id || '').trim();
  const userCode = String(user?.userId || '').trim();
  const wallet = walletsByRef.get(internalId) || walletsByRef.get(userCode) || null;
  const matrixNode = matrixByRef.get(internalId) || matrixByRef.get(userCode) || null;

  return {
    id: internalId,
    userCode,
    fullName: String(user?.fullName || ''),
    email: String(user?.email || ''),
    phone: String(user?.phone || user?.mobile || ''),
    isActive: !!user?.isActive,
    createdAt: user?.createdAt || null,
    hasWalletRow: !!wallet,
    hasMatrixNode: !!matrixNode
  };
}

function analyze(state, args) {
  const users = state.users;
  const wallets = state.wallets;
  const matrix = state.matrix;
  const pins = state.pins;
  const emailLogs = state.emailLogs;

  const userIndex = buildUserIndex(users);
  const walletsByRef = new Map();
  const matrixByRef = new Map();

  for (const wallet of wallets) {
    const ref = String(wallet?.userId || '').trim();
    if (!ref) continue;
    if (!walletsByRef.has(ref)) walletsByRef.set(ref, wallet);
  }

  for (const node of matrix) {
    const ref = String(node?.userId || '').trim();
    if (!ref) continue;
    if (!matrixByRef.has(ref)) matrixByRef.set(ref, node);
  }

  const usersMissingWallet = users
    .map((user) => toUserSummary(user, walletsByRef, matrixByRef))
    .filter((row) => !row.hasWalletRow)
    .slice(0, args.limit);

  const usersMissingMatrix = users
    .map((user) => toUserSummary(user, walletsByRef, matrixByRef))
    .filter((row) => !row.hasMatrixNode)
    .slice(0, args.limit);

  const usedPinsWithMissingUser = pins
    .filter((pin) => String(pin?.status || '').toLowerCase() === 'used')
    .map((pin) => {
      const usedById = String(pin?.usedById || '').trim();
      const registrationUserId = String(pin?.registrationUserId || '').trim();
      const ownerId = String(pin?.ownerId || '').trim();
      const usedByExists = usedById ? userExistsByAnyRef(usedById, userIndex) : false;
      const regExists = registrationUserId ? userExistsByAnyRef(registrationUserId, userIndex) : false;
      const ownerExists = ownerId ? userExistsByAnyRef(ownerId, userIndex) : false;

      return {
        pinCode: String(pin?.pinCode || ''),
        status: String(pin?.status || ''),
        usedAt: pin?.usedAt || null,
        usedById,
        registrationUserId,
        ownerId,
        usedByExists,
        registrationUserExists: regExists,
        ownerExists
      };
    })
    .filter((row) => !row.usedByExists || !row.registrationUserExists)
    .sort((a, b) => new Date(b.usedAt || 0).getTime() - new Date(a.usedAt || 0).getTime())
    .slice(0, args.limit);

  const targetUsers = [];
  if (args.userCode) {
    const byCode = userIndex.byUserCode.get(args.userCode);
    if (byCode) targetUsers.push(byCode);
  }
  if (args.email) {
    const rows = userIndex.byEmail.get(args.email) || [];
    rows.forEach((u) => targetUsers.push(u));
  }
  if (args.phone) {
    const rows = userIndex.byPhone.get(args.phone) || [];
    rows.forEach((u) => targetUsers.push(u));
  }

  const dedupTarget = new Map();
  for (const user of targetUsers) {
    const key = String(user?.id || user?.userId || '').trim();
    if (key && !dedupTarget.has(key)) dedupTarget.set(key, user);
  }

  const targetMatches = Array.from(dedupTarget.values()).map((user) => toUserSummary(user, walletsByRef, matrixByRef));

  const targetEmailMentions = args.email
    ? emailLogs
      .filter((log) => String(log?.to || log?.email || log?.recipient || '').trim().toLowerCase() === args.email)
      .sort((a, b) => getTimeValue(b) - getTimeValue(a))
      .slice(0, args.limit)
      .map((log) => ({
        to: String(log?.to || log?.email || log?.recipient || ''),
        subject: String(log?.subject || ''),
        purpose: String(log?.purpose || ''),
        createdAt: log?.createdAt || log?.sentAt || null,
        status: log?.status || null
      }))
    : [];

  const targetPhoneMentions = args.phone
    ? users
      .filter((u) => normalizePhone(u?.phone || u?.mobile) === args.phone)
      .map((u) => ({ userCode: String(u?.userId || ''), fullName: String(u?.fullName || ''), createdAt: u?.createdAt || null }))
    : [];

  const recentUsers = [...users]
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .slice(0, args.limit)
    .map((user) => toUserSummary(user, walletsByRef, matrixByRef));

  return {
    summary: {
      usersTotal: users.length,
      walletsTotal: wallets.length,
      matrixTotal: matrix.length,
      pinsTotal: pins.length,
      emailLogsTotal: emailLogs.length,
      usersMissingWalletCount: usersMissingWallet.length,
      usersMissingMatrixCount: usersMissingMatrix.length,
      usedPinsWithMissingUserCount: usedPinsWithMissingUser.length,
      targetMatchedUsersCount: targetMatches.length,
      targetEmailMentionsCount: targetEmailMentions.length,
      targetPhoneMentionsCount: targetPhoneMentions.length
    },
    filters: {
      userCode: args.userCode || null,
      email: args.email || null,
      phone: args.phone || null,
      limit: args.limit
    },
    targetMatches,
    targetEmailMentions,
    targetPhoneMentions,
    usersMissingWallet,
    usersMissingMatrix,
    usedPinsWithMissingUser,
    recentUsers
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'registration-integrity-report.json');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const state = await readLegacyState(conn);
    const result = analyze(state, args);
    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'read-only',
      ...result
    };

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log('--- Registration Integrity Audit (Read-Only) ---');
    console.log(`Report: ${reportPath}`);
    console.log(`usersTotal=${report.summary.usersTotal}`);
    console.log(`usersMissingWalletCount=${report.summary.usersMissingWalletCount}`);
    console.log(`usersMissingMatrixCount=${report.summary.usersMissingMatrixCount}`);
    console.log(`usedPinsWithMissingUserCount=${report.summary.usedPinsWithMissingUserCount}`);
    console.log(`targetMatchedUsersCount=${report.summary.targetMatchedUsersCount}`);
    console.log(`targetEmailMentionsCount=${report.summary.targetEmailMentionsCount}`);
    console.log(`targetPhoneMentionsCount=${report.summary.targetPhoneMentionsCount}`);

    const targetRequested = !!(args.userCode || args.email || args.phone);
    if (targetRequested && report.summary.targetMatchedUsersCount === 0 && report.summary.targetEmailMentionsCount === 0) {
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
