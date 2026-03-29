#!/usr/bin/env node
const path = require('path');
const { executePaperTrade } = require('../src/execution/bybitExecution');

const signal = process.argv[2] || 'ENTER_SHORT';
const botId = process.argv[3] || 'Bot1';

executePaperTrade(
  { signal, botId, receivedAt: new Date().toISOString(), raw: `${signal}_${botId}` },
  {
    settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
    envPath: '/home/ubuntu/.openclaw/workspace/.env',
  }
).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
