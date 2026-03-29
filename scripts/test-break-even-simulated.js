#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');
const { shouldTriggerBreakEven } = require('../src/execution/bybitExecution');

const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.breakEven.enabled = true;
settings.breakEven.triggerPercent = 0.25;

const dbPath = '/tmp/qs2_break_even_test.sqlite';
try { fs.unlinkSync(dbPath); } catch {}
const db = createDatabase(dbPath);
initSchema(db);
const persistence = buildPersistence(db);

const basePosition = {
  symbol: 'BTCUSDT',
  side: 'Buy',
  size: '0.050',
  avgPrice: '100',
  markPrice: '100.25',
};

const armDecision = shouldTriggerBreakEven(settings, basePosition, persistence);
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

const closeDecision = shouldTriggerBreakEven(settings, {
  ...basePosition,
  markPrice: '100.0',
}, persistence);

const holdDecision = shouldTriggerBreakEven(settings, {
  ...basePosition,
  markPrice: '100.1',
}, persistence);

console.log(JSON.stringify({ armDecision, closeDecision, holdDecision }, null, 2));

const ok = armDecision?.type === 'arm_break_even'
  && closeDecision?.type === 'break_even_close'
  && holdDecision?.type === 'none';

process.exit(ok ? 0 : 1);
