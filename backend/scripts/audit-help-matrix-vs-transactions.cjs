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
    label: 'help-matrix-vs-transactions-audit',
    userCodes: []
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
      case 'label':
        args.label = value;
        break;
      case 'user-codes':
        args.userCodes = String(value || '')
          .split(',')
          .map((v) => String(v || '').trim())
          .filter(Boolean);
        break;
      default:
        break;
    }
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function safeParseJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function toInt(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

function normalizeCode(value) {
  const code = String(value || '').trim();
  return /^\d{7}$/.test(code) ? code : code;
}

function normalizeLegacyLevelFromTransaction(tx) {
  const numericLevel = toInt(tx?.level);
  if (numericLevel > 0) return numericLevel;

  const desc = String(tx?.description || tx?.notes || '').toLowerCase();
  const match = desc.match(/\blevel\s+(\d+)\b/i);
  const parsed = match ? toInt(match[1]) : 0;
  return parsed > 0 ? parsed : 1;
}

function buildLegacyUserLookups(legacyUsers) {
  const byInternal = new Map();
  const byPublicCode = new Map();

  for (const user of legacyUsers) {
    const internal = String(user?.id || '').trim();
    const publicCode = normalizeCode(user?.userId);
    if (internal) byInternal.set(internal, user);
    if (publicCode) byPublicCode.set(publicCode, user);
  }

  return { byInternal, byPublicCode };
}

function resolveLegacyUserByRef(ref, lookups) {
  const rawRef = String(ref || '').trim();
  if (!rawRef) return null;

  const fromInternal = lookups.byInternal.get(rawRef) || null;
  if (fromInternal) return fromInternal;

  const normalizedCode = normalizeCode(rawRef);
  return lookups.byPublicCode.get(normalizedCode) || null;
}

function resolveUserCode(ref, lookups) {
  const user = resolveLegacyUserByRef(ref, lookups);
  const code = normalizeCode(user?.userId || ref);
  return code || null;
}

function edgeKey(sourceCode, beneficiaryCode, levelNo) {
  return `${sourceCode}|${beneficiaryCode}|${levelNo}`;
}

function parseEdgeKey(key) {
  const [sourceUserCode, beneficiaryUserCode, levelRaw] = String(key).split('|');
  return {
    sourceUserCode,
    beneficiaryUserCode,
    levelNo: toInt(levelRaw)
  };
}

async function loadStateRows(conn) {
  const [rows] = await conn.query(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN (
       'mlm_users',
       'mlm_matrix',
       'mlm_matrix_pending_contributions',
       'mlm_transactions'
     )`
  );

  const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key), row.state_value]));
  const legacyUsers = safeParseJson(byKey.get('mlm_users') || '[]', []);
  const legacyMatrix = safeParseJson(byKey.get('mlm_matrix') || '[]', []);
  const legacyPending = safeParseJson(byKey.get('mlm_matrix_pending_contributions') || '[]', []);
  const legacyTransactions = safeParseJson(byKey.get('mlm_transactions') || '[]', []);

  return {
    legacyUsers: Array.isArray(legacyUsers) ? legacyUsers : [],
    legacyMatrix: Array.isArray(legacyMatrix) ? legacyMatrix : [],
    legacyPending: Array.isArray(legacyPending) ? legacyPending : [],
    legacyTransactions: Array.isArray(legacyTransactions) ? legacyTransactions : []
  };
}

function buildPendingEdgeSet({ legacyPending, lookups, allowedCodes }) {
  const pendingEdges = new Set();
  const unresolved = [];

  for (const item of legacyPending) {
    if (!item || typeof item !== 'object') continue;
    const status = String(item.status || '').trim().toLowerCase();
    if (status && status !== 'pending') continue;

    const levelNo = toInt(item.level);
    if (!levelNo) continue;

    const sourceCode = resolveUserCode(item.fromUserId, lookups);
    const beneficiaryCode = resolveUserCode(item.toUserId, lookups);
    if (!sourceCode || !beneficiaryCode) {
      unresolved.push({
        sourceRef: String(item.fromUserId || ''),
        beneficiaryRef: String(item.toUserId || ''),
        levelNo,
        reason: 'invalid_pending_user_reference'
      });
      continue;
    }

    if (
      allowedCodes.size > 0
      && !allowedCodes.has(sourceCode)
      && !allowedCodes.has(beneficiaryCode)
    ) {
      continue;
    }

    pendingEdges.add(edgeKey(sourceCode, beneficiaryCode, levelNo));
  }

  return { pendingEdges, unresolvedPending: unresolved };
}

function buildExpectedEdgesFromMatrix({ legacyMatrix, lookups, pendingEdges, allowedCodes }) {
  const parentByCode = new Map();
  const unresolved = [];

  for (const node of legacyMatrix) {
    if (!node || typeof node !== 'object') continue;
    const userCode = normalizeCode(node.userId);
    if (!userCode) continue;

    let parentCode = null;
    if (node.parentId != null && String(node.parentId).trim() !== '') {
      parentCode = resolveUserCode(node.parentId, lookups);
    }

    parentByCode.set(userCode, parentCode || null);
  }

  const expectedProcessed = new Set();
  const expectedPending = new Set();
  const expectedAll = new Set();

  for (const sourceCode of parentByCode.keys()) {
    if (!sourceCode) continue;
    if (allowedCodes.size > 0 && !allowedCodes.has(sourceCode)) continue;

    const visited = new Set([sourceCode]);
    let levelNo = 1;
    let current = sourceCode;

    while (levelNo <= 20) {
      const parentCode = parentByCode.get(current) || null;
      if (!parentCode) break;

      if (visited.has(parentCode)) {
        unresolved.push({
          sourceUserCode: sourceCode,
          parentUserCode: parentCode,
          levelNo,
          reason: 'matrix_cycle_detected'
        });
        break;
      }
      visited.add(parentCode);

      if (allowedCodes.size > 0 && !allowedCodes.has(parentCode) && !allowedCodes.has(sourceCode)) {
        current = parentCode;
        levelNo += 1;
        continue;
      }

      const key = edgeKey(sourceCode, parentCode, levelNo);
      expectedAll.add(key);
      if (pendingEdges.has(key)) {
        expectedPending.add(key);
      } else {
        expectedProcessed.add(key);
      }

      current = parentCode;
      levelNo += 1;
    }
  }

  return { expectedProcessed, expectedPending, expectedAll, unresolvedExpected: unresolved };
}

function buildActualEdgesFromTransactions({ legacyTransactions, lookups, allowedCodes }) {
  const counts = new Map();
  const unresolved = [];

  for (const tx of legacyTransactions) {
    if (!tx || typeof tx !== 'object') continue;

    const type = String(tx.type || '').trim().toLowerCase();
    const status = String(tx.status || '').trim().toLowerCase();
    const amount = Number(tx.amount || 0);
    if (status !== 'completed' || type !== 'receive_help' || amount <= 0) continue;

    const beneficiaryCode = resolveUserCode(tx.userId, lookups);
    const sourceCode = resolveUserCode(tx.fromUserId, lookups);
    const levelNo = normalizeLegacyLevelFromTransaction(tx);

    if (!beneficiaryCode || !sourceCode || !levelNo) {
      unresolved.push({
        txId: String(tx.id || ''),
        sourceRef: String(tx.fromUserId || ''),
        beneficiaryRef: String(tx.userId || ''),
        levelNo,
        reason: 'invalid_transaction_user_reference_or_level'
      });
      continue;
    }

    if (
      allowedCodes.size > 0
      && !allowedCodes.has(sourceCode)
      && !allowedCodes.has(beneficiaryCode)
    ) {
      continue;
    }

    const key = edgeKey(sourceCode, beneficiaryCode, levelNo);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return { actualCounts: counts, unresolvedActual: unresolved };
}

function summarizeDiscrepancy({ expectedProcessed, expectedPending, expectedAll, actualCounts }) {
  const actualKeys = new Set(actualCounts.keys());

  const duplicateProcessed = [];
  for (const [key, count] of actualCounts.entries()) {
    if (count > 1) {
      duplicateProcessed.push({ ...parseEdgeKey(key), count });
    }
  }

  const missingProcessed = [];
  for (const key of expectedProcessed) {
    if (!actualKeys.has(key)) missingProcessed.push(parseEdgeKey(key));
  }

  const extraProcessed = [];
  for (const key of actualKeys) {
    if (!expectedAll.has(key)) {
      extraProcessed.push({ ...parseEdgeKey(key), count: actualCounts.get(key) || 0 });
    }
  }

  const processedThatAreExpectedPending = [];
  for (const key of actualKeys) {
    if (expectedPending.has(key)) {
      processedThatAreExpectedPending.push({ ...parseEdgeKey(key), count: actualCounts.get(key) || 0 });
    }
  }

  const byLevel = {};
  const collectLevel = (bucket, list) => {
    for (const row of list) {
      const level = String(row.levelNo || 0);
      if (!bucket[level]) bucket[level] = 0;
      bucket[level] += 1;
    }
  };
  collectLevel(byLevel, missingProcessed);

  return {
    expectedProcessedEdges: expectedProcessed.size,
    expectedPendingEdges: expectedPending.size,
    actualProcessedEdgesDistinct: actualKeys.size,
    actualProcessedEdgesTotal: Array.from(actualCounts.values()).reduce((sum, value) => sum + Number(value || 0), 0),
    duplicateProcessedCount: duplicateProcessed.length,
    missingProcessedCount: missingProcessed.length,
    extraProcessedCount: extraProcessed.length,
    processedThatAreExpectedPendingCount: processedThatAreExpectedPending.length,
    missingByLevel: byLevel,
    duplicateProcessedSample: duplicateProcessed.slice(0, 200),
    missingProcessedSample: missingProcessed.slice(0, 200),
    extraProcessedSample: extraProcessed.slice(0, 200),
    processedThatAreExpectedPendingSample: processedThatAreExpectedPending.slice(0, 200)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const allowedCodes = new Set(args.userCodes.map((code) => normalizeCode(code)).filter(Boolean));
    const stateRows = await loadStateRows(conn);
    const lookups = buildLegacyUserLookups(stateRows.legacyUsers);

    const pendingResult = buildPendingEdgeSet({
      legacyPending: stateRows.legacyPending,
      lookups,
      allowedCodes
    });

    const expectedResult = buildExpectedEdgesFromMatrix({
      legacyMatrix: stateRows.legacyMatrix,
      lookups,
      pendingEdges: pendingResult.pendingEdges,
      allowedCodes
    });

    const actualResult = buildActualEdgesFromTransactions({
      legacyTransactions: stateRows.legacyTransactions,
      lookups,
      allowedCodes
    });

    const summary = {
      selectedUserCodes: args.userCodes,
      matrixNodes: stateRows.legacyMatrix.length,
      pendingRows: stateRows.legacyPending.length,
      transactionRows: stateRows.legacyTransactions.length,
      unresolvedPendingCount: pendingResult.unresolvedPending.length,
      unresolvedExpectedCount: expectedResult.unresolvedExpected.length,
      unresolvedActualCount: actualResult.unresolvedActual.length,
      unresolvedPendingSample: pendingResult.unresolvedPending.slice(0, 200),
      unresolvedExpectedSample: expectedResult.unresolvedExpected.slice(0, 200),
      unresolvedActualSample: actualResult.unresolvedActual.slice(0, 200),
      discrepancies: summarizeDiscrepancy({
        expectedProcessed: expectedResult.expectedProcessed,
        expectedPending: expectedResult.expectedPending,
        expectedAll: expectedResult.expectedAll,
        actualCounts: actualResult.actualCounts
      })
    };

    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

    console.log('Matrix-vs-transactions help audit complete.');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Evidence: ${evidenceDir}`);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
