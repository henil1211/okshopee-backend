import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readArg(name) {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index === -1) return '';
  return String(process.argv[index + 1] || '').trim();
}

function normalizeUserCode(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{3,20}$/.test(normalized) ? normalized : '';
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/requeue-missing-v2-registration-help.js --users <code1,code2,...> [--apply]');
  console.log('  node scripts/requeue-missing-v2-registration-help.js --all-missing [--limit <n>] [--apply]');
  console.log('  node scripts/requeue-missing-v2-registration-help.js --all-missing --include-legacy [--limit <n>] [--apply]');
  console.log('');
  console.log('Flags:');
  console.log('  --apply        Actually enqueue retry tasks. Without this flag it runs in dry mode.');
  console.log('  --users        Comma separated user codes to evaluate.');
  console.log('  --all-missing  Auto-detect users missing processed registration help event.');
  console.log('  --include-legacy  Include legacy seeded users (default is v2-registration candidates only).');
  console.log('  --limit        Max user codes when using --all-missing (default 200, max 2000).');
  process.exit(1);
}

async function ensureRetryQueueTable(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS v2_post_registration_retry_queue (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      task_key VARCHAR(190) NOT NULL,
      task_type ENUM('referral_credit','help_event') NOT NULL,
      registration_user_code VARCHAR(20) NOT NULL,
      registration_user_name VARCHAR(120) NULL,
      target_user_code VARCHAR(20) NULL,
      target_user_name VARCHAR(120) NULL,
      payload_json JSON NOT NULL,
      status ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      max_attempts INT UNSIGNED NOT NULL DEFAULT 40,
      next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_attempt_at DATETIME(3) NULL,
      last_error VARCHAR(280) NULL,
      last_error_code VARCHAR(80) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      processed_at DATETIME(3) NULL,
      UNIQUE KEY uq_v2_post_reg_queue_task_key (task_key),
      KEY idx_v2_post_reg_queue_status_next (status, next_attempt_at),
      KEY idx_v2_post_reg_queue_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function detectMissingUsers(pool, limit, { includeLegacy = false } = {}) {
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
  const includeLegacyFlag = includeLegacy ? 1 : 0;
  const [rows] = await pool.execute(
    `SELECT u.user_code
     FROM v2_users u
     LEFT JOIN v2_registration_profiles rp ON rp.user_id = u.id
     LEFT JOIN v2_help_events_queue q
       ON q.event_key = CONCAT('HELP:reg_help_', u.user_code, '_', u.user_code, ':', u.user_code, ':', u.user_code, ':activation_join')
      AND q.status = 'processed'
     WHERE u.status = 'active'
       AND COALESCE(rp.is_admin, 0) = 0
       AND (
         ? = 1
         OR rp.user_id IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM v2_post_registration_retry_queue rq
           WHERE rq.registration_user_code = u.user_code
         )
       )
       AND q.id IS NULL
     ORDER BY u.id ASC
     LIMIT ?`,
    [includeLegacyFlag, safeLimit]
  );

  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeUserCode(row?.user_code))
    .filter(Boolean);
}

async function readHelpEventStatus(pool, eventKey) {
  const [rows] = await pool.execute(
    `SELECT id, status, processed_at
     FROM v2_help_events_queue
     WHERE event_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [eventKey]
  );

  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) {
    return { exists: false, status: null, processedAt: null };
  }

  return {
    exists: true,
    status: String(row.status || '').trim().toLowerCase() || null,
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null
  };
}

async function enqueueHelpReplayTask(pool, userCode) {
  const sourceRef = `reg_help_${userCode}_${userCode}`;
  const taskKey = `help:${sourceRef}:${userCode}:${userCode}`;
  const payload = JSON.stringify({
    sourceUserCode: userCode,
    newMemberUserCode: userCode,
    sourceRef,
    eventType: 'activation_join',
    description: `Replay registration help event for ${userCode}`
  });

  await pool.execute(
    `INSERT INTO v2_post_registration_retry_queue
      (task_key, task_type, registration_user_code, registration_user_name,
       target_user_code, target_user_name, payload_json, status, attempts, max_attempts,
       next_attempt_at, last_attempt_at, last_error, last_error_code, processed_at)
     VALUES
      (?, 'help_event', ?, ?, ?, ?, ?, 'queued', 0, 40, NOW(3), NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
      registration_user_code = VALUES(registration_user_code),
      registration_user_name = VALUES(registration_user_name),
      target_user_code = VALUES(target_user_code),
      target_user_name = VALUES(target_user_name),
      payload_json = VALUES(payload_json),
      max_attempts = VALUES(max_attempts),
      status = IF(status = 'completed', 'completed', 'queued'),
      attempts = IF(status = 'completed', attempts, 0),
      next_attempt_at = IF(status = 'completed', next_attempt_at, NOW(3)),
      last_attempt_at = IF(status = 'completed', last_attempt_at, NULL),
      last_error = NULL,
      last_error_code = NULL,
      processed_at = IF(status = 'completed', processed_at, NULL)`,
    [taskKey, userCode, userCode, userCode, userCode, payload]
  );

  return { taskKey, sourceRef };
}

async function main() {
  const apply = hasFlag('--apply');
  const allMissing = hasFlag('--all-missing');
  const includeLegacy = hasFlag('--include-legacy');
  const usersArg = readArg('--users');
  const limitArg = readArg('--limit');

  let userCodes = [];
  if (usersArg) {
    userCodes = usersArg
      .split(',')
      .map((value) => normalizeUserCode(value))
      .filter(Boolean);
  }

  if (!allMissing && userCodes.length === 0) {
    usageAndExit();
  }

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'matrixmlm',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  try {
    await ensureRetryQueueTable(pool);

    if (allMissing) {
      userCodes = await detectMissingUsers(pool, limitArg, { includeLegacy });
      console.log(`[detect] scope: ${includeLegacy ? 'legacy+v2' : 'v2-registration-candidates'}`);
      console.log(`[detect] missing users: ${userCodes.length}`);
      if (userCodes.length > 0) {
        console.log(`[detect] user codes: ${userCodes.join(', ')}`);
      }
    }

    if (userCodes.length === 0) {
      console.log('No users to process.');
      return;
    }

    const summary = {
      scanned: 0,
      alreadyProcessed: 0,
      missingOrFailed: 0,
      queued: 0,
      dryRunReady: 0,
      errors: 0
    };

    for (const userCode of userCodes) {
      summary.scanned += 1;
      const sourceRef = `reg_help_${userCode}_${userCode}`;
      const eventKey = `HELP:${sourceRef}:${userCode}:${userCode}:activation_join`;

      try {
        const state = await readHelpEventStatus(pool, eventKey);
        const isDone = state.exists && state.status === 'processed';
        if (isDone) {
          summary.alreadyProcessed += 1;
          console.log(`[skip] ${userCode} already processed (${state.processedAt || 'unknown time'})`);
          continue;
        }

        summary.missingOrFailed += 1;
        if (!apply) {
          summary.dryRunReady += 1;
          console.log(`[dry-run] ${userCode} -> would enqueue help replay`);
          continue;
        }

        const queued = await enqueueHelpReplayTask(pool, userCode);
        summary.queued += 1;
        console.log(`[queued] ${userCode} -> ${queued.taskKey}`);
      } catch (error) {
        summary.errors += 1;
        console.error(`[error] ${userCode}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('');
    console.log('Summary:');
    console.log(JSON.stringify(summary, null, 2));
    if (apply && summary.queued > 0) {
      console.log('Queued tasks will be processed by backend post-registration queue worker (default interval ~20s).');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
