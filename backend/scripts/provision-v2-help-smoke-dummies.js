#!/usr/bin/env node
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

const envCandidates = [
  path.join(backendDir, '.env.local'),
  path.join(backendDir, '.env')
];
const envPath = envCandidates.find((candidate) => existsSync(candidate));
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'okshopee24';

const SOURCE_USER_CODE = String(process.env.SMOKE_SOURCE_USER_CODE || '9900001').trim();
const PARENT_USER_CODE = String(process.env.SMOKE_PARENT_USER_CODE || '9900002').trim();
const DUMMY_PREFIX = String(process.env.SMOKE_DUMMY_PREFIX || '99').trim();
const EMAIL_DOMAIN = String(process.env.SMOKE_DUMMY_EMAIL_DOMAIN || 'example.test').trim();

function normalizeUserCode(value) {
  return String(value || '').trim();
}

function assertSafeInputs() {
  if (!SOURCE_USER_CODE || !PARENT_USER_CODE) {
    throw new Error('SMOKE_SOURCE_USER_CODE and SMOKE_PARENT_USER_CODE are required.');
  }
  if (SOURCE_USER_CODE === PARENT_USER_CODE) {
    throw new Error('SMOKE_SOURCE_USER_CODE and SMOKE_PARENT_USER_CODE must be different.');
  }
  if (DUMMY_PREFIX) {
    if (!SOURCE_USER_CODE.startsWith(DUMMY_PREFIX) || !PARENT_USER_CODE.startsWith(DUMMY_PREFIX)) {
      throw new Error(
        `Dummy user codes must start with prefix ${DUMMY_PREFIX}. `
        + 'Set SMOKE_DUMMY_PREFIX or choose matching codes.'
      );
    }
  }
}

function buildLegacyUser(userCode, fullName, sponsorId, directCount) {
  const nowIso = new Date().toISOString();
  return {
    id: `smoke-${userCode}`,
    userId: userCode,
    userCode,
    fullName,
    username: `smoke_${userCode}`,
    email: `smoke-${userCode}@${EMAIL_DOMAIN}`,
    sponsorId: sponsorId || '',
    directCount: Number.isFinite(directCount) ? directCount : 0,
    isActive: true,
    accountStatus: 'active',
    level: 1,
    createdAt: nowIso,
    activatedAt: nowIso,
    deactivationReason: null,
  };
}

function buildLegacyNode(userCode, parentId, position) {
  const nowIso = new Date().toISOString();
  return {
    id: `smoke-node-${userCode}`,
    userId: userCode,
    parentId: parentId || null,
    leftChild: null,
    rightChild: null,
    position: Number.isFinite(position) ? position : null,
    createdAt: nowIso,
    activatedAt: nowIso,
    isActive: true,
  };
}

function upsertByKey(arrayValue, keyName, item) {
  const list = Array.isArray(arrayValue) ? arrayValue : [];
  const idx = list.findIndex((entry) => String(entry?.[keyName] || '') === String(item[keyName] || ''));
  if (idx === -1) {
    list.push(item);
  } else {
    list[idx] = { ...list[idx], ...item };
  }
  return list;
}

async function loadStateStoreJson(conn, key) {
  const stateStoreColumns = await detectStateStoreColumns(conn);
  const [rows] = await conn.execute(
    `SELECT \`${stateStoreColumns.valueColumn}\` AS value_json
       FROM state_store
      WHERE \`${stateStoreColumns.keyColumn}\` = ?
      LIMIT 1`,
    [key]
  );
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const raw = rows[0]?.value_json;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveStateStoreJson(conn, key, value) {
  const stateStoreColumns = await detectStateStoreColumns(conn);
  const serialized = JSON.stringify(value);
  if (stateStoreColumns.hasUpdatedAt) {
    await conn.execute(
      `INSERT INTO state_store (\`${stateStoreColumns.keyColumn}\`, \`${stateStoreColumns.valueColumn}\`, updated_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE \`${stateStoreColumns.valueColumn}\` = VALUES(\`${stateStoreColumns.valueColumn}\`), updated_at = NOW()`,
      [key, serialized]
    );
    return;
  }

  await conn.execute(
    `INSERT INTO state_store (\`${stateStoreColumns.keyColumn}\`, \`${stateStoreColumns.valueColumn}\`)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE \`${stateStoreColumns.valueColumn}\` = VALUES(\`${stateStoreColumns.valueColumn}\`)`,
    [key, serialized]
  );
}

async function detectStateStoreColumns(conn) {
  const [rows] = await conn.execute(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'state_store'`
  );
  const columnNames = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.column_name || '').toLowerCase()));

  const keyColumn = columnNames.has('state_key') ? 'state_key' : 'key';
  const valueColumn = columnNames.has('state_value') ? 'state_value' : 'value';
  return {
    keyColumn,
    valueColumn,
    hasUpdatedAt: columnNames.has('updated_at')
  };
}

async function ensureV2User(conn, userCode, fullName, sponsorCode) {
  const normalizedCode = normalizeUserCode(userCode);
  await conn.execute(
    `INSERT INTO v2_users
      (legacy_user_id, user_code, full_name, email, status)
     VALUES (?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name),
       email = VALUES(email),
       status = 'active'`,
    [
      `smoke-${normalizedCode}`,
      normalizedCode,
      fullName,
      `smoke-${normalizedCode}@${EMAIL_DOMAIN}`,
    ]
  );

  const [rows] = await conn.execute(
    'SELECT id FROM v2_users WHERE user_code = ? LIMIT 1',
    [normalizedCode]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Failed to read v2_users id for ${normalizedCode}`);
  }
  const userId = Number(rows[0].id);

  if (sponsorCode) {
    const [sponsorRows] = await conn.execute(
      'SELECT id FROM v2_users WHERE user_code = ? LIMIT 1',
      [normalizeUserCode(sponsorCode)]
    );
    const sponsorId = sponsorRows?.[0]?.id ? Number(sponsorRows[0].id) : null;
    if (sponsorId) {
      await conn.execute(
        'UPDATE v2_users SET sponsor_user_id = ? WHERE id = ?',
        [sponsorId, userId]
      );
    }
  }

  return userId;
}

function walletAccountCode(userCode, walletType) {
  return `SMK_${userCode}_${walletType.toUpperCase()}`;
}

async function ensureWallet(conn, userId, userCode, walletType) {
  const accountCode = walletAccountCode(userCode, walletType);
  await conn.execute(
    `INSERT INTO v2_gl_accounts
      (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
     VALUES (?, ?, 'ASSET', ?, ?, 0, 1)
     ON DUPLICATE KEY UPDATE
      owner_user_id = VALUES(owner_user_id),
      wallet_type = VALUES(wallet_type),
      is_active = 1`,
    [accountCode, `${walletType} wallet ${userCode}`, userId, walletType]
  );

  const [glRows] = await conn.execute(
    'SELECT id FROM v2_gl_accounts WHERE account_code = ? LIMIT 1',
    [accountCode]
  );
  if (!Array.isArray(glRows) || glRows.length === 0) {
    throw new Error(`Failed to read v2_gl_accounts id for ${accountCode}`);
  }
  const glAccountId = Number(glRows[0].id);

  await conn.execute(
    `INSERT INTO v2_wallet_accounts
      (user_id, wallet_type, gl_account_id, baseline_amount_cents, current_amount_cents, currency, version)
     VALUES (?, ?, ?, 0, 0, 'INR', 0)
     ON DUPLICATE KEY UPDATE gl_account_id = VALUES(gl_account_id)`,
    [userId, walletType, glAccountId]
  );
}

async function main() {
  assertSafeInputs();

  const conn = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    multipleStatements: false,
  });

  try {
    await conn.beginTransaction();

    const parentUserId = await ensureV2User(conn, PARENT_USER_CODE, 'Smoke Parent', null);
    const sourceUserId = await ensureV2User(conn, SOURCE_USER_CODE, 'Smoke Source', PARENT_USER_CODE);

    for (const walletType of ['fund', 'income', 'royalty']) {
      await ensureWallet(conn, parentUserId, PARENT_USER_CODE, walletType);
      await ensureWallet(conn, sourceUserId, SOURCE_USER_CODE, walletType);
    }

    let legacyUsers = await loadStateStoreJson(conn, 'mlm_users');
    legacyUsers = upsertByKey(
      legacyUsers,
      'userId',
      buildLegacyUser(PARENT_USER_CODE, 'Smoke Parent', '', 1)
    );
    legacyUsers = upsertByKey(
      legacyUsers,
      'userId',
      buildLegacyUser(SOURCE_USER_CODE, 'Smoke Source', PARENT_USER_CODE, 0)
    );
    await saveStateStoreJson(conn, 'mlm_users', legacyUsers);

    let legacyMatrix = await loadStateStoreJson(conn, 'mlm_matrix');
    const parentNode = buildLegacyNode(PARENT_USER_CODE, null, null);
    const sourceNode = buildLegacyNode(SOURCE_USER_CODE, PARENT_USER_CODE, 0);

    const existingParent = legacyMatrix.find(
      (node) => String(node?.userId || '') === PARENT_USER_CODE
    );
    if (existingParent) {
      parentNode.leftChild = existingParent.leftChild || SOURCE_USER_CODE;
      parentNode.rightChild = existingParent.rightChild || null;
      parentNode.parentId = existingParent.parentId || null;
      parentNode.position = existingParent.position ?? null;
    } else {
      parentNode.leftChild = SOURCE_USER_CODE;
      parentNode.rightChild = null;
    }

    legacyMatrix = upsertByKey(legacyMatrix, 'userId', parentNode);
    legacyMatrix = upsertByKey(legacyMatrix, 'userId', sourceNode);
    await saveStateStoreJson(conn, 'mlm_matrix', legacyMatrix);

    await conn.commit();

    console.log('Smoke dummy users provisioned successfully.');
    console.log(`SMOKE_SOURCE_USER_CODE=${SOURCE_USER_CODE}`);
    console.log(`SMOKE_NEW_MEMBER_USER_CODE=${SOURCE_USER_CODE}`);
    console.log(`SMOKE_PARENT_USER_CODE=${PARENT_USER_CODE}`);
    console.log(`SMOKE_DUMMY_PREFIX=${DUMMY_PREFIX}`);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Failed to provision smoke dummy users:', error?.message || error);
  process.exit(1);
});
