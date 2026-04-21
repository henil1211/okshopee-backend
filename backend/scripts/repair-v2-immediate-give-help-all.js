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

async function loadCandidateUserCodes(connection, limit, explicitUserCodes = []) {
  if (explicitUserCodes.length > 0) {
    return explicitUserCodes;
  }

  const safeLimit = Math.max(1, Math.min(5000, Number(limit || 500)));
  const [rows] = await connection.execute(
    `SELECT u.user_code
     FROM v2_help_level_state hs
     INNER JOIN v2_users u ON u.id = hs.user_id
     WHERE hs.level_no = 1
       AND hs.pending_give_cents > 0
       AND u.status = 'active'
     ORDER BY hs.pending_give_cents DESC, hs.updated_at ASC
     LIMIT ?`,
    [safeLimit]
  );

  const list = Array.isArray(rows) ? rows : [];
  const unique = new Set();
  for (const row of list) {
    const code = normalizeUserCode(row?.user_code);
    if (!code) continue;
    unique.add(code);
  }

  return Array.from(unique);
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
    const userCodes = await loadCandidateUserCodes(connection, limitArg, explicitUserCodes);

    const report = {
      mode: dryRun ? 'dry-run' : 'apply',
      scannedCandidates: userCodes.length,
      succeeded: 0,
      failed: 0,
      processedContributions: 0,
      insertedPendingContributions: 0,
      usersWithoutPendingGive: 0,
      targetUsers: userCodes,
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
