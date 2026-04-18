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

function normalizeUserCode(value) {
  return String(value || '').trim();
}

function inClausePlaceholders(values) {
  return Array.from({ length: values.length }, () => '?').join(', ');
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
        `Refusing cleanup: user codes must start with prefix ${DUMMY_PREFIX}. `
        + 'Set SMOKE_DUMMY_PREFIX or choose matching codes.'
      );
    }
  }
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT 1 AS present
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1`,
    [tableName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function getTableColumns(conn, tableName) {
  const [rows] = await conn.execute(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.column_name || '')));
}

async function detectStateStoreColumns(conn) {
  const columns = await getTableColumns(conn, 'state_store');
  const keyColumn = columns.has('state_key') ? 'state_key' : 'key';
  const valueColumn = columns.has('state_value') ? 'state_value' : 'value';
  return {
    keyColumn,
    valueColumn,
    hasUpdatedAt: columns.has('updated_at')
  };
}

async function loadStateStoreJson(conn, key) {
  if (!(await tableExists(conn, 'state_store'))) {
    return [];
  }

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
  if (!(await tableExists(conn, 'state_store'))) {
    return;
  }

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

function matchesDummyRef(rawValue, userCodes) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) return false;

  for (const userCode of userCodes) {
    if (normalized === userCode || normalized === `smoke-${userCode}`) {
      return true;
    }
  }
  return false;
}

function scrubLegacyUsers(legacyUsers, userCodes) {
  const before = Array.isArray(legacyUsers) ? legacyUsers.length : 0;
  const next = (Array.isArray(legacyUsers) ? legacyUsers : []).filter((item) => {
    const userId = String(item?.userId || '').trim();
    const id = String(item?.id || '').trim();
    return !userCodes.includes(userId) && !userCodes.includes(id.replace(/^smoke-/, ''));
  });

  for (const item of next) {
    if (matchesDummyRef(item?.sponsorId, userCodes)) {
      item.sponsorId = '';
    }
  }

  return { next, removed: Math.max(0, before - next.length) };
}

function scrubLegacyMatrix(legacyMatrix, userCodes) {
  const list = Array.isArray(legacyMatrix) ? legacyMatrix : [];
  const before = list.length;

  const kept = list.filter((node) => !matchesDummyRef(node?.userId, userCodes));
  for (const node of kept) {
    if (matchesDummyRef(node?.parentId, userCodes)) node.parentId = null;
    if (matchesDummyRef(node?.leftChild, userCodes)) node.leftChild = null;
    if (matchesDummyRef(node?.rightChild, userCodes)) node.rightChild = null;
  }

  return { next: kept, removed: Math.max(0, before - kept.length) };
}

function scrubLegacyPendingContributions(legacyPending, userCodes) {
  const before = Array.isArray(legacyPending) ? legacyPending.length : 0;
  const next = (Array.isArray(legacyPending) ? legacyPending : []).filter((item) => {
    return !matchesDummyRef(item?.fromUserId, userCodes) && !matchesDummyRef(item?.toUserId, userCodes);
  });
  return { next, removed: Math.max(0, before - next.length) };
}

async function deleteByColumns(conn, tableName, columns, values, summary, keyPrefix) {
  if (!values.length) return;
  if (!(await tableExists(conn, tableName))) return;

  const tableColumns = await getTableColumns(conn, tableName);
  const existingColumns = columns.filter((col) => tableColumns.has(col));
  if (existingColumns.length === 0) return;

  const inClause = inClausePlaceholders(values);
  const where = existingColumns.map((col) => `${col} IN (${inClause})`).join(' OR ');
  const params = [];
  for (let i = 0; i < existingColumns.length; i += 1) {
    params.push(...values);
  }

  const [result] = await conn.execute(`DELETE FROM ${tableName} WHERE ${where}`, params);
  summary[`${keyPrefix}:${tableName}`] = Number(result?.affectedRows || 0);
}

async function main() {
  assertSafeInputs();

  const userCodes = [SOURCE_USER_CODE, PARENT_USER_CODE];
  const accountCodes = [
    ...userCodes.map((code) => `SMK_${code}_FUND`),
    ...userCodes.map((code) => `SMK_${code}_INCOME`),
    ...userCodes.map((code) => `SMK_${code}_ROYALTY`)
  ];

  const conn = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    multipleStatements: false
  });

  const summary = {};

  try {
    await conn.beginTransaction();

    const [v2UserRows] = await conn.execute(
      `SELECT id, user_code
       FROM v2_users
       WHERE user_code IN (?, ?)`,
      userCodes
    );
    const v2Users = Array.isArray(v2UserRows) ? v2UserRows : [];
    const userIds = v2Users.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

    summary['found:v2_users'] = v2Users.length;

    if (userIds.length > 0) {
      const txnTableExists = await tableExists(conn, 'v2_ledger_transactions');
      const entryTableExists = await tableExists(conn, 'v2_ledger_entries');

      if (txnTableExists) {
        const txnInClause = inClausePlaceholders(userIds);
        const [txnRows] = await conn.execute(
          `SELECT id
           FROM v2_ledger_transactions
           WHERE initiator_user_id IN (${txnInClause})`,
          userIds
        );
        const txnIds = (Array.isArray(txnRows) ? txnRows : [])
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id) && id > 0);
        summary['found:v2_ledger_transactions'] = txnIds.length;

        if (txnIds.length > 0) {
          const txInClause = inClausePlaceholders(txnIds);

          if (await tableExists(conn, 'v2_help_pending_contributions')) {
            const helpPendingCols = await getTableColumns(conn, 'v2_help_pending_contributions');
            if (helpPendingCols.has('processed_txn_id')) {
              const [updatePendingResult] = await conn.execute(
                `UPDATE v2_help_pending_contributions
                 SET processed_txn_id = NULL
                 WHERE processed_txn_id IN (${txInClause})`,
                txnIds
              );
              summary['update:v2_help_pending_contributions'] = Number(updatePendingResult?.affectedRows || 0);
            }
          }

          if (await tableExists(conn, 'v2_referral_events')) {
            const referralCols = await getTableColumns(conn, 'v2_referral_events');
            if (referralCols.has('credit_txn_id')) {
              const [updateCreditResult] = await conn.execute(
                `UPDATE v2_referral_events
                 SET credit_txn_id = NULL
                 WHERE credit_txn_id IN (${txInClause})`,
                txnIds
              );
              summary['update:v2_referral_events.credit_txn_id'] = Number(updateCreditResult?.affectedRows || 0);
            }
            if (referralCols.has('source_txn_id')) {
              const [updateSourceResult] = await conn.execute(
                `UPDATE v2_referral_events
                 SET source_txn_id = NULL
                 WHERE source_txn_id IN (${txInClause})`,
                txnIds
              );
              summary['update:v2_referral_events.source_txn_id'] = Number(updateSourceResult?.affectedRows || 0);
            }
          }

          if (entryTableExists) {
            const [deleteEntryTxnResult] = await conn.execute(
              `DELETE FROM v2_ledger_entries
               WHERE ledger_txn_id IN (${txInClause})`,
              txnIds
            );
            summary['delete:v2_ledger_entries.by_txn'] = Number(deleteEntryTxnResult?.affectedRows || 0);
          }

          const [deleteTxnResult] = await conn.execute(
            `DELETE FROM v2_ledger_transactions
             WHERE id IN (${txInClause})`,
            txnIds
          );
          summary['delete:v2_ledger_transactions'] = Number(deleteTxnResult?.affectedRows || 0);
        }
      }

      if (entryTableExists) {
        const idInClause = inClausePlaceholders(userIds);
        const [deleteEntryUserResult] = await conn.execute(
          `DELETE FROM v2_ledger_entries
           WHERE user_id IN (${idInClause})`,
          userIds
        );
        summary['delete:v2_ledger_entries.by_user'] = Number(deleteEntryUserResult?.affectedRows || 0);
      }

      await deleteByColumns(conn, 'v2_help_events_queue', ['actor_user_id', 'source_user_id', 'new_member_user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_help_pending_contributions', ['source_user_id', 'beneficiary_user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_help_level_state', ['user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_help_progress_state', ['user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_baseline_balances', ['user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_registration_profiles', ['user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_wallet_accounts', ['user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_gl_accounts', ['owner_user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_referral_events', ['source_user_id', 'beneficiary_user_id'], userIds, summary, 'delete');
      await deleteByColumns(conn, 'v2_idempotency_keys', ['actor_user_id'], userIds, summary, 'delete');

      if (await tableExists(conn, 'v2_users')) {
        const idInClause = inClausePlaceholders(userIds);
        const [deleteUsersResult] = await conn.execute(
          `DELETE FROM v2_users
           WHERE id IN (${idInClause})`,
          userIds
        );
        summary['delete:v2_users'] = Number(deleteUsersResult?.affectedRows || 0);
      }
    }

    if (await tableExists(conn, 'v2_gl_accounts') && accountCodes.length > 0) {
      const accountInClause = inClausePlaceholders(accountCodes);
      const [deleteGlByCode] = await conn.execute(
        `DELETE FROM v2_gl_accounts
         WHERE account_code IN (${accountInClause})`,
        accountCodes
      );
      summary['delete:v2_gl_accounts.by_code'] = Number(deleteGlByCode?.affectedRows || 0);
    }

    if (await tableExists(conn, 'v2_matrix_nodes')) {
      const codeInClause = inClausePlaceholders(userCodes);

      const [updateParentResult] = await conn.execute(
        `UPDATE v2_matrix_nodes
         SET parent_user_code = NULL
         WHERE parent_user_code IN (${codeInClause})`,
        userCodes
      );
      summary['update:v2_matrix_nodes.parent'] = Number(updateParentResult?.affectedRows || 0);

      const [updateLeftResult] = await conn.execute(
        `UPDATE v2_matrix_nodes
         SET left_child_user_code = NULL
         WHERE left_child_user_code IN (${codeInClause})`,
        userCodes
      );
      summary['update:v2_matrix_nodes.left'] = Number(updateLeftResult?.affectedRows || 0);

      const [updateRightResult] = await conn.execute(
        `UPDATE v2_matrix_nodes
         SET right_child_user_code = NULL
         WHERE right_child_user_code IN (${codeInClause})`,
        userCodes
      );
      summary['update:v2_matrix_nodes.right'] = Number(updateRightResult?.affectedRows || 0);

      const [deleteNodesResult] = await conn.execute(
        `DELETE FROM v2_matrix_nodes
         WHERE user_code IN (${codeInClause})`,
        userCodes
      );
      summary['delete:v2_matrix_nodes'] = Number(deleteNodesResult?.affectedRows || 0);
    }

    if (await tableExists(conn, 'v2_post_registration_retry_queue')) {
      const codeInClause = inClausePlaceholders(userCodes);
      const [deleteRetryResult] = await conn.execute(
        `DELETE FROM v2_post_registration_retry_queue
         WHERE registration_user_code IN (${codeInClause})
            OR target_user_code IN (${codeInClause})`,
        [...userCodes, ...userCodes]
      );
      summary['delete:v2_post_registration_retry_queue'] = Number(deleteRetryResult?.affectedRows || 0);
    }

    const legacyUsers = await loadStateStoreJson(conn, 'mlm_users');
    const scrubbedUsers = scrubLegacyUsers(legacyUsers, userCodes);
    await saveStateStoreJson(conn, 'mlm_users', scrubbedUsers.next);
    summary['state:mlm_users_removed'] = scrubbedUsers.removed;

    const legacyMatrix = await loadStateStoreJson(conn, 'mlm_matrix');
    const scrubbedMatrix = scrubLegacyMatrix(legacyMatrix, userCodes);
    await saveStateStoreJson(conn, 'mlm_matrix', scrubbedMatrix.next);
    summary['state:mlm_matrix_removed'] = scrubbedMatrix.removed;

    const legacyPending = await loadStateStoreJson(conn, 'mlm_matrix_pending_contributions');
    const scrubbedPending = scrubLegacyPendingContributions(legacyPending, userCodes);
    await saveStateStoreJson(conn, 'mlm_matrix_pending_contributions', scrubbedPending.next);
    summary['state:mlm_matrix_pending_removed'] = scrubbedPending.removed;

    await conn.commit();

    console.log('Smoke dummy cleanup completed.');
    console.log(`SMOKE_SOURCE_USER_CODE=${SOURCE_USER_CODE}`);
    console.log(`SMOKE_PARENT_USER_CODE=${PARENT_USER_CODE}`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback secondary errors.
    }
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Failed to cleanup smoke dummy users:', error?.message || error);
  process.exit(1);
});
