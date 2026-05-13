#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadBotRegistry } = require('../src/config/botRegistry');
const { resolveBotCredentials } = require('../src/config/resolveBotCredentials');
const { createDatabase, initSchema } = require('../src/db/sqlite');
const { reconcileAll } = require('../src/reconciliation/positionReconciler');

const EXPECTED = {
  Bot1: {
    symbol: 'DEEPUSDT',
    side: 'Buy',
    qty: 25720,
    mark_price: 0.03783471,
    created_at_ms: Date.parse('2026-05-12T17:17:28.713Z'),
  },
  Bot3: {
    symbol: 'PAXGUSDT',
    side: 'Buy',
    qty: 0.241,
    mark_price: 4666.0,
    created_at_ms: Date.parse('2026-05-12T16:13:37.823Z'),
  },
  Bot4: {
    symbol: 'ZECUSDT',
    side: 'Buy',
    qty: 1.94,
    mark_price: 558.66680413,
    created_at_ms: Date.parse('2026-05-12T04:39:57.118Z'),
  },
  Bot7: {
    symbol: 'BERAUSDT',
    side: 'Sell',
    qty: 1175,
    mark_price: 0.41253097,
    created_at_ms: Date.parse('2026-05-13T11:54:01.663Z'),
  },
};

const QTY_REL_TOL = 0.005;
const PRICE_REL_TOL = 0.005;
const TIME_TOL_MS = 100;

function parseArgs(argv) {
  const args = { backupPath: null, registryPath: null, envPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backup') args.backupPath = argv[++i];
    else if (a === '--registry') args.registryPath = argv[++i];
    else if (a === '--env') args.envPath = argv[++i];
  }
  return args;
}

function relDiff(a, b) {
  const d = Math.max(Math.abs(a), Math.abs(b));
  if (d === 0) return 0;
  return Math.abs(a - b) / d;
}

function findLatestBackup(dataDir) {
  if (!fs.existsSync(dataDir)) return null;
  const files = fs.readdirSync(dataDir)
    .filter((f) => f.startsWith('s2.sqlite.backup_pre_be_backfill_'))
    .map((f) => ({ name: f, full: path.join(dataDir, f), mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0].full : null;
}

(async () => {
  const args = parseArgs(process.argv);

  const dataDir = '/home/ubuntu/.openclaw/workspace/Q_S2/data';
  const backupPath = args.backupPath || findLatestBackup(dataDir);
  if (!backupPath || !fs.existsSync(backupPath)) {
    console.error('Pre-backfill DB backup not found. Pass --backup PATH or run on the host with the backup file.');
    process.exit(2);
  }

  const tmpDb = path.join(os.tmpdir(), `s2_replay_${Date.now()}.sqlite`);
  fs.copyFileSync(backupPath, tmpDb);
  console.log(`Replay DB: ${tmpDb} (copied from ${backupPath})`);

  const registryPath = args.registryPath || path.join(__dirname, '..', 'config', 'bots.json');
  const envPath = args.envPath || '/home/ubuntu/.openclaw/.env';

  const registry = loadBotRegistry(registryPath);
  const targetBots = registry.bots.filter((b) => ['Bot1', 'Bot3', 'Bot4', 'Bot7'].includes(b.botId));
  if (targetBots.length !== 4) {
    console.error(`Expected 4 target bots, found ${targetBots.length}`);
    process.exit(2);
  }

  const db = createDatabase(tmpDb);
  initSchema(db);

  const credentialsResolver = (botId) => {
    const r = resolveBotCredentials(botId, { registryPath, envPath });
    return { apiKey: r.apiKey, apiSecret: r.apiSecret };
  };

  const reports = await reconcileAll({
    db,
    bots: targetBots,
    credentialsResolver,
    options: { dryRun: false, minQuietSecondsAfterEnter: 0, perBotStaggerMs: 100 },
    logger: { info: () => {}, warn: (m, x) => console.log('[warn]', m, x || '') },
  });

  console.log('');
  console.log('=== Replay reconciliation reports ===');
  for (const r of reports) {
    console.log(`  ${r.bot_id} ${r.symbol} in_sync=${r.in_sync} inserted=${r.inserted ? r.inserted.length : 0} ${r.skipped_reason || ''}`);
  }

  console.log('');
  console.log('=== Assertions ===');
  const failures = [];
  for (const botId of Object.keys(EXPECTED)) {
    const expected = EXPECTED[botId];
    const report = reports.find((x) => x.bot_id === botId);
    if (!report) { failures.push(`${botId}: no report`); continue; }
    const inserted = report.inserted || [];
    if (inserted.length !== 1) {
      failures.push(`${botId}: expected exactly 1 insert, got ${inserted.length}`);
      console.log(`  FAIL ${botId}: ${inserted.length} inserts`);
      continue;
    }
    const row = inserted[0];
    const issues = [];
    if (row.symbol !== expected.symbol) issues.push(`symbol ${row.symbol}!=${expected.symbol}`);
    if (row.side !== expected.side) issues.push(`side ${row.side}!=${expected.side}`);
    if (!row.exit_reason || !row.exit_reason.startsWith('reconciled_')) issues.push(`exit_reason ${row.exit_reason} not reconciled_*`);
    const qtyD = relDiff(Number(row.qty), expected.qty);
    if (qtyD > QTY_REL_TOL) issues.push(`qty ${row.qty} vs ${expected.qty} relDiff=${qtyD.toFixed(5)}`);
    const priceD = relDiff(Number(row.mark_price), expected.mark_price);
    if (priceD > PRICE_REL_TOL) issues.push(`mark_price ${row.mark_price} vs ${expected.mark_price} relDiff=${priceD.toFixed(5)}`);
    const tD = Math.abs(Date.parse(row.created_at) - expected.created_at_ms);
    if (tD > TIME_TOL_MS) issues.push(`created_at drift ${tD}ms (>100ms) row=${row.created_at} expected=${new Date(expected.created_at_ms).toISOString()}`);
    if (issues.length === 0) {
      console.log(`  ok   ${botId}: ${row.exit_reason} ${row.side} qty=${row.qty} @ ${row.mark_price} at ${row.created_at}`);
    } else {
      failures.push(`${botId}: ${issues.join('; ')}`);
      console.log(`  FAIL ${botId}: ${issues.join('; ')}`);
    }
  }

  fs.unlinkSync(tmpDb);

  console.log('');
  if (failures.length > 0) {
    console.log(`REPLAY VALIDATOR FAILED (${failures.length} mismatch(es))`);
    process.exit(1);
  }
  console.log('REPLAY VALIDATOR PASSED — reconciler reproduces the hand-backfilled rows for all 4 bots');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
