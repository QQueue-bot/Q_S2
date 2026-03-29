#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');
const { computeCloseQty } = require('../src/execution/bybitExecution');

const dbPath = '/tmp/qs2_staged_entry_test.sqlite';
try { fs.unlinkSync(dbPath); } catch {}
const db = createDatabase(dbPath);
initSchema(db);
const persistence = buildPersistence(db);

const fullQty = '0.100';
const stageOneQty = computeCloseQty(fullQty, 50, 0.001);
const stageTwoQty = (Number(fullQty) - Number(stageOneQty)).toFixed(3);

persistence.recordStagedEntryEvent({
  created_at: new Date().toISOString(),
  symbol: 'BTCUSDT',
  bot_id: 'Bot1',
  stage_name: 'initial_entry_50',
  delay_seconds: 0,
  qty: stageOneQty,
  status: 'submitted',
  response_json: JSON.stringify({ ok: true }),
});

const noBeDecision = { allowDelayedAdd: true, reason: null };
persistence.recordBreakEvenEvent({
  created_at: new Date().toISOString(),
  symbol: 'BTCUSDT',
  event_type: 'armed',
  trigger_percent: 0.25,
  side: 'Buy',
  entry_price: 100,
  mark_price: 100.25,
  response_json: JSON.stringify({ action: 'armed' }),
});
const beBlocksDelayedAdd = persistence.getBreakEvenEvents().length > 0;

console.log(JSON.stringify({
  fullQty,
  stageOneQty,
  stageTwoQty,
  noBeDecision,
  beBlocksDelayedAdd,
}, null, 2));

const ok = stageOneQty === '0.050' && stageTwoQty === '0.050' && noBeDecision.allowDelayedAdd && beBlocksDelayedAdd;
process.exit(ok ? 0 : 1);
