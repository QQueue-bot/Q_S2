#!/usr/bin/env node
const path = require('path');
const { executePaperTrade } = require('../src/execution/bybitExecution');

const signal = process.argv[2] || 'ENTER_LONG';
const botId = process.argv[3] || 'Bot1';

executePaperTrade(
  { signal, botId, receivedAt: new Date().toISOString(), raw: `${signal}_${botId}` },
  {
    settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
    envPath: '/home/ubuntu/.openclaw/workspace/.env',
    dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
    stageDelaySeconds: 5,
  }
).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
