#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mysql = require('mysql2/promise');

function parseArgs(argv) {
  const out = {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    database: 'okshopee24',
    label: 'phase-a'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [key, inlineVal] = arg.slice(2).split('=');
    const nextVal = inlineVal !== undefined ? inlineVal : argv[i + 1];

    switch (key) {
      case 'host':
        out.host = nextVal;
        if (inlineVal === undefined) i += 1;
        break;
      case 'port':
        out.port = Number(nextVal);
        if (inlineVal === undefined) i += 1;
        break;
      case 'user':
        out.user = nextVal;
        if (inlineVal === undefined) i += 1;
        break;
      case 'database':
        out.database = nextVal;
        if (inlineVal === undefined) i += 1;
        break;
      case 'label':
        out.label = nextVal;
        if (inlineVal === undefined) i += 1;
        break;
      default:
        break;
    }
  }

  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestampForPath() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

async function promptHidden(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.stdoutMuted = true;
  rl._writeToOutput = function writeMasked(stringToWrite) {
    if (rl.stdoutMuted) {
      rl.output.write('*');
    } else {
      rl.output.write(stringToWrite);
    }
  };

  const answer = await new Promise((resolve) => {
    rl.question(prompt, (value) => resolve(value));
  });

  rl.close();
  process.stdout.write('\n');
  return answer;
}

function findSummary(results) {
  for (let i = 0; i < results.length; i += 1) {
    const rs = results[i];
    if (!Array.isArray(rs) || rs.length === 0) {
      continue;
    }

    const first = rs[0];
    if (first && first.section_name === 'SUMMARY_COUNTS') {
      const next = results[i + 1];
      if (Array.isArray(next) && next.length > 0) {
        return next[0];
      }
    }
  }

  return null;
}

function formatResultSets(results) {
  const lines = [];

  results.forEach((rs, idx) => {
    if (!Array.isArray(rs)) {
      return;
    }

    lines.push(`\n--- RESULT_SET_${idx + 1} ---`);
    if (rs.length === 0) {
      lines.push('(no rows)');
      return;
    }

    rs.forEach((row) => {
      lines.push(JSON.stringify(row));
    });
  });

  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = __dirname;
  const backendDir = path.resolve(scriptDir, '..');
  const sqlPath = path.join(scriptDir, 'v2-phase-a-seeding-checks.sql');

  if (!fs.existsSync(sqlPath)) {
    console.error(`ERROR: SQL file not found: ${sqlPath}`);
    process.exit(1);
  }

  const evidenceRoot = path.join(backendDir, 'data', 'cutover-evidence');
  const evidenceDir = path.join(evidenceRoot, `${timestampForPath()}-${args.label}`);
  ensureDir(evidenceDir);

  const outputFile = path.join(evidenceDir, 'phase-a-seeding-checks-output.txt');
  const metaFile = path.join(evidenceDir, 'phase-a-run-meta.txt');

  const password = process.env.MYSQL_PASSWORD || await promptHidden('Enter MySQL password: ');
  if (!password) {
    console.error('ERROR: MySQL password is required.');
    process.exit(1);
  }

  const metaLines = [
    `StartedAt: ${new Date().toISOString()}`,
    `Host: ${args.host}`,
    `Port: ${args.port}`,
    `User: ${args.user}`,
    `Database: ${args.database}`,
    `SqlFile: ${sqlPath}`,
    'Runner: node/mysql2'
  ];
  fs.writeFileSync(metaFile, `${metaLines.join('\n')}\n`, 'utf8');

  console.log('--- Running V2 Phase A seeding checks (Node/mysql2 fallback) ---');
  console.log(`SQL: ${sqlPath}`);
  console.log(`Evidence output: ${outputFile}`);

  let conn;
  try {
    conn = await mysql.createConnection({
      host: args.host,
      port: args.port,
      user: args.user,
      password,
      database: args.database,
      multipleStatements: true,
      connectTimeout: 30000
    });

    const sqlText = fs.readFileSync(sqlPath, 'utf8');
    const [results] = await conn.query(sqlText);

    const outputLines = [];
    outputLines.push(`ExecutedAt: ${new Date().toISOString()}`);
    outputLines.push(`Host: ${args.host}`);
    outputLines.push(`Port: ${args.port}`);
    outputLines.push(`User: ${args.user}`);
    outputLines.push(`Database: ${args.database}`);
    outputLines.push('Runner: node/mysql2');

    outputLines.push(...formatResultSets(results));

    const summary = findSummary(results);
    if (summary) {
      outputLines.push('\n--- SUMMARY_COUNTS_PARSED ---');
      outputLines.push(`check_1_missing_required_wallets=${summary.check_1_missing_required_wallets}`);
      outputLines.push(`check_2_missing_help_progress_state=${summary.check_2_missing_help_progress_state}`);
      outputLines.push(`check_3_missing_active_baseline=${summary.check_3_missing_active_baseline}`);
      outputLines.push(`check_4_no_posted_v2_ledger_wallet_baseline_mismatch=${summary.check_4_no_posted_v2_ledger_wallet_baseline_mismatch}`);

      console.log('Summary counts:');
      console.log(`  check_1_missing_required_wallets: ${summary.check_1_missing_required_wallets}`);
      console.log(`  check_2_missing_help_progress_state: ${summary.check_2_missing_help_progress_state}`);
      console.log(`  check_3_missing_active_baseline: ${summary.check_3_missing_active_baseline}`);
      console.log(`  check_4_no_posted_v2_ledger_wallet_baseline_mismatch: ${summary.check_4_no_posted_v2_ledger_wallet_baseline_mismatch}`);
    } else {
      outputLines.push('\nWARNING: Could not parse SUMMARY_COUNTS section from SQL output.');
      console.warn('WARNING: Could not parse SUMMARY_COUNTS section from SQL output.');
    }

    fs.writeFileSync(outputFile, `${outputLines.join('\n')}\n`, 'utf8');
    fs.appendFileSync(metaFile, `FinishedAt: ${new Date().toISOString()}\nExitCode: 0\n`, 'utf8');

    console.log('Phase A SQL checks completed.');
    console.log(`Evidence folder: ${evidenceDir}`);
    console.log('Pass rule: each summary count must be 0 and detail sections should have no rows.');
    process.exit(0);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try {
      fs.appendFileSync(metaFile, `FinishedAt: ${new Date().toISOString()}\nExitCode: 1\nError: ${msg}\n`, 'utf8');
    } catch (_) {
      // Ignore meta write failures in error path.
    }

    console.error(`ERROR: ${msg}`);
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

main();
