import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { createHash, randomUUID } from 'crypto';
import {
  buildLegacyDirectCountMap,
  extractIncrementalDirectRequirementsFromLegacySettings,
  isV2UserQualifiedForLevel,
  computeV2HelpSettlementDecision
} from '../help-cascade-rules.js';

dotenv.config();

const HELP_EXPENSE_ACCOUNT_CODE = 'SYS_HELP_EXPENSE';
const HELP_SETTLEMENT_ACCOUNT_CODE = 'SYS_CASH_OR_SETTLEMENT';
const HELP_SAFETY_POOL_ACCOUNT_CODE = 'SYS_HELP_SAFETY_POOL';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readArg(name, fallback = '') {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index === -1) return fallback;
  return String(process.argv[index + 1] || fallback).trim();
}

function normalizeUserCode(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,20}$/.test(normalized) ? normalized : '';
}

function safeParseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

async function resolveAncestorUserCode(connection, sourceUserCode, ancestorDepth) {
  const depth = Math.max(1, Number(ancestorDepth || 1));

  // Try resolving from v2 matrix rows first.
  let currentCode = sourceUserCode;
  let resolvedDepth = 0;
  while (resolvedDepth < depth) {
    const [matrixRows] = await connection.execute(
      `SELECT parent_user_code
       FROM v2_matrix_nodes
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [currentCode]
    );
    const parentCode = normalizeUserCode(
      Array.isArray(matrixRows) && matrixRows[0] ? matrixRows[0].parent_user_code : ''
    );
    if (!parentCode) {
      break;
    }
    currentCode = parentCode;
    resolvedDepth += 1;
  }

  if (resolvedDepth === depth) {
    return {
      ancestorUserCode: currentCode,
      resolvedFrom: 'v2_matrix_nodes',
      depth
    };
  }

  const [stateRows] = await connection.execute(
    `SELECT state_value
     FROM state_store
     WHERE state_key = 'mlm_matrix'
     LIMIT 1
     FOR UPDATE`
  );
  const matrixRaw = Array.isArray(stateRows) && stateRows[0] ? stateRows[0].state_value : null;
  const matrix = safeParseJson(matrixRaw, []);

  if (Array.isArray(matrix) && matrix.length > 0) {
    const parentByCode = new Map();
    for (const node of matrix) {
      const userCode = normalizeUserCode(node?.userId);
      if (!userCode) continue;
      parentByCode.set(userCode, normalizeUserCode(node?.parentId));
    }

    currentCode = sourceUserCode;
    resolvedDepth = 0;
    while (resolvedDepth < depth) {
      const parentCode = normalizeUserCode(parentByCode.get(currentCode));
      if (!parentCode) break;
      currentCode = parentCode;
      resolvedDepth += 1;
    }

    if (resolvedDepth === depth) {
      return {
        ancestorUserCode: currentCode,
        resolvedFrom: 'legacy_matrix_state',
        depth
      };
    }
  }

  return {
    ancestorUserCode: '',
    resolvedFrom: 'unresolved',
    depth
  };
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/repair-v2-immediate-give-help.js --source-user-code 7497863 --dry-run');
  console.log('  node scripts/repair-v2-immediate-give-help.js --source-user-code 7497863 --apply');
  console.log('  node scripts/repair-v2-immediate-give-help.js --source-user-code 7497863 --source-level-no 2 --dry-run');
  process.exit(1);
}

async function ensureHelpLevelStateRow(connection, userId, levelNo) {
  await connection.execute(
    `INSERT INTO v2_help_level_state
      (user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
       locked_qualification_cents, safety_deducted_cents,
       pending_give_cents, given_cents, income_credited_cents, last_event_seq)
     VALUES
      (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE id = id`,
    [userId, levelNo]
  );
}

async function lockHelpLevelState(connection, userId, levelNo) {
  await ensureHelpLevelStateRow(connection, userId, levelNo);
  const [rows] = await connection.execute(
    `SELECT id, user_id, level_no, receive_count, receive_total_cents,
            locked_first_two_cents, locked_qualification_cents, safety_deducted_cents,
            pending_give_cents, given_cents, income_credited_cents, last_event_seq
     FROM v2_help_level_state
     WHERE user_id = ? AND level_no = ?
     LIMIT 1
     FOR UPDATE`,
    [userId, levelNo]
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function lockIncomeWalletByUserId(connection, userId) {
  const [rows] = await connection.execute(
    `SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
     FROM v2_wallet_accounts
     WHERE user_id = ? AND wallet_type = 'income'
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function loadLockedContributionProfile(connection, beneficiaryUserId, sourceLevelNo) {
  const levelNo = Math.max(1, Number(sourceLevelNo || 1));
  const [rows] = await connection.execute(
    `SELECT pc.id, pc.source_user_id, src.user_code AS source_user_code,
            pc.amount_cents, pc.created_at
     FROM v2_help_pending_contributions pc
     LEFT JOIN v2_users src ON src.id = pc.source_user_id
     WHERE pc.beneficiary_user_id = ?
       AND pc.level_no = ?
       AND pc.status = 'processed'
       AND pc.reason = 'locked_for_give'
     ORDER BY pc.created_at ASC, pc.id ASC
     FOR UPDATE`,
    [beneficiaryUserId, levelNo]
  );

  const list = Array.isArray(rows) ? rows : [];
  const firstContributionBySource = new Map();
  const sourceCounts = new Map();
  let rawLockedCents = 0;

  for (const row of list) {
    const sourceUserId = Number(row?.source_user_id || 0);
    if (!Number.isFinite(sourceUserId) || sourceUserId <= 0) continue;
    const amountCents = Math.max(0, Number(row?.amount_cents || 0));
    rawLockedCents += amountCents;
    sourceCounts.set(sourceUserId, Number(sourceCounts.get(sourceUserId) || 0) + 1);

    if (!firstContributionBySource.has(sourceUserId)) {
      firstContributionBySource.set(sourceUserId, {
        amountCents,
        sourceUserCode: normalizeUserCode(row?.source_user_code)
      });
    }
  }

  let dedupedLockedCents = 0;
  const duplicateSources = [];
  for (const [sourceUserId, entry] of firstContributionBySource.entries()) {
    dedupedLockedCents += Math.max(0, Number(entry?.amountCents || 0));
    if (Number(sourceCounts.get(sourceUserId) || 0) > 1) {
      duplicateSources.push(entry?.sourceUserCode || String(sourceUserId));
    }
  }

  return {
    rawLockedRows: list.length,
    rawLockedCents,
    distinctContributors: firstContributionBySource.size,
    dedupedLockedCents,
    duplicateSources
  };
}

async function loadSystemGlAccountForUpdate(connection, {
  accountCode,
  accountName,
  accountType
}) {
  await connection.execute(
    `INSERT INTO v2_gl_accounts
      (account_code, account_name, account_type, owner_user_id, wallet_type, is_system_account, is_active)
     VALUES
      (?, ?, ?, NULL, NULL, 1, 1)
     ON DUPLICATE KEY UPDATE
      account_name = VALUES(account_name),
      account_type = VALUES(account_type),
      is_system_account = 1,
      is_active = 1`,
    [accountCode, accountName, accountType]
  );

  const [rows] = await connection.execute(
    `SELECT id, account_code, is_active
     FROM v2_gl_accounts
     WHERE account_code = ?
     LIMIT 1
     FOR UPDATE`,
    [accountCode]
  );

  const account = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!account || Number(account.is_active) !== 1) {
    throw new Error(`System GL account missing or inactive: ${accountCode}`);
  }
  return account;
}

async function loadLegacyHelpQualificationContext(connection) {
  const [rows] = await connection.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_users', 'mlm_settings')`
  );

  const list = Array.isArray(rows) ? rows : [];
  const byKey = new Map(list.map((row) => [String(row.state_key || ''), row.state_value]));

  const safeParse = (value, fallback) => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  };

  const legacyUsers = safeParse(byKey.get('mlm_users'), []);
  const legacySettings = safeParse(byKey.get('mlm_settings'), {});

  return {
    directCountByUserCode: buildLegacyDirectCountMap(Array.isArray(legacyUsers) ? legacyUsers : []),
    incrementalDirectRequirements: extractIncrementalDirectRequirementsFromLegacySettings(legacySettings, 10)
  };
}

function isQualifiedForLevel(qualificationContext, userCode, levelNo) {
  return isV2UserQualifiedForLevel({
    userCode,
    levelNo,
    directCountByUserCode: qualificationContext?.directCountByUserCode,
    incrementalRequirements: qualificationContext?.incrementalDirectRequirements
  });
}

async function createHelpLedgerTransaction(connection, {
  idempotencyKey,
  actorUserId,
  eventKey,
  contributionId,
  description,
  amountCents
}) {
  const requestHash = createHash('sha256')
    .update(`${idempotencyKey}|${actorUserId}|${eventKey}|${contributionId}|${amountCents}`)
    .digest('hex');

  await connection.execute(
    `INSERT INTO v2_idempotency_keys
      (idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until)
     VALUES
      (?, ?, ?, ?, 'completed', NULL)
     ON DUPLICATE KEY UPDATE
      endpoint_name = VALUES(endpoint_name),
      actor_user_id = VALUES(actor_user_id),
      request_hash = VALUES(request_hash),
      status = 'completed',
      locked_until = NULL,
      error_code = NULL,
      updated_at = NOW(3),
      last_seen_at = NOW(3)`,
    [idempotencyKey, 'v2_help_repair', actorUserId, requestHash]
  );

  const txUuid = randomUUID();
  const referenceId = `${String(eventKey || '').slice(0, 60)}:${String(contributionId || '').slice(0, 18)}`.slice(0, 80);

  const [result] = await connection.execute(
    `INSERT INTO v2_ledger_transactions
      (tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
       reference_type, reference_id, description, total_debit_cents, total_credit_cents)
     VALUES
      (?, 'v2', 'referral_credit', 'posted', ?, ?,
       'help_event', ?, ?, ?, ?)`,
    [
      txUuid,
      idempotencyKey,
      actorUserId,
      referenceId,
      description,
      amountCents,
      amountCents
    ]
  );

  const ledgerTxnId = Number(result?.insertId || 0);
  if (!ledgerTxnId) {
    throw new Error('Failed to create help settlement ledger transaction');
  }

  return { txUuid, ledgerTxnId };
}

async function main() {
  const sourceUserCode = normalizeUserCode(readArg('--source-user-code', ''));
  const sourceLevelNo = Math.max(1, Math.min(10, Number(readArg('--source-level-no', '1')) || 1));
  const apply = hasFlag('--apply');
  const dryRun = hasFlag('--dry-run') || !apply;

  if (!sourceUserCode) {
    usageAndExit();
  }

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'matrixmlm',
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  const summary = {
    sourceUserCode,
    sourceLevelNo,
    contributionLevelNo: sourceLevelNo + 1,
    apply: !dryRun,
    sourcePendingGiveCents: 0,
    insertedPendingContribution: false,
    processedContribution: false,
    pendingContributionId: null,
    pendingAmountCents: 0,
    beneficiaryUserCode: null,
    sourceLevel1LockedRows: 0,
    sourceLevel1DistinctContributors: 0,
    sourceLevel1RawLockedCents: 0,
    sourceLevel1DedupedLockedCents: 0,
    skippedDueToSuspiciousFirstTwo: false,
    settlementMode: null,
    ledgerTransactionId: null,
    notes: []
  };

  const connection = await pool.getConnection();
  let txOpen = false;

  try {
    await connection.beginTransaction();
    txOpen = true;

    const [sourceRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [sourceUserCode]
    );
    const sourceUser = Array.isArray(sourceRows) ? sourceRows[0] : null;
    if (!sourceUser) {
      throw new Error(`Source user not found in v2_users: ${sourceUserCode}`);
    }

    const sourceLevelState = await lockHelpLevelState(connection, Number(sourceUser.id), sourceLevelNo);
    if (!sourceLevelState) {
      throw new Error(`Failed to lock source level ${sourceLevelNo} help state`);
    }

    const pendingGiveCents = Number(sourceLevelState.pending_give_cents || 0);
    summary.sourcePendingGiveCents = pendingGiveCents;
    if (pendingGiveCents <= 0) {
      summary.notes.push(`No pending give found at source level ${sourceLevelNo}; nothing to process.`);
      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const levelProfile = await loadLockedContributionProfile(connection, Number(sourceUser.id), sourceLevelNo);
    summary.sourceLevel1LockedRows = Number(levelProfile.rawLockedRows || 0);
    summary.sourceLevel1DistinctContributors = Number(levelProfile.distinctContributors || 0);
    summary.sourceLevel1RawLockedCents = Number(levelProfile.rawLockedCents || 0);
    summary.sourceLevel1DedupedLockedCents = Number(levelProfile.dedupedLockedCents || 0);

    if (summary.sourceLevel1DistinctContributors < 2) {
      summary.skippedDueToSuspiciousFirstTwo = true;
      summary.notes.push(
        `Skipped immediate give: only ${summary.sourceLevel1DistinctContributors} distinct level-${sourceLevelNo} contributor(s); requires 2 distinct contributors.`
      );
      if (Array.isArray(levelProfile.duplicateSources) && levelProfile.duplicateSources.length > 0) {
        summary.notes.push(`Duplicate contributor(s) detected at level ${sourceLevelNo}: ${levelProfile.duplicateSources.join(', ')}`);
      }
      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const safePendingGiveCents = Math.max(
      0,
      Number(levelProfile.dedupedLockedCents || 0) - Number(sourceLevelState.given_cents || 0)
    );
    const effectivePendingGiveCents = Math.min(pendingGiveCents, safePendingGiveCents);
    summary.pendingAmountCents = effectivePendingGiveCents;

    if (pendingGiveCents > safePendingGiveCents) {
      summary.notes.push(
        `Pending give capped by dedupe guard: state=${pendingGiveCents}, safe=${safePendingGiveCents}.`
      );
    }

    if (effectivePendingGiveCents <= 0) {
      summary.notes.push('No safe pending give remains after dedupe validation; nothing to process.');
      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const contributionLevelNo = sourceLevelNo + 1;
    const beneficiaryResolution = await resolveAncestorUserCode(connection, sourceUserCode, contributionLevelNo);
    const beneficiaryUserCode = beneficiaryResolution.ancestorUserCode;
    if (!beneficiaryUserCode) {
      throw new Error(
        `Beneficiary user code unresolved at level ${contributionLevelNo} for ${sourceUserCode} `
        + '(checked v2_matrix_nodes and legacy matrix state)'
      );
    }
    if (beneficiaryResolution.resolvedFrom !== 'v2_matrix_nodes') {
      summary.notes.push(
        `Level ${contributionLevelNo} beneficiary resolved from ${beneficiaryResolution.resolvedFrom}: ${beneficiaryUserCode}`
      );
    }

    const [beneficiaryRows] = await connection.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE user_code = ?
       LIMIT 1
       FOR UPDATE`,
      [beneficiaryUserCode]
    );
    const beneficiaryUser = Array.isArray(beneficiaryRows) ? beneficiaryRows[0] : null;
    if (!beneficiaryUser) {
      throw new Error(`Beneficiary user not found in v2_users: ${beneficiaryUserCode}`);
    }
    summary.beneficiaryUserCode = String(beneficiaryUser.user_code || '');

    const [existingPendingRows] = await connection.execute(
      `SELECT id, source_event_key, source_user_id, beneficiary_user_id, level_no, side,
              amount_cents, status, processed_txn_id, reason, created_at
       FROM v2_help_pending_contributions
       WHERE source_user_id = ?
         AND beneficiary_user_id = ?
         AND level_no = ?
         AND status = 'pending'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`,
      [sourceUser.id, beneficiaryUser.id, contributionLevelNo]
    );

    let pendingContribution = Array.isArray(existingPendingRows) ? existingPendingRows[0] : null;
    if (!pendingContribution) {
      const syntheticEventKey = `repair_pending_${sourceUserCode}_L${contributionLevelNo}_${Date.now()}`.slice(0, 180);
      if (!dryRun) {
        await connection.execute(
          `INSERT INTO v2_help_pending_contributions
            (source_event_key, source_user_id, beneficiary_user_id, level_no, side, amount_cents, status, reason)
           VALUES
            (?, ?, ?, ?, 'unknown', ?, 'pending', 'repair_missing_pending_from_backfill')`,
          [syntheticEventKey, sourceUser.id, beneficiaryUser.id, contributionLevelNo, effectivePendingGiveCents]
        );

        const [pendingRows] = await connection.execute(
          `SELECT id, source_event_key, source_user_id, beneficiary_user_id, level_no, side,
                  amount_cents, status, processed_txn_id, reason, created_at
           FROM v2_help_pending_contributions
           WHERE source_user_id = ?
             AND beneficiary_user_id = ?
             AND level_no = ?
             AND status = 'pending'
           ORDER BY id DESC
           LIMIT 1
           FOR UPDATE`,
          [sourceUser.id, beneficiaryUser.id, contributionLevelNo]
        );
        pendingContribution = Array.isArray(pendingRows) ? pendingRows[0] : null;
      }
      summary.insertedPendingContribution = true;
    }

    if (!pendingContribution) {
      summary.notes.push(`Dry run: missing pending level ${contributionLevelNo} row would be inserted and processed.`);
      await connection.rollback();
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    let contributionAmountCents = Number(pendingContribution.amount_cents || 0);

    if (contributionAmountCents > effectivePendingGiveCents) {
      if (dryRun) {
        summary.notes.push(
          `Would cap pending contribution amount from ${contributionAmountCents} to ${effectivePendingGiveCents} due to dedupe guard.`
        );
      } else {
        await connection.execute(
          `UPDATE v2_help_pending_contributions
           SET amount_cents = ?
           WHERE id = ? AND status = 'pending'`,
          [effectivePendingGiveCents, pendingContribution.id]
        );
        contributionAmountCents = effectivePendingGiveCents;
      }
    }

    summary.pendingContributionId = Number(pendingContribution.id || 0) || null;

    if (pendingGiveCents < contributionAmountCents) {
      summary.notes.push(
        `Insufficient pending_give_cents at source level ${sourceLevelNo}: pending=${pendingGiveCents}, needed=${contributionAmountCents}`
      );
      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (dryRun) {
      summary.notes.push(`Would consume ${contributionAmountCents} pending give from ${sourceUserCode} and process pending contribution.`);
      await connection.rollback();
      txOpen = false;
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    // Consume pending give from selected source level for next-level contribution.
    const nextSourceEventSeq = Number(sourceLevelState.last_event_seq || 0) + 1;
    const nextSourcePending = pendingGiveCents - contributionAmountCents;
    const nextSourceGiven = Number(sourceLevelState.given_cents || 0) + contributionAmountCents;
    await connection.execute(
      `UPDATE v2_help_level_state
       SET pending_give_cents = ?,
           given_cents = ?,
           last_event_seq = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [nextSourcePending, nextSourceGiven, nextSourceEventSeq, sourceLevelState.id]
    );

    const qualificationContext = await loadLegacyHelpQualificationContext(connection);
    const beneficiaryLevelState = await lockHelpLevelState(connection, Number(beneficiaryUser.id), contributionLevelNo);
    if (!beneficiaryLevelState) {
      throw new Error(`Failed to lock beneficiary level ${contributionLevelNo} help state`);
    }

    const decision = computeV2HelpSettlementDecision({
      receiveCountBefore: Number(beneficiaryLevelState.receive_count || 0),
      safetyDeductedCents: Number(beneficiaryLevelState.safety_deducted_cents || 0),
      isQualifiedForLevel: isQualifiedForLevel(qualificationContext, beneficiaryUser.user_code, contributionLevelNo),
      amountCents: contributionAmountCents,
      lockedQualificationCents: Number(beneficiaryLevelState.locked_qualification_cents || 0)
    });

    const settlementMode = String(decision.mode || 'system_hold');
    const incomeCreditCents = Number(decision.incomeCreditCents || 0);
    const qualificationReleaseCents = Number(decision.qualificationReleaseCents || 0);
    const lockFirstTwoCents = Number(decision.lockFirstTwoCents || 0);
    const lockQualificationCents = Number(decision.lockQualificationCents || 0);
    const divertedSafetyCents = Number(decision.divertedSafetyCents || 0);

    const helpExpenseAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: HELP_EXPENSE_ACCOUNT_CODE,
      accountName: 'System help settlement expense',
      accountType: 'EXPENSE'
    });
    const settlementAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: HELP_SETTLEMENT_ACCOUNT_CODE,
      accountName: 'System cash or settlement',
      accountType: 'ASSET'
    });
    const safetyPoolAccount = await loadSystemGlAccountForUpdate(connection, {
      accountCode: HELP_SAFETY_POOL_ACCOUNT_CODE,
      accountName: 'System help safety pool',
      accountType: 'LIABILITY'
    });

    const summaryDescription = settlementMode === 'locked_for_give'
      ? `Locked first-two help level ${contributionLevelNo} for ${beneficiaryUser.user_code}`
      : settlementMode === 'locked_for_qualification'
        ? `Locked receive help level ${contributionLevelNo} for ${beneficiaryUser.user_code}`
        : settlementMode === 'safety_pool_diversion'
          ? `5th help diversion level ${contributionLevelNo} for ${beneficiaryUser.user_code}`
          : qualificationReleaseCents > 0
            ? `Released locked receive + help credit level ${contributionLevelNo} for ${beneficiaryUser.user_code}`
            : `Help credit level ${contributionLevelNo} for ${beneficiaryUser.user_code}`;
    const ledgerTransactionTotalCents = settlementMode === 'income_credit_with_release'
      ? incomeCreditCents
      : contributionAmountCents;

    const idempotencyKey = `repair_immediate_${sourceUserCode}_${Date.now()}`.slice(0, 120);
    const eventKey = `HELP:repair_immediate:${sourceUserCode}:${beneficiaryUser.user_code}:level${contributionLevelNo}`.slice(0, 180);

    const { txUuid, ledgerTxnId } = await createHelpLedgerTransaction(connection, {
      idempotencyKey,
      actorUserId: Number(sourceUser.id),
      eventKey,
      contributionId: Number(pendingContribution.id),
      description: summaryDescription,
      amountCents: ledgerTransactionTotalCents
    });

    if (settlementMode === 'locked_for_give' || settlementMode === 'locked_for_qualification') {
      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, NULL, NULL, 'credit', ?)`,
        [
          ledgerTxnId,
          helpExpenseAccount.id,
          contributionAmountCents,
          ledgerTxnId,
          settlementAccount.id,
          contributionAmountCents
        ]
      );
    } else if (settlementMode === 'safety_pool_diversion') {
      await connection.execute(
        `INSERT INTO v2_ledger_entries
          (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
         VALUES
          (?, 1, ?, NULL, NULL, 'debit', ?),
          (?, 2, ?, NULL, NULL, 'credit', ?)`,
        [
          ledgerTxnId,
          helpExpenseAccount.id,
          contributionAmountCents,
          ledgerTxnId,
          safetyPoolAccount.id,
          contributionAmountCents
        ]
      );
    } else {
      const beneficiaryWallet = await lockIncomeWalletByUserId(connection, Number(beneficiaryUser.id));
      if (!beneficiaryWallet) {
        throw new Error('Beneficiary income wallet is not provisioned in v2');
      }

      if (qualificationReleaseCents > 0) {
        await connection.execute(
          `INSERT INTO v2_ledger_entries
            (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
           VALUES
            (?, 1, ?, NULL, NULL, 'debit', ?),
            (?, 2, ?, NULL, NULL, 'debit', ?),
            (?, 3, ?, ?, 'income', 'credit', ?)`,
          [
            ledgerTxnId,
            helpExpenseAccount.id,
            contributionAmountCents,
            ledgerTxnId,
            settlementAccount.id,
            qualificationReleaseCents,
            ledgerTxnId,
            beneficiaryWallet.gl_account_id,
            beneficiaryWallet.user_id,
            incomeCreditCents
          ]
        );
      } else {
        await connection.execute(
          `INSERT INTO v2_ledger_entries
            (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
           VALUES
            (?, 1, ?, NULL, NULL, 'debit', ?),
            (?, 2, ?, ?, 'income', 'credit', ?)`,
          [
            ledgerTxnId,
            helpExpenseAccount.id,
            contributionAmountCents,
            ledgerTxnId,
            beneficiaryWallet.gl_account_id,
            beneficiaryWallet.user_id,
            incomeCreditCents
          ]
        );
      }

      const [walletUpdateResult] = await connection.execute(
        `UPDATE v2_wallet_accounts
         SET current_amount_cents = current_amount_cents + ?, version = version + 1
         WHERE user_id = ? AND wallet_type = 'income'`,
        [incomeCreditCents, beneficiaryWallet.user_id]
      );
      if (Number(walletUpdateResult?.affectedRows || 0) !== 1) {
        throw new Error('Failed to credit beneficiary income wallet');
      }
    }

    const nextBeneficiaryEventSeq = Number(beneficiaryLevelState.last_event_seq || 0) + 1;
    const nextReceiveCount = Number(beneficiaryLevelState.receive_count || 0) + 1;
    const nextReceiveTotal = Number(beneficiaryLevelState.receive_total_cents || 0) + contributionAmountCents;
    const nextLockedFirstTwo = Number(beneficiaryLevelState.locked_first_two_cents || 0) + lockFirstTwoCents;
    const nextLockedQualification = Math.max(
      0,
      Number(beneficiaryLevelState.locked_qualification_cents || 0) + lockQualificationCents - qualificationReleaseCents
    );
    const nextSafetyDeducted = Number(beneficiaryLevelState.safety_deducted_cents || 0) + divertedSafetyCents;
    const nextPendingGive = Number(beneficiaryLevelState.pending_give_cents || 0) + lockFirstTwoCents;
    const nextIncomeCredited = Number(beneficiaryLevelState.income_credited_cents || 0) + incomeCreditCents;

    await connection.execute(
      `UPDATE v2_help_level_state
       SET receive_count = ?,
           receive_total_cents = ?,
           locked_first_two_cents = ?,
           locked_qualification_cents = ?,
           safety_deducted_cents = ?,
           pending_give_cents = ?,
           income_credited_cents = ?,
           last_event_seq = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        nextReceiveCount,
        nextReceiveTotal,
        nextLockedFirstTwo,
        nextLockedQualification,
        nextSafetyDeducted,
        nextPendingGive,
        nextIncomeCredited,
        nextBeneficiaryEventSeq,
        beneficiaryLevelState.id
      ]
    );

    await connection.execute(
      `UPDATE v2_help_pending_contributions
       SET status = 'processed', processed_txn_id = ?, reason = ?, processed_at = NOW(3)
       WHERE id = ?`,
      [ledgerTxnId, settlementMode, pendingContribution.id]
    );

    summary.processedContribution = true;
    summary.settlementMode = settlementMode;
    summary.ledgerTransactionId = ledgerTxnId;

    await connection.commit();
    txOpen = false;

    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (txOpen) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback secondary errors.
      }
    }
    console.error(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
