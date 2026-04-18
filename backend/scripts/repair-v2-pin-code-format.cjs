#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const PIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_CODE_LENGTH = 7;

function parseArgs(argv) {
  const args = {
    apply: false,
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    userCode: '',
    limit: 5000,
    label: 'pin-code-format'
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
      case 'limit':
        args.limit = Number(value || 5000);
        break;
      case 'label':
        args.label = String(value || '').trim() || 'pin-code-format';
        break;
      default:
        break;
    }
  }

  if (args.userCode && !/^\d{7}$/.test(args.userCode)) {
    throw new Error('--user-code must be a 7-digit user ID when provided');
  }

  if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 50000) {
    throw new Error('--limit must be between 1 and 50000');
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

function toMySqlDateTime(isoString) {
  if (!isoString) return null;
  return isoString.replace('T', ' ').replace('Z', '');
}

function normalizePinCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidSevenCharPinCode(value) {
  return /^[A-Z0-9]{7}$/.test(normalizePinCode(value));
}

function generateSevenCharPinCode() {
  let pin = '';
  const maxIndex = PIN_CODE_CHARS.length;
  for (let i = 0; i < PIN_CODE_LENGTH; i += 1) {
    pin += PIN_CODE_CHARS.charAt(Math.floor(Math.random() * maxIndex));
  }
  return pin;
}

function buildInvalidPinWhereClause() {
  return `
    p.status = 'generated'
    AND (
      CHAR_LENGTH(TRIM(p.pin_code)) <> 7
      OR TRIM(p.pin_code) REGEXP '[^A-Za-z0-9]'
    )`;
}

async function fetchInvalidPins(conn, args, forUpdate = false) {
  const where = [buildInvalidPinWhereClause()];
  const params = [];

  if (args.userCode) {
    where.push('buyer.user_code = ?');
    params.push(args.userCode);
  }

  params.push(args.limit);

  const sql = `
    SELECT
      p.id,
      p.pin_code,
      p.status,
      p.buyer_user_id,
      p.purchased_txn_id,
      p.created_at,
      buyer.user_code
    FROM v2_pins p
    INNER JOIN v2_users buyer ON buyer.id = p.buyer_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.id DESC
    LIMIT ?
    ${forUpdate ? 'FOR UPDATE' : ''}`;

  const [rows] = await conn.execute(sql, params);
  return Array.isArray(rows) ? rows : [];
}

async function loadLegacyStateForUpdate(conn) {
  const [rows] = await conn.execute(
    `SELECT state_key, state_value
     FROM state_store
     WHERE state_key IN ('mlm_pins', 'mlm_pin_purchase_requests')
     FOR UPDATE`
  );

  const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.state_key || ''), row.state_value]));
  const pins = safeParseJson(byKey.get('mlm_pins') || '[]', []);
  const requests = safeParseJson(byKey.get('mlm_pin_purchase_requests') || '[]', []);

  return {
    pins: Array.isArray(pins) ? pins : [],
    requests: Array.isArray(requests) ? requests : []
  };
}

async function pinCodeExistsInV2(conn, pinCode) {
  const [rows] = await conn.execute(
    `SELECT id
     FROM v2_pins
     WHERE pin_code = ?
     LIMIT 1`,
    [pinCode]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function allocateUniquePinCode(conn, reservedCodes) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const candidate = generateSevenCharPinCode();
    if (!isValidSevenCharPinCode(candidate)) continue;
    if (reservedCodes.has(candidate)) continue;
    // Keep uniqueness against current committed DB rows.
    const exists = await pinCodeExistsInV2(conn, candidate);
    if (exists) continue;
    reservedCodes.add(candidate);
    return candidate;
  }
  throw new Error('Unable to generate unique 7-character pin code after retries');
}

function replaceLegacyPinCodes(legacyPins, fromCode, toCode) {
  let changed = 0;
  const normalizedFrom = normalizePinCode(fromCode);

  for (const pin of legacyPins) {
    if (!pin || typeof pin !== 'object') continue;
    const current = normalizePinCode(pin.pinCode);
    if (current !== normalizedFrom) continue;
    pin.pinCode = toCode;
    changed += 1;
  }

  return changed;
}

function replaceLegacyRequestPinCodes(legacyRequests, fromCode, toCode) {
  let changed = 0;
  const normalizedFrom = normalizePinCode(fromCode);

  for (const request of legacyRequests) {
    if (!request || typeof request !== 'object') continue;
    if (!Array.isArray(request.pinsGenerated)) continue;

    const nextPins = request.pinsGenerated.map((pinCode) => {
      const normalized = normalizePinCode(pinCode);
      if (normalized !== normalizedFrom) return pinCode;
      changed += 1;
      return toCode;
    });

    request.pinsGenerated = nextPins;
  }

  return changed;
}

async function writeLegacyState(conn, legacyPins, legacyRequests) {
  const now = toMySqlDateTime(new Date().toISOString());

  await conn.execute(
    `INSERT INTO state_store (state_key, state_value, updated_at)
     VALUES ('mlm_pins', ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
    [JSON.stringify(legacyPins), now]
  );

  await conn.execute(
    `INSERT INTO state_store (state_key, state_value, updated_at)
     VALUES ('mlm_pin_purchase_requests', ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
    [JSON.stringify(legacyRequests), now]
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const evidenceDir = path.resolve(__dirname, '..', 'data', 'cutover-evidence', `${stamp()}-${args.label}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const reportPath = path.join(evidenceDir, 'pin-code-format-report.json');
  const summaryPath = path.join(evidenceDir, 'pin-code-format-summary.txt');

  const conn = await mysql.createConnection({
    host: args.host,
    port: args.port,
    user: args.user,
    password: args.password,
    database: args.database,
    connectTimeout: 30000
  });

  try {
    const invalidPins = await fetchInvalidPins(conn, args, false);

    const report = {
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      filters: {
        userCode: args.userCode || null,
        limit: args.limit
      },
      invalidPinsFound: invalidPins.length,
      invalidPins: invalidPins.map((row) => ({
        id: Number(row.id || 0),
        userCode: String(row.user_code || ''),
        pinCode: String(row.pin_code || '').trim(),
        status: String(row.status || ''),
        purchasedTxnId: Number(row.purchased_txn_id || 0),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
      }))
    };

    let applyMappings = [];
    if (args.apply && invalidPins.length > 0) {
      await conn.beginTransaction();
      try {
        const lockedInvalidPins = await fetchInvalidPins(conn, args, true);
        const legacyState = await loadLegacyStateForUpdate(conn);

        const reservedCodes = new Set();
        applyMappings = [];

        for (const row of lockedInvalidPins) {
          const pinId = Number(row.id || 0);
          const oldCode = normalizePinCode(row.pin_code);
          if (!pinId || !oldCode) continue;

          const newCode = await allocateUniquePinCode(conn, reservedCodes);

          const [updateResult] = await conn.execute(
            `UPDATE v2_pins
             SET pin_code = ?
             WHERE id = ?`,
            [newCode, pinId]
          );

          if (Number(updateResult?.affectedRows || 0) !== 1) {
            throw new Error(`Failed to update v2_pins.id=${pinId}`);
          }

          const legacyPinsUpdated = replaceLegacyPinCodes(legacyState.pins, oldCode, newCode);
          const legacyRequestsUpdated = replaceLegacyRequestPinCodes(legacyState.requests, oldCode, newCode);

          applyMappings.push({
            id: pinId,
            userCode: String(row.user_code || ''),
            oldCode,
            newCode,
            legacyPinsUpdated,
            legacyRequestsUpdated
          });
        }

        await writeLegacyState(conn, legacyState.pins, legacyState.requests);

        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    }

    const remainingInvalidPins = await fetchInvalidPins(conn, args, false);

    report.applyMappings = applyMappings;
    report.rewrittenPins = applyMappings.length;
    report.remainingInvalidPins = remainingInvalidPins.length;

    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const summaryLines = [
      `GeneratedAt: ${report.generatedAt}`,
      `Mode: ${report.mode}`,
      `UserCode: ${args.userCode || 'all'}`,
      `InvalidPinsFound: ${report.invalidPinsFound}`,
      `RewrittenPins: ${report.rewrittenPins}`,
      `RemainingInvalidPins: ${report.remainingInvalidPins}`,
      `Report: ${reportPath}`
    ];

    fs.writeFileSync(summaryPath, `${summaryLines.join('\n')}\n`, 'utf8');

    console.log('--- V2 PIN Code Format Repair ---');
    summaryLines.forEach((line) => console.log(line));

    if (!args.apply && report.invalidPinsFound > 0) {
      process.exit(2);
    }

    if (args.apply && report.remainingInvalidPins > 0) {
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
