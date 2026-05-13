#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { loadBotRegistry } = require('../src/config/botRegistry');
const { resolveBotCredentials } = require('../src/config/resolveBotCredentials');
const { createDatabase, initSchema } = require('../src/db/sqlite');
const { reconcileAll } = require('../src/reconciliation/positionReconciler');

function parseArgs(argv) {
  const args = { dryRun: true, bot: null, dbPath: null, registryPath: null, envPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--bot') args.bot = argv[++i];
    else if (a === '--db') args.dbPath = argv[++i];
    else if (a === '--registry') args.registryPath = argv[++i];
    else if (a === '--env') args.envPath = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: reconcile-once.js [--apply|--dry-run] [--bot BotN] [--db PATH] [--registry PATH] [--env PATH]');
      process.exit(0);
    }
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  const dbPath = args.dbPath || process.env.S2_DB_PATH || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
  const registryPath = args.registryPath || path.join(__dirname, '..', 'config', 'bots.json');
  const envPath = args.envPath || '/home/ubuntu/.openclaw/.env';

  if (!fs.existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}`);
    process.exit(2);
  }

  const registry = loadBotRegistry(registryPath);
  let bots = registry.bots.filter((b) => b.enabled);
  if (args.bot) bots = bots.filter((b) => b.botId === args.bot);
  if (bots.length === 0) {
    console.error(`No enabled bots match filter`);
    process.exit(2);
  }

  const db = createDatabase(dbPath);
  initSchema(db);

  const credentialsResolver = (botId) => {
    const r = resolveBotCredentials(botId, { registryPath, envPath });
    return { apiKey: r.apiKey, apiSecret: r.apiSecret };
  };

  const reports = await reconcileAll({
    db,
    bots,
    credentialsResolver,
    options: { dryRun: args.dryRun, perBotStaggerMs: 200 },
    logger: {
      info: (msg, meta) => console.log('[info]', msg, meta || ''),
      warn: (msg, meta) => console.log('[warn]', msg, meta || ''),
    },
  });

  console.log('');
  console.log(`=== Reconciliation report (mode=${args.dryRun ? 'dry-run' : 'apply'}, db=${dbPath}) ===`);
  for (const r of reports) {
    const tag = r.in_sync ? 'IN_SYNC' : 'DIVERGENT';
    const note = r.skipped_reason ? ` (${r.skipped_reason})` : '';
    console.log(`  ${r.bot_id.padEnd(6)} ${(r.symbol || '').padEnd(12)} ${tag}${note}`);
    if (r.inserted && r.inserted.length > 0) {
      for (const ins of r.inserted) {
        const tag2 = ins._dry_run ? '[would insert]' : `[inserted #${ins.id}]`;
        console.log(`      ${tag2} ${ins.exit_reason} ${ins.side} qty=${ins.qty} @ ${ins.mark_price} at ${ins.created_at}`);
      }
    }
    if (r.skipped_records && r.skipped_records.length > 0) {
      for (const sk of r.skipped_records) {
        console.log(`      [skip] ${sk.reason}`);
      }
    }
  }

  const inserted = reports.reduce((acc, r) => acc + (r.inserted ? r.inserted.length : 0), 0);
  const divergent = reports.filter((r) => r.in_sync === false).length;
  console.log('');
  console.log(`Summary: ${reports.length} bots, ${divergent} divergent, ${inserted} ${args.dryRun ? 'would-be-' : ''}inserted`);
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
