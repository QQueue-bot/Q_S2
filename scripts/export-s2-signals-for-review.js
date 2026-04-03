#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createDatabase, initSchema } = require('../src/db/sqlite');
const { loadBotRegistry } = require('../src/config/botRegistry');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function classifyDirection(signal) {
  if (signal === 'ENTER_LONG') return 'long';
  if (signal === 'ENTER_SHORT') return 'short';
  if (signal === 'EXIT_LONG') return 'exit_long';
  if (signal === 'EXIT_SHORT') return 'exit_short';
  return 'unknown';
}

function isEntrySignal(signal) {
  return signal === 'ENTER_LONG' || signal === 'ENTER_SHORT';
}

function buildBotMap(registryPath) {
  const registry = loadBotRegistry(registryPath);
  return new Map(registry.bots.map(bot => [bot.botId, bot]));
}

function exportSignals({ dbPath, registryPath, since, enabledOnly }) {
  const db = createDatabase(dbPath);
  initSchema(db);
  const botMap = buildBotMap(registryPath);

  const where = [];
  const params = {};
  if (since) {
    where.push('received_at >= @since');
    params.since = since;
  }

  const sql = `
    SELECT received_at, bot_id, signal, raw_input
    FROM normalized_signals
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY received_at ASC
  `;

  const rows = db.prepare(sql).all(params);
  db.close();

  return rows
    .map(row => {
      const bot = botMap.get(row.bot_id) || null;
      return {
        received_at: row.received_at,
        bot_id: row.bot_id,
        symbol: bot?.symbol || null,
        enabled: bot?.enabled ?? null,
        mdxProfile: bot?.mdxProfile || null,
        signal: row.signal,
        direction: classifyDirection(row.signal),
        eventType: isEntrySignal(row.signal) ? 'entry' : 'exit',
        raw_input: row.raw_input,
      };
    })
    .filter(row => !enabledOnly || row.enabled === true);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db || process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite';
  const registryPath = args.registry || path.join(__dirname, '..', 'config', 'bots.json');
  const since = args.since || null;
  const enabledOnly = Boolean(args['enabled-only']);
  const outPath = args.out || null;

  const payload = {
    exportedAt: new Date().toISOString(),
    dbPath,
    registryPath,
    filters: {
      since,
      enabledOnly,
    },
    signals: exportSignals({ dbPath, registryPath, since, enabledOnly }),
  };

  const text = JSON.stringify(payload, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), text);
    console.error(`Wrote ${payload.signals.length} signals to ${path.resolve(outPath)}`);
    return;
  }

  process.stdout.write(text + '\n');
}

main();
