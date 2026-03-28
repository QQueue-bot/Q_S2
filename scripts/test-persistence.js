#!/usr/bin/env node
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');

const dbPath = path.join(__dirname, '..', 'data', 's2.sqlite');
const db = createDatabase(dbPath);
initSchema(db);
const persistence = buildPersistence(db);

const now = new Date().toISOString();
persistence.recordWebhookEvent({
  received_at: now,
  request_path: '/webhook/tradingview',
  method: 'POST',
  auth_ok: 1,
  parse_ok: 1,
  raw_body: 'ENTER_LONG_Bot1',
  error_message: null,
});

persistence.recordNormalizedSignal({
  received_at: now,
  signal: 'ENTER_LONG',
  bot_id: 'Bot1',
  raw_input: 'ENTER_LONG_Bot1',
});

persistence.recordSystemEvent({
  created_at: now,
  level: 'info',
  event_type: 'persistence_test',
  message: 'SQLite persistence smoke test',
  details_json: JSON.stringify({ status: 'ok' }),
});

console.log(JSON.stringify({
  ok: true,
  webhookEvents: persistence.getWebhookEvents(),
  normalizedSignals: persistence.getNormalizedSignals(),
  systemEvents: persistence.getSystemEvents(),
}, null, 2));
