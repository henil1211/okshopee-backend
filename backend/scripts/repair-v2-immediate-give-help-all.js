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

function runSingleUserRepair({ sourceUserCode, apply }) {
  return new Promise((resolve) => {
    const args = [
      SINGLE_USER_SCRIPT,
      '--source-user-code',
      sourceUserCode,
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
  if (explicitUserCodes.length > 0) {
    return explicitUserCodes.map((userCode) => ({
      userCode,
      candidateReasons: ['explicit_user_codes'],
      pendingGiveCents: 0,
      impliedPendingGiveCents: 0,
      pendingLevel2Rows: 0
    }));
  }

  const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
  const [rows] = await connection.execute(
    `SELECT
       u.user_code,
       COALESCE(hs.pending_give_cents, 0) AS pending_give_cents,
       COALESCE(hs.given_cents, 0) AS given_cents,
       COALESCE(l1.distinct_sources, 0) AS distinct_sources,
       COALESCE(l1.total_locked_cents, 0) AS total_locked_cents,
       COALESCE(p2.pending_rows, 0) AS pending_level2_rows,
       COALESCE(p2.pending_cents, 0) AS pending_level2_cents,
       GREATEST(0, COALESCE(l1.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)) AS implied_pending_give_cents
     FROM v2_users u
     LEFT JOIN v2_help_level_state hs
       ON hs.user_id = u.id
      AND hs.level_no = 1
     LEFT JOIN (
       SELECT
         pc.beneficiary_user_id AS user_id,
         COUNT(DISTINCT pc.source_user_id) AS distinct_sources,
         COALESCE(SUM(pc.amount_cents), 0) AS total_locked_cents
       FROM v2_help_pending_contributions pc
       WHERE pc.level_no = 1
         AND pc.status = 'processed'
         AND pc.reason = 'locked_for_give'
       GROUP BY pc.beneficiary_user_id
     ) l1 ON l1.user_id = u.id
     LEFT JOIN (
       SELECT
         pc.source_user_id AS user_id,
         COUNT(*) AS pending_rows,
         COALESCE(SUM(pc.amount_cents), 0) AS pending_cents
       FROM v2_help_pending_contributions pc
       WHERE pc.level_no = 2
         AND pc.status = 'pending'
       GROUP BY pc.source_user_id
     ) p2 ON p2.user_id = u.id
     WHERE u.status = 'active'
       AND (
         COALESCE(hs.pending_give_cents, 0) > 0
         OR (
           COALESCE(l1.distinct_sources, 0) >= 2
           AND GREATEST(0, COALESCE(l1.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)) > 0
         )
       )
     ORDER BY
       GREATEST(
         COALESCE(hs.pending_give_cents, 0),
         GREATEST(0, COALESCE(l1.total_locked_cents, 0) - COALESCE(hs.given_cents, 0)),
         COALESCE(p2.pending_cents, 0)
       ) DESC,
       u.created_at ASC
     LIMIT ?`,
    [safeLimit]
  );

  const list = Array.isArray(rows) ? rows : [];
  const users = [];
  const seen = new Set();
  for (const row of list) {
    const userCode = normalizeUserCode(row?.user_code);
    if (!userCode || seen.has(userCode)) continue;
    seen.add(userCode);

    const pendingGiveCents = Math.max(0, Number(row?.pending_give_cents || 0));
    const impliedPendingGiveCents = Math.max(0, Number(row?.implied_pending_give_cents || 0));
    const pendingLevel2Rows = Math.max(0, Number(row?.pending_level2_rows || 0));
    const distinctSources = Math.max(0, Number(row?.distinct_sources || 0));

    const candidateReasons = [];
    if (pendingGiveCents > 0) candidateReasons.push('level1_pending_give');
    if (impliedPendingGiveCents > 0 && distinctSources >= 2) candidateReasons.push('locked_first_two_implied_pending');
    if (pendingLevel2Rows > 0 && (pendingGiveCents > 0 || impliedPendingGiveCents > 0)) {
      candidateReasons.push('pending_level2_rows');
    }

    users.push({
      userCode,
      candidateReasons,
      pendingGiveCents,
      impliedPendingGiveCents,
      pendingLevel2Rows
    });
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
    const userCodes = candidateUsers.map((item) => item.userCode);

    const report = {
      mode: dryRun ? 'dry-run' : 'apply',
      scannedCandidates: userCodes.length,
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

    for (const sourceUserCode of userCodes) {
      const runResult = await runSingleUserRepair({ sourceUserCode, apply: !dryRun });

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
        sourceUserCode,
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
