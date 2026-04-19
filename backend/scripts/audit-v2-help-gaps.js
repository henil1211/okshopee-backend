import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

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

function toIso(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function truncate(str, max = 160) {
  const value = String(str || '');
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function usageAndExit() {
  console.log('Usage:');
  console.log('  node scripts/audit-v2-help-gaps.js');
  console.log('  node scripts/audit-v2-help-gaps.js --users 7497863,8462229');
  console.log('  node scripts/audit-v2-help-gaps.js --stale-minutes 20 --limit 5000 --event-limit 5000');
  console.log('');
  console.log('Flags:');
  console.log('  --users          Comma separated user codes (filters source or beneficiary).');
  console.log('  --limit          Max pending contribution rows to inspect (default 10000, max 50000).');
  console.log('  --event-limit    Max help queue rows to inspect (default 5000, max 50000).');
  console.log('  --stale-minutes  Treat queued help-events older than this as stale (default 30).');
  console.log('  --json           Output compact JSON only.');
  process.exit(1);
}

function buildUserFilterClause(columnA, columnB, userCodes) {
  if (!Array.isArray(userCodes) || userCodes.length === 0) {
    return { clause: '', params: [] };
  }
  const placeholders = userCodes.map(() => '?').join(', ');
  return {
    clause: ` AND (${columnA} IN (${placeholders}) OR ${columnB} IN (${placeholders}))`,
    params: [...userCodes, ...userCodes]
  };
}

function pushByKeyCount(map, key) {
  const normalized = String(key || '').trim() || 'unknown';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function sortedCountEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function main() {
  const usersArg = readArg('--users', '');
  const users = usersArg
    ? usersArg.split(',').map((v) => normalizeUserCode(v)).filter(Boolean)
    : [];

  const rawLimit = Number(readArg('--limit', '10000'));
  const rawEventLimit = Number(readArg('--event-limit', '5000'));
  const rawStaleMinutes = Number(readArg('--stale-minutes', '30'));

  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50000, Math.trunc(rawLimit))) : 10000;
  const eventLimit = Number.isFinite(rawEventLimit) ? Math.max(1, Math.min(50000, Math.trunc(rawEventLimit))) : 5000;
  const staleMinutes = Number.isFinite(rawStaleMinutes) ? Math.max(1, Math.min(24 * 60, Math.trunc(rawStaleMinutes))) : 30;
  const jsonOnly = hasFlag('--json');

  if (hasFlag('--help') || hasFlag('-h')) {
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
    const contribFilter = buildUserFilterClause('src.user_code', 'ben.user_code', users);
    const [contribRows] = await pool.execute(
      `SELECT
         pc.id,
         pc.source_event_key,
         src.user_code AS source_user_code,
         src.status AS source_status,
         ben.user_code AS beneficiary_user_code,
         ben.status AS beneficiary_status,
         pc.level_no,
         pc.side,
         pc.amount_cents,
         pc.status AS contribution_status,
         pc.reason,
         pc.created_at,
         pc.processed_at,
         pc.processed_txn_id,
         COALESCE(ss.pending_give_cents, 0) AS source_pending_give_cents,
         lt.id AS ledger_txn_exists
       FROM v2_help_pending_contributions pc
       INNER JOIN v2_users src ON src.id = pc.source_user_id
       INNER JOIN v2_users ben ON ben.id = pc.beneficiary_user_id
       LEFT JOIN v2_help_level_state ss
         ON ss.user_id = pc.source_user_id AND ss.level_no = pc.level_no
       LEFT JOIN v2_ledger_transactions lt ON lt.id = pc.processed_txn_id
       WHERE 1 = 1${contribFilter.clause}
       ORDER BY pc.id DESC
       LIMIT ?`,
      [...contribFilter.params, limit]
    );

    const queueFilter = buildUserFilterClause('src.user_code', 'nm.user_code', users);
    const [queueRows] = await pool.execute(
      `SELECT
         q.id,
         q.event_key,
         q.status AS queue_status,
         q.source_ref,
         q.created_at,
         q.processed_at,
         actor.user_code AS actor_user_code,
         src.user_code AS source_user_code,
         nm.user_code AS new_member_user_code,
         q.payload_json
       FROM v2_help_events_queue q
       INNER JOIN v2_users actor ON actor.id = q.actor_user_id
       INNER JOIN v2_users src ON src.id = q.source_user_id
       INNER JOIN v2_users nm ON nm.id = q.new_member_user_id
       WHERE q.status <> 'processed'${queueFilter.clause}
       ORDER BY q.id DESC
       LIMIT ?`,
      [...queueFilter.params, eventLimit]
    );

    const now = Date.now();
    const staleMs = staleMinutes * 60 * 1000;

    const failedContributions = [];
    const pendingReadyContributions = [];
    const pendingWaitingContributions = [];
    const processedBrokenContributions = [];

    const affectedSourceCounts = new Map();
    const affectedBeneficiaryCounts = new Map();

    for (const row of Array.isArray(contribRows) ? contribRows : []) {
      const status = String(row.contribution_status || '').trim().toLowerCase();
      const sourceUserCode = String(row.source_user_code || '');
      const beneficiaryUserCode = String(row.beneficiary_user_code || '');
      const amountCents = Number(row.amount_cents || 0);
      const pendingGiveCents = Number(row.source_pending_give_cents || 0);
      const base = {
        id: Number(row.id || 0),
        sourceEventKey: String(row.source_event_key || ''),
        sourceUserCode,
        beneficiaryUserCode,
        levelNo: Number(row.level_no || 0),
        side: String(row.side || 'unknown'),
        amountCents,
        sourcePendingGiveCents: pendingGiveCents,
        reason: row.reason ? truncate(row.reason, 180) : null,
        createdAt: toIso(row.created_at),
        processedAt: toIso(row.processed_at),
        sourceStatus: String(row.source_status || ''),
        beneficiaryStatus: String(row.beneficiary_status || '')
      };

      if (status === 'failed') {
        failedContributions.push(base);
        pushByKeyCount(affectedSourceCounts, sourceUserCode);
        pushByKeyCount(affectedBeneficiaryCounts, beneficiaryUserCode);
        continue;
      }

      if (status === 'pending') {
        if (pendingGiveCents >= amountCents && amountCents > 0) {
          pendingReadyContributions.push(base);
          pushByKeyCount(affectedSourceCounts, sourceUserCode);
          pushByKeyCount(affectedBeneficiaryCounts, beneficiaryUserCode);
        } else {
          pendingWaitingContributions.push(base);
        }
        continue;
      }

      if (status === 'processed') {
        const processedTxnId = Number(row.processed_txn_id || 0);
        const ledgerExists = Number(row.ledger_txn_exists || 0) > 0;
        if (!processedTxnId || !ledgerExists) {
          processedBrokenContributions.push({
            ...base,
            processedTxnId: processedTxnId || null,
            ledgerTxnExists: ledgerExists
          });
          pushByKeyCount(affectedSourceCounts, sourceUserCode);
          pushByKeyCount(affectedBeneficiaryCounts, beneficiaryUserCode);
        }
      }
    }

    const failedQueueEvents = [];
    const staleQueuedEvents = [];

    for (const row of Array.isArray(queueRows) ? queueRows : []) {
      const status = String(row.queue_status || '').trim().toLowerCase();
      const createdAtTs = new Date(row.created_at).getTime();
      const ageMs = Number.isFinite(createdAtTs) ? Math.max(0, now - createdAtTs) : 0;
      const payload = parseJson(row.payload_json);
      const entry = {
        id: Number(row.id || 0),
        eventKey: String(row.event_key || ''),
        sourceRef: String(row.source_ref || ''),
        queueStatus: status,
        actorUserCode: String(row.actor_user_code || ''),
        sourceUserCode: String(row.source_user_code || ''),
        newMemberUserCode: String(row.new_member_user_code || ''),
        createdAt: toIso(row.created_at),
        processedAt: toIso(row.processed_at),
        ageMinutes: Math.round(ageMs / 60000),
        payloadError: payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? truncate(payload.error, 180)
          : null,
        payloadErrorCode: payload && typeof payload === 'object' && typeof payload.errorCode === 'string'
          ? String(payload.errorCode)
          : null
      };

      if (status === 'failed') {
        failedQueueEvents.push(entry);
        pushByKeyCount(affectedSourceCounts, entry.sourceUserCode);
        pushByKeyCount(affectedBeneficiaryCounts, entry.newMemberUserCode);
      } else if (status === 'queued' && ageMs >= staleMs) {
        staleQueuedEvents.push(entry);
        pushByKeyCount(affectedSourceCounts, entry.sourceUserCode);
        pushByKeyCount(affectedBeneficiaryCounts, entry.newMemberUserCode);
      }
    }

    const summary = {
      scope: {
        usersFilter: users,
        staleMinutes,
        contributionRowsScanned: Array.isArray(contribRows) ? contribRows.length : 0,
        queueRowsScanned: Array.isArray(queueRows) ? queueRows.length : 0,
        contributionScanLimit: limit,
        queueScanLimit: eventLimit
      },
      suspicious: {
        failedContributions: failedContributions.length,
        pendingReadyContributions: pendingReadyContributions.length,
        processedBrokenContributions: processedBrokenContributions.length,
        failedQueueEvents: failedQueueEvents.length,
        staleQueuedEvents: staleQueuedEvents.length
      },
      informational: {
        pendingWaitingContributions: pendingWaitingContributions.length
      },
      topAffectedSources: sortedCountEntries(affectedSourceCounts, 25),
      topAffectedBeneficiaries: sortedCountEntries(affectedBeneficiaryCounts, 25)
    };

    const report = {
      summary,
      samples: {
        failedContributions: failedContributions.slice(0, 100),
        pendingReadyContributions: pendingReadyContributions.slice(0, 100),
        processedBrokenContributions: processedBrokenContributions.slice(0, 100),
        failedQueueEvents: failedQueueEvents.slice(0, 100),
        staleQueuedEvents: staleQueuedEvents.slice(0, 100),
        pendingWaitingContributions: pendingWaitingContributions.slice(0, 100)
      }
    };

    if (jsonOnly) {
      console.log(JSON.stringify(report));
      return;
    }

    console.log('--- V2 Help Gap Audit ---');
    console.log(JSON.stringify(summary, null, 2));

    if (report.samples.pendingReadyContributions.length > 0) {
      console.log('');
      console.log('[sample] pending-ready contributions (should settle but still pending):');
      for (const item of report.samples.pendingReadyContributions.slice(0, 15)) {
        console.log(`- ${item.sourceUserCode} -> ${item.beneficiaryUserCode} level ${item.levelNo} amount ${item.amountCents}c (pendingGive ${item.sourcePendingGiveCents}c)`);
      }
    }

    if (report.samples.failedQueueEvents.length > 0) {
      console.log('');
      console.log('[sample] failed help queue events:');
      for (const item of report.samples.failedQueueEvents.slice(0, 15)) {
        console.log(`- ${item.eventKey} status=failed source=${item.sourceUserCode} member=${item.newMemberUserCode} error=${item.payloadErrorCode || 'N/A'} ${item.payloadError || ''}`);
      }
    }

    if (report.samples.staleQueuedEvents.length > 0) {
      console.log('');
      console.log(`[sample] stale queued events older than ${staleMinutes}m:`);
      for (const item of report.samples.staleQueuedEvents.slice(0, 15)) {
        console.log(`- ${item.eventKey} age=${item.ageMinutes}m source=${item.sourceUserCode} member=${item.newMemberUserCode}`);
      }
    }

    console.log('');
    console.log('Tip: Use --json to capture full report and share exact affected user IDs for targeted replay/fix.');
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'ER_NO_SUCH_TABLE') {
      console.error('Required v2 help tables are missing. Ensure backend migrations/startup has run.');
    } else {
      console.error(`[fatal] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
