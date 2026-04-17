import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import {
  buildLegacyDirectCountMap,
  extractIncrementalDirectRequirementsFromLegacySettings,
  isV2UserQualifiedForLevel
} from '../help-cascade-rules.js';

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

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:4000';
const HELP_EVENT_TYPE = 'activation_join';
const HELP_AMOUNT_CENTS = Number(process.env.V2_HELP_LEVEL1_AMOUNT_CENTS || 500);

function safeParseJSON(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUserCode(value) {
  return String(value || '').trim();
}

async function callHelpEvent({ actorUserCode, sourceUserCode, newMemberUserCode, sourceRef, idempotencyKey }) {
  const response = await fetch(`${BACKEND_URL}/api/v2/help-events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${actorUserCode}`,
      'X-System-Version': 'v2',
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sourceUserCode,
      newMemberUserCode,
      sourceRef,
      eventType: HELP_EVENT_TYPE,
      description: 'phase3-smoke'
    })
  });

  const bodyText = await response.text();
  const bodyJson = safeParseJSON(bodyText, null);
  return {
    status: response.status,
    ok: response.ok,
    body: bodyJson || { raw: bodyText }
  };
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24'
  });

  try {
    const [healthResponse] = await Promise.all([
      fetch(`${BACKEND_URL}/api/health`).catch(() => null)
    ]);
    if (!healthResponse || !healthResponse.ok) {
      throw new Error(`Backend health check failed at ${BACKEND_URL}/api/health`);
    }

    const [stateRows] = await conn.execute(
      `SELECT state_key, state_value
       FROM state_store
       WHERE state_key IN ('mlm_matrix', 'mlm_users', 'mlm_settings')`
    );
    const stateByKey = new Map((Array.isArray(stateRows) ? stateRows : []).map((row) => [row.state_key, row.state_value]));
    const matrix = safeParseJSON(stateByKey.get('mlm_matrix'), []);
    const legacyUsers = safeParseJSON(stateByKey.get('mlm_users'), []);
    const legacySettings = safeParseJSON(stateByKey.get('mlm_settings'), {});

    if (!Array.isArray(matrix) || matrix.length === 0) {
      throw new Error('mlm_matrix is empty; cannot run help cascade smoke scenarios');
    }

    const directCountByUserCode = buildLegacyDirectCountMap(Array.isArray(legacyUsers) ? legacyUsers : []);
    const incrementalRequirements = extractIncrementalDirectRequirementsFromLegacySettings(legacySettings, 10);

    const [activeRows] = await conn.execute(
      `SELECT id, user_code, status
       FROM v2_users
       WHERE status = 'active'`
    );
    const activeByCode = new Map((Array.isArray(activeRows) ? activeRows : []).map((row) => [String(row.user_code), row]));

    const matrixByCode = new Map();
    for (const node of matrix) {
      const userCode = normalizeUserCode(node?.userId);
      if (!userCode) continue;
      matrixByCode.set(userCode, {
        userCode,
        parentUserCode: normalizeUserCode(node?.parentId)
      });
    }

    let candidate = null;
    let fallbackCandidate = null;
    for (const node of matrixByCode.values()) {
      const member = node.userCode;
      const parent = node.parentUserCode;
      const grandParent = parent ? matrixByCode.get(parent)?.parentUserCode || '' : '';
      if (!member || !parent) continue;
      if (!activeByCode.has(member) || !activeByCode.has(parent)) continue;

      if (!fallbackCandidate) {
        fallbackCandidate = {
          sourceUserCode: member,
          newMemberUserCode: member,
          level1BeneficiaryCode: parent,
          level2BeneficiaryCode: null,
          releaseLevelNo: 1,
          releaseBeneficiaryCode: parent,
          selectionMode: 'fallback_level1_release'
        };
      }

      if (!grandParent || !activeByCode.has(grandParent)) continue;

      const level2Qualified = isV2UserQualifiedForLevel({
        userCode: grandParent,
        levelNo: 2,
        directCountByUserCode,
        incrementalRequirements
      });

      if (!level2Qualified) continue;

      candidate = {
        sourceUserCode: member,
        newMemberUserCode: member,
        level1BeneficiaryCode: parent,
        level2BeneficiaryCode: grandParent,
        releaseLevelNo: 2,
        releaseBeneficiaryCode: grandParent,
        selectionMode: 'qualified_level2_release'
      };
      break;
    }

    if (!candidate) {
      candidate = fallbackCandidate;
    }

    if (!candidate) {
      throw new Error('No matrix candidate found with active level-1 beneficiary');
    }

    const summary = {
      backendUrl: BACKEND_URL,
      envFile: envPath || 'process.env',
      candidate,
      scenarios: {}
    };

    const actorUserCode = candidate.sourceUserCode;

    const releaseBeneficiaryId = Number(activeByCode.get(candidate.releaseBeneficiaryCode)?.id || 0);
    const level1BeneficiaryId = Number(activeByCode.get(candidate.level1BeneficiaryCode)?.id || 0);

    if (!releaseBeneficiaryId || !level1BeneficiaryId) {
      throw new Error('Failed to resolve beneficiary ids in v2_users');
    }

    await conn.execute(
      `INSERT INTO v2_help_level_state
        (user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
         locked_qualification_cents, safety_deducted_cents,
         pending_give_cents, given_cents, income_credited_cents, last_event_seq)
       VALUES
        (?, ?, 3, 1500, 1000, ?, 0, 0, 0, 0, 1)
       ON DUPLICATE KEY UPDATE
        locked_qualification_cents = VALUES(locked_qualification_cents)`,
      [releaseBeneficiaryId, Number(candidate.releaseLevelNo), HELP_AMOUNT_CENTS]
    );

    const [walletBeforeRows] = await conn.execute(
      `SELECT current_amount_cents
       FROM v2_wallet_accounts
       WHERE user_id = ? AND wallet_type = 'income'
       LIMIT 1`,
      [releaseBeneficiaryId]
    );
    const walletBefore = Number(Array.isArray(walletBeforeRows) && walletBeforeRows[0]
      ? walletBeforeRows[0].current_amount_cents
      : 0);

    const scenario1 = await callHelpEvent({
      actorUserCode,
      sourceUserCode: candidate.sourceUserCode,
      newMemberUserCode: candidate.newMemberUserCode,
      sourceRef: `smoke-qrel-${Date.now()}`,
      idempotencyKey: `smoke-qrel-${Date.now()}-1`
    });

    const [stateAfterRows] = await conn.execute(
      `SELECT locked_qualification_cents
       FROM v2_help_level_state
       WHERE user_id = ? AND level_no = ?
       LIMIT 1`,
      [releaseBeneficiaryId, Number(candidate.releaseLevelNo)]
    );
    const lockedAfter = Number(Array.isArray(stateAfterRows) && stateAfterRows[0]
      ? stateAfterRows[0].locked_qualification_cents
      : 0);

    const [walletAfterRows] = await conn.execute(
      `SELECT current_amount_cents
       FROM v2_wallet_accounts
       WHERE user_id = ? AND wallet_type = 'income'
       LIMIT 1`,
      [releaseBeneficiaryId]
    );
    const walletAfter = Number(Array.isArray(walletAfterRows) && walletAfterRows[0]
      ? walletAfterRows[0].current_amount_cents
      : 0);

    const releasedEntry = (scenario1.body?.processedContributions || []).find((entry) =>
      entry?.settlementMode === 'released_locked_receive'
      && String(entry?.beneficiaryUserCode || '') === candidate.releaseBeneficiaryCode
      && Number(entry?.levelNo || 0) === Number(candidate.releaseLevelNo)
    ) || null;

    summary.scenarios.qualificationRelease = {
      pass: scenario1.status === 200 && lockedAfter === 0 && walletAfter >= walletBefore + HELP_AMOUNT_CENTS,
      selectionMode: candidate.selectionMode,
      releaseLevelNo: Number(candidate.releaseLevelNo),
      releaseBeneficiaryCode: candidate.releaseBeneficiaryCode,
      httpStatus: scenario1.status,
      lockedBeforeCents: HELP_AMOUNT_CENTS,
      lockedAfterCents: lockedAfter,
      walletBeforeCents: walletBefore,
      walletAfterCents: walletAfter,
      releasedEntry
    };

    await conn.execute(
      `INSERT INTO v2_help_level_state
        (user_id, level_no, receive_count, receive_total_cents, locked_first_two_cents,
         locked_qualification_cents, safety_deducted_cents,
         pending_give_cents, given_cents, income_credited_cents, last_event_seq)
       VALUES
        (?, 1, 4, 2000, 1000, 0, 0, 0, 0, 0, 10)
       ON DUPLICATE KEY UPDATE
        receive_count = 4,
        safety_deducted_cents = 0`,
      [level1BeneficiaryId]
    );

    const scenario2 = await callHelpEvent({
      actorUserCode,
      sourceUserCode: candidate.sourceUserCode,
      newMemberUserCode: candidate.newMemberUserCode,
      sourceRef: `smoke-fifth-${Date.now()}`,
      idempotencyKey: `smoke-fifth-${Date.now()}-1`
    });

    const fifthEntry = (scenario2.body?.processedContributions || []).find((entry) =>
      String(entry?.beneficiaryUserCode || '') === candidate.level1BeneficiaryCode
      && Number(entry?.levelNo || 0) === 1
    ) || null;

    let safetyPoolCreditCount = 0;
    if (fifthEntry?.ledgerTransactionId) {
      const [safetyRows] = await conn.execute(
        `SELECT COUNT(*) AS c
         FROM v2_ledger_entries e
         INNER JOIN v2_gl_accounts g ON g.id = e.gl_account_id
         WHERE e.ledger_txn_id = ?
           AND e.entry_side = 'credit'
           AND g.account_code = 'SYS_HELP_SAFETY_POOL'`,
        [Number(fifthEntry.ledgerTransactionId)]
      );
      safetyPoolCreditCount = Number(Array.isArray(safetyRows) && safetyRows[0] ? safetyRows[0].c : 0);
    }

    summary.scenarios.fifthHelpDiversion = {
      pass: scenario2.status === 200
        && fifthEntry?.settlementMode === 'safety_pool_diversion'
        && safetyPoolCreditCount >= 1,
      httpStatus: scenario2.status,
      settlementMode: fifthEntry?.settlementMode || null,
      ledgerTransactionId: fifthEntry?.ledgerTransactionId || null,
      safetyPoolCreditCount
    };

    const concurrentSourceRef = `smoke-conc-${Date.now()}`;
    const reqA = callHelpEvent({
      actorUserCode,
      sourceUserCode: candidate.sourceUserCode,
      newMemberUserCode: candidate.newMemberUserCode,
      sourceRef: concurrentSourceRef,
      idempotencyKey: `${concurrentSourceRef}-a`
    });
    const reqB = callHelpEvent({
      actorUserCode,
      sourceUserCode: candidate.sourceUserCode,
      newMemberUserCode: candidate.newMemberUserCode,
      sourceRef: concurrentSourceRef,
      idempotencyKey: `${concurrentSourceRef}-b`
    });

    const [concurrentA, concurrentB] = await Promise.all([reqA, reqB]);
    const eventKey = String(concurrentA.body?.eventKey || concurrentB.body?.eventKey || '');

    const [queueRows] = await conn.execute(
      `SELECT COUNT(*) AS c
       FROM v2_help_events_queue
       WHERE event_key = ?`,
      [eventKey]
    );
    const queueCount = Number(Array.isArray(queueRows) && queueRows[0] ? queueRows[0].c : 0);

    const refPrefix = `${eventKey.slice(0, 60)}:%`;
    const [txnRows1] = await conn.execute(
      `SELECT COUNT(*) AS c
       FROM v2_ledger_transactions
       WHERE reference_type = 'help_event' AND reference_id LIKE ?`,
      [refPrefix]
    );
    const txnCountAfterConcurrent = Number(Array.isArray(txnRows1) && txnRows1[0] ? txnRows1[0].c : 0);

    const replay = await callHelpEvent({
      actorUserCode,
      sourceUserCode: candidate.sourceUserCode,
      newMemberUserCode: candidate.newMemberUserCode,
      sourceRef: concurrentSourceRef,
      idempotencyKey: `${concurrentSourceRef}-c`
    });

    const [txnRows2] = await conn.execute(
      `SELECT COUNT(*) AS c
       FROM v2_ledger_transactions
       WHERE reference_type = 'help_event' AND reference_id LIKE ?`,
      [refPrefix]
    );
    const txnCountAfterReplay = Number(Array.isArray(txnRows2) && txnRows2[0] ? txnRows2[0].c : 0);

    summary.scenarios.concurrentDedup = {
      pass: concurrentA.status === 200
        && concurrentB.status === 200
        && replay.status === 200
        && queueCount === 1
        && txnCountAfterReplay === txnCountAfterConcurrent,
      statuses: [concurrentA.status, concurrentB.status, replay.status],
      queueCount,
      eventKey,
      txnCountAfterConcurrent,
      txnCountAfterReplay,
      replayPayload: replay.body
    };

    summary.allPass = Object.values(summary.scenarios).every((item) => item.pass === true);

    console.log(JSON.stringify(summary, null, 2));
    if (!summary.allPass) {
      process.exitCode = 2;
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(`SMOKE_ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
