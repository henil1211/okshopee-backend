#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function parseArgs(argv) {
  const args = {
    apply: false,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    userCode: '',
    since: '',
    limit: 5000,
    label: 'pin-integrity'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;

    const [key, inlineValue] = item.slice(2).split('=');
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    if (inlineValue === undefined) i += 1;

    switch (key) {
      case 'apply':
        args.apply = true;
        i -= 1;
        break;
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
      case 'user-code':
        args.userCode = String(value || '').trim();
        break;
      case 'since':
        args.since = String(value || '').trim();
        break;
      case 'limit':
        args.limit = Number(value || 5000);
        break;
      case 'label':
        args.label = String(value || '').trim() || 'pin-integrity';
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 50000) {
    throw new Error('--limit must be between 1 and 50000');
  }

  if (args.since) {
    const t = new Date(args.since).getTime();
    if (!Number.isFinite(t)) {
      throw new Error('--since must be a valid ISO datetime (e.g. 2026-04-01T00:00:00Z)');
    }
  }

  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function parseExpectedQuantity(referenceId) {
  const raw = String(referenceId || '').trim();
  const match = raw.match(/:(\d+)$/);
  if (!match) return null;
  const qty = Number(match[1]);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) return null;
  return qty;
}

function inferPriceCents(row, expectedQty) {
  const minPrice = Number(row.min_price_cents || 0);
  const maxPrice = Number(row.max_price_cents || 0);
  const totalDebit = Number(row.total_debit_cents || 0);

  if (Number(row.pins_count || 0) > 0 && minPrice > 0 && minPrice === maxPrice) {
    return minPrice;
  }

  if (expectedQty && expectedQty > 0 && Number.isInteger(totalDebit) && totalDebit > 0 && totalDebit % expectedQty === 0) {
    const derived = totalDebit / expectedQty;
    return derived > 0 ? derived : null;
  }

  return null;
}

function generateV2PinCode() {
  return randomBytes(8).toString('hex').toUpperCase();
}

async function fetchPinPurchaseRows(conn, args) {
  const where = ["lt.tx_type = 'pin_purchase'", "lt.status = 'posted'"];
  const params = [];

  if (args.userCode) {
    where.push('buyer.user_code = ?');
    params.push(args.userCode);
  }

  if (args.since) {
    where.push('lt.created_at >= ?');
    params.push(args.since);
  }

  params.push(args.limit);

  const sql = `
    SELECT
      lt.id AS ledger_txn_id,
      lt.tx_uuid,
      lt.reference_id,
      lt.created_at,
      lt.total_debit_cents,
      buyer.id AS buyer_user_id,
      buyer.user_code,
      COUNT(p.id) AS pins_count,
      COALESCE(SUM(p.price_cents), 0) AS pins_total_cents,
      MIN(p.price_cents) AS min_price_cents,
      MAX(p.price_cents) AS max_price_cents,
      MIN(p.expires_at) AS sample_expires_at
    FROM v2_ledger_transactions lt
    INNER JOIN v2_ledger_entries de
      ON de.ledger_txn_id = lt.id
     AND de.entry_side = 'debit'
     AND de.wallet_type = 'fund'
    INNER JOIN v2_users buyer
      ON buyer.id = de.user_id
    LEFT JOIN v2_pins p
      ON p.purchased_txn_id = lt.id
    WHERE ${where.join(' AND ')}
    GROUP BY
      lt.id,
      lt.tx_uuid,
      lt.reference_id,
      lt.created_at,
      lt.total_debit_cents,
      buyer.id,
      buyer.user_code
    ORDER BY lt.created_at DESC
    LIMIT ?`;

  const [rows] = await conn.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function buildFindings(rows) {
  const findings = [];

  for (const row of rows) {
    const ledgerTxnId = Number(row.ledger_txn_id || 0);
    const pinsCount = Number(row.pins_count || 0);
    const pinsTotalCents = Number(row.pins_total_cents || 0);
    const totalDebitCents = Number(row.total_debit_cents || 0);
    const expectedQty = parseExpectedQuantity(row.reference_id);
    const inferredPriceCents = inferPriceCents(row, expectedQty);

    const reasons = [];
    if (pinsCount === 0) reasons.push('no_pins_for_posted_purchase');
    if (pinsTotalCents !== totalDebitCents) reasons.push('pins_total_not_equal_debit_total');
    if (expectedQty != null && expectedQty !== pinsCount) reasons.push('pin_count_not_equal_expected_quantity');

    if (reasons.length === 0) continue;

    const missingQty = expectedQty != null ? Math.max(0, expectedQty - pinsCount) : null;
    const canAutoRepair = missingQty != null && missingQty > 0 && Number.isInteger(inferredPriceCents) && inferredPriceCents > 0;

    findings.push({
      ledgerTxnId,
      txUuid: String(row.tx_uuid || ''),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      userCode: String(row.user_code || ''),
      buyerUserId: Number(row.buyer_user_id || 0),
      referenceId: String(row.reference_id || ''),
      totalDebitCents,
      pinsCount,
      pinsTotalCents,
      expectedQty,
      missingQty,
      inferredPriceCents: inferredPriceCents || null,
      canAutoRepair,
      reasons
    });
  }

  return findings;
}

async function insertMissingPinsForFinding(conn, finding) {
  const txId = finding.ledgerTxnId;
  const [lockedRows] = await conn.execute(
    `SELECT id, price_cents, expires_at
     FROM v2_pins
     WHERE purchased_txn_id = ?
     FOR UPDATE`,
    [txId]
  );

  const currentPins = Array.isArray(lockedRows) ? lockedRows : [];
  const currentCount = currentPins.length;
  const expectedQty = Number(finding.expectedQty || 0);
  const missingQty = Math.max(0, expectedQty - currentCount);
  if (missingQty <= 0) {
    return { inserted: 0, skipped: true, reason: 'already_reconciled' };
  }

  const priceFromExisting = currentPins.length > 0
    ? Number(currentPins[0].price_cents || 0)
    : 0;
  const priceCents = priceFromExisting > 0
    ? priceFromExisting
    : Number(finding.inferredPriceCents || 0);
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return { inserted: 0, skipped: true, reason: 'unable_to_determine_price' };
  }

  const expiresAt = currentPins.length > 0
    ? currentPins[0].expires_at || null
    : null;

  let inserted = 0;
  for (let i = 0; i < missingQty; i += 1) {
    let created = false;
    for (let attempt = 0; attempt < 20 && !created; attempt += 1) {
      const pinCode = generateV2PinCode();
      try {
        await conn.execute(
          `INSERT INTO v2_pins
            (pin_code, buyer_user_id, price_cents, status, purchased_txn_id, expires_at)
           VALUES
            (?, ?, ?, 'generated', ?, ?)`,
          [pinCode, finding.buyerUserId, priceCents, txId, expiresAt]
        );
        created = true;
        inserted += 1;
      } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error(`Could not generate unique pin code after retries for ledger_txn_id=${txId}`);
    }
  }

  return { inserted, skipped: false, reason: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'pin-integrity-report.json');
  const summaryPath = path.join(evidenceDir, 'pin-integrity-summary.txt');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const rows = await fetchPinPurchaseRows(conn, args);
    const findings = buildFindings(rows);

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      filters: {
        userCode: args.userCode || null,
        since: args.since || null,
        limit: args.limit
      },
      scannedPurchases: rows.length,
      mismatches: findings
    };

    const applyResults = [];
    if (args.apply) {
      for (const finding of findings) {
        if (!finding.canAutoRepair) {
          applyResults.push({
            ledgerTxnId: finding.ledgerTxnId,
            userCode: finding.userCode,
            action: 'skipped',
            reason: 'not_auto_repairable',
            insertedPins: 0
          });
          continue;
        }

        await conn.beginTransaction();
        try {
          const result = await insertMissingPinsForFinding(conn, finding);
          await conn.commit();
          applyResults.push({
            ledgerTxnId: finding.ledgerTxnId,
            userCode: finding.userCode,
            action: result.skipped ? 'skipped' : 'repaired',
            reason: result.reason,
            insertedPins: result.inserted
          });
        } catch (error) {
          await conn.rollback();
          applyResults.push({
            ledgerTxnId: finding.ledgerTxnId,
            userCode: finding.userCode,
            action: 'failed',
            reason: error instanceof Error ? error.message : String(error),
            insertedPins: 0
          });
        }
      }

      report.applyResults = applyResults;

      const remainingRows = await fetchPinPurchaseRows(conn, args);
      report.remainingMismatchesAfterApply = buildFindings(remainingRows);
    }

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const repairedCount = applyResults.filter((r) => r.action === 'repaired').length;
    const repairedPins = applyResults.reduce((sum, r) => sum + Number(r.insertedPins || 0), 0);
    const failedCount = applyResults.filter((r) => r.action === 'failed').length;
    const remainingCount = Array.isArray(report.remainingMismatchesAfterApply)
      ? report.remainingMismatchesAfterApply.length
      : findings.length;

    const summaryLines = [
      `GeneratedAt: ${report.generatedAt}`,
      `Mode: ${report.mode}`,
      `ScannedPurchases: ${report.scannedPurchases}`,
      `MismatchesFound: ${findings.length}`,
      `AutoRepairable: ${findings.filter((f) => f.canAutoRepair).length}`,
      `RepairedRows: ${repairedCount}`,
      `RepairedPins: ${repairedPins}`,
      `ApplyFailures: ${failedCount}`,
      `RemainingMismatches: ${remainingCount}`,
      `Report: ${reportPath}`
    ];

    fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');

    console.log('--- V2 PIN Purchase Integrity ---');
    summaryLines.forEach((line) => console.log(line));

    if (!args.apply && findings.length > 0) {
      process.exit(2);
    }

    if (args.apply && remainingCount > 0) {
      process.exit(3);
    }

    process.exit(0);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
