import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SINGLE_USER_SCRIPT = path.join(__dirname, 'repair-v2-immediate-give-help.js');

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

function parseCsvUserCodes(raw) {
  return String(raw || '')
    .split(',')
    .map((entry) => normalizeUserCode(entry))
    .filter(Boolean);
}

function runSingleUserRepair({ sourceUserCode, sourceLevelNo, apply }) {
  return new Promise((resolve) => {
    const args = [
      SINGLE_USER_SCRIPT,
      '--source-user-code',
      sourceUserCode,
      '--source-level-no',
      String(Math.max(1, Number(sourceLevelNo || 1))),
      apply ? '--apply' : '--dry-run'
    ];

    const child = spawn(process.execPath, args, {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();
      let parsed = null;
      try {
        parsed = trimmedStdout ? JSON.parse(trimmedStdout) : null;
      } catch {
        parsed = null;
      }

      resolve({
        sourceUserCode,
        sourceLevelNo: Math.max(1, Number(sourceLevelNo || 1)),
        ok: Number(code || 0) === 0,
        exitCode: Number(code || 0),
        summary: parsed,
        stdout: trimmedStdout,
        stderr: stderr.trim()
      });
    });
  });
}

async function loadCandidateUsers(connection, limit, explicitUserCodes = []) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
  const useExplicitFilter = explicitUserCodes.length > 0;
  const explicitPlaceholders = explicitUserCodes.map(() => '?').join(', ');
  const [rows] = await connection.execute(
    `SELECT
       u.user_code,
       hs.level_no AS source_level_no,
       COALESCE(hs.pending_give_cents, 0) AS pending_give_cents,
       COALESCE(hs.given_cents, 0) AS given_cents,
       COALESCE(lp.distinct_sources, 0) AS distinct_sources,
       COALESCE(lp.total_locked_cents, 0) AS total_locked_cents,
       GREATEST(0, COALESCE(lp.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)) AS implied_pending_give_cents,
       COALESCE(pn.pending_rows, 0) AS pending_next_level_rows,
       COALESCE(pn.pending_cents, 0) AS pending_next_level_cents
     FROM v2_users u
     INNER JOIN v2_help_level_state hs
       ON hs.user_id = u.id
     LEFT JOIN (
       SELECT
         t.user_id,
         t.level_no,
         COUNT(*) AS distinct_sources,
         COALESCE(SUM(t.amount_cents), 0) AS total_locked_cents
       FROM (
         SELECT
           pc.beneficiary_user_id AS user_id,
           pc.level_no,
           pc.source_user_id,
           MAX(pc.amount_cents) AS amount_cents
         FROM v2_help_pending_contributions pc
         WHERE pc.status = 'processed'
           AND pc.reason = 'locked_for_give'
         GROUP BY pc.beneficiary_user_id, pc.level_no, pc.source_user_id
       ) t
       GROUP BY t.user_id, t.level_no
     ) lp ON lp.user_id = u.id AND lp.level_no = hs.level_no
     LEFT JOIN (
       SELECT
         pc.source_user_id AS user_id,
         pc.level_no,
         COUNT(*) AS pending_rows,
         COALESCE(SUM(pc.amount_cents), 0) AS pending_cents
       FROM v2_help_pending_contributions pc
       WHERE pc.status = 'pending'
       GROUP BY pc.source_user_id, pc.level_no
     ) pn ON pn.user_id = u.id AND pn.level_no = hs.level_no + 1
     WHERE u.status = 'active'
       AND hs.level_no BETWEEN 1 AND 9
       AND (
         COALESCE(hs.pending_give_cents, 0) > 0
         OR (
           COALESCE(lp.distinct_sources, 0) >= 2
           AND GREATEST(0, COALESCE(lp.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)) > 0
         )
       )
       ${useExplicitFilter ? `AND u.user_code IN (${explicitPlaceholders})` : ''}
     ORDER BY
       GREATEST(
         COALESCE(hs.pending_give_cents, 0),
         GREATEST(0, COALESCE(lp.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)),
         COALESCE(pn.pending_cents, 0)
       ) DESC,
       hs.level_no ASC,
       u.created_at ASC
     LIMIT ?`,
    [...explicitUserCodes, safeLimit]
  );

  const list = Array.isArray(rows) ? rows : [];
  const users = [];
  const seen = new Set();
  for (const row of list) {
    const userCode = normalizeUserCode(row?.user_code);
    if (!userCode) continue;
    const sourceLevelNo = Math.max(1, Math.min(9, Number(row?.source_level_no || 1)));
    const candidateKey = `${userCode}:${sourceLevelNo}`;
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);

    const pendingGiveCents = Math.max(0, Number(row?.pending_give_cents || 0));
    const impliedPendingGiveCents = Math.max(0, Number(row?.implied_pending_give_cents || 0));
    const pendingNextLevelRows = Math.max(0, Number(row?.pending_next_level_rows || 0));
    const distinctSources = Math.max(0, Number(row?.distinct_sources || 0));

    const candidateReasons = [];
    if (pendingGiveCents > 0) candidateReasons.push('pending_give_state');
    if (impliedPendingGiveCents > 0 && distinctSources >= 2) candidateReasons.push('locked_first_two_implied_pending');
    if (pendingNextLevelRows > 0 && (pendingGiveCents > 0 || impliedPendingGiveCents > 0)) {
      candidateReasons.push('pending_next_level_rows');
    }
    if (useExplicitFilter) candidateReasons.push('explicit_user_codes');

    users.push({
      userCode,
      sourceLevelNo,
      candidateReasons,
      pendingGiveCents,
      impliedPendingGiveCents,
      pendingNextLevelRows
    });
  }

  if (useExplicitFilter) {
    const explicitSeen = new Set(users.map((item) => item.userCode));
    for (const userCode of explicitUserCodes) {
      if (explicitSeen.has(userCode)) continue;
      users.push({
        userCode,
        sourceLevelNo: 1,
        candidateReasons: ['explicit_user_codes', 'fallback_level1_probe'],
        pendingGiveCents: 0,
        impliedPendingGiveCents: 0,
        pendingNextLevelRows: 0
      });
    }
  }

  return users;
}

async function main() {
  const apply = hasFlag('--apply');
  const dryRun = hasFlag('--dry-run') || !apply;
  const limitArg = Number(readArg('--limit', '500'));
  const explicitUserCodes = parseCsvUserCodes(readArg('--user-codes', ''));

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'matrixmlm',
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  let connection;
  try {
    connection = await pool.getConnection();
    const candidateUsers = await loadCandidateUsers(connection, limitArg, explicitUserCodes);
    const userCodes = [...new Set(candidateUsers.map((item) => item.userCode))];

    const report = {
      mode: dryRun ? 'dry-run' : 'apply',
      scannedCandidates: candidateUsers.length,
      succeeded: 0,
      failed: 0,
      processedContributions: 0,
      insertedPendingContributions: 0,
      skippedSuspiciousFirstTwo: 0,
      usersWithoutPendingGive: 0,
      targetUsers: userCodes,
      candidateUsers,
      results: []
    };

    for (const candidate of candidateUsers) {
      const runResult = await runSingleUserRepair({
        sourceUserCode: candidate.userCode,
        sourceLevelNo: candidate.sourceLevelNo,
        apply: !dryRun
      });

      if (runResult.ok) {
        report.succeeded += 1;
        const summary = runResult.summary || {};
        if (summary.processedContribution) {
          report.processedContributions += 1;
        }
        if (summary.insertedPendingContribution) {
          report.insertedPendingContributions += 1;
        }
        if (summary.skippedDueToSuspiciousFirstTwo) {
          report.skippedSuspiciousFirstTwo += 1;
        }
        const notes = Array.isArray(summary.notes) ? summary.notes.map((item) => String(item || '')) : [];
        if (notes.some((note) => note.toLowerCase().includes('no pending give found'))) {
          report.usersWithoutPendingGive += 1;
        }
      } else {
        report.failed += 1;
      }

      report.results.push({
        sourceUserCode: candidate.userCode,
        sourceLevelNo: candidate.sourceLevelNo,
        candidateReasons: candidate.candidateReasons,
        ok: runResult.ok,
        exitCode: runResult.exitCode,
        summary: runResult.summary,
        stderr: runResult.stderr || undefined,
        stdout: runResult.summary ? undefined : (runResult.stdout || undefined)
      });
    }

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exit(1);
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

main();
