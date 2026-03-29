#!/usr/bin/env node
const path = require('path');
const { generateTradeSummary } = require('../src/reporting/tradeSummary');

generateTradeSummary({
  settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
  envPath: '/home/ubuntu/.openclaw/workspace/.env',
  dbPath: process.env.S2_DB_PATH,
}).then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
