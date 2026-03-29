#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');

const dbPath = '/tmp/qs2_test_bot_persistence.sqlite';
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = createDatabase(dbPath);
initSchema(db);
const persistence = buildPersistence(db);

persistence.recordOrderAttempt({
  created_at: '2026-03-29T18:00:00.000Z',
  signal: 'ENTER_LONG',
  bot_id: 'Bot1',
  symbol: 'BTCUSDT',
  side: 'Buy',
  order_type: 'Market',
  qty: '0.013',
  notional_usd: 1000,
  status: 'submitted',
  response_json: '{}',
});

persistence.recordStagedEntryEvent({
  created_at: '2026-03-29T18:00:01.000Z',
  symbol: 'BTCUSDT',
  bot_id: 'Bot1',
  stage_name: 'initial_entry_50',
  delay_seconds: 0,
  qty: '0.013',
  status: 'submitted',
  response_json: '{}',
});

persistence.recordExitEvent({
  created_at: '2026-03-29T18:01:00.000Z',
  bot_id: 'Bot1',
  symbol: 'BTCUSDT',
  exit_reason: 'take_profit',
  trigger_percent: 0.4,
  close_percent: 50,
  side: 'Sell',
  qty: '0.006',
  mark_price: 66600,
  response_json: '{}',
});

persistence.recordBreakEvenEvent({
  created_at: '2026-03-29T18:02:00.000Z',
  bot_id: 'Bot1',
  symbol: 'BTCUSDT',
  event_type: 'armed',
  trigger_percent: 0.3,
  side: 'Buy',
  entry_price: 66300,
  mark_price: 66500,
  response_json: '{}',
});

const columns = {
  exitEvents: db.prepare("PRAGMA table_info(exit_events)").all(),
  breakEvenEvents: db.prepare("PRAGMA table_info(break_even_events)").all(),
};

const rows = {
  orderAttempts: db.prepare('SELECT bot_id FROM order_attempts ORDER BY id DESC LIMIT 1').get(),
  stagedEntryEvents: db.prepare('SELECT bot_id FROM staged_entry_events ORDER BY id DESC LIMIT 1').get(),
  exitEvents: db.prepare('SELECT bot_id FROM exit_events ORDER BY id DESC LIMIT 1').get(),
  breakEvenEvents: db.prepare('SELECT bot_id FROM break_even_events ORDER BY id DESC LIMIT 1').get(),
};

console.log(JSON.stringify({ columns, rows }, null, 2));

const required = [
  rows.orderAttempts?.bot_id,
  rows.stagedEntryEvents?.bot_id,
  rows.exitEvents?.bot_id,
  rows.breakEvenEvents?.bot_id,
];

if (required.some(value => value !== 'Bot1')) {
  process.exit(1);
}
