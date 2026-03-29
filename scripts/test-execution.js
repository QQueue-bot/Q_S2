#!/usr/bin/env node
const path = require('path');
const { executePaperTrade } = require('../src/execution/bybitExecution');

executePaperTrade(
  { signal: 'ENTER_LONG', botId: 'Bot1', receivedAt: new Date().toISOString(), raw: 'ENTER_LONG_Bot1' },
  {
    settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
    envPath: path.join(__dirname, '..', '.env'),
  }
).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
