#!/usr/bin/env node
const path = require('path');
const { createBybitPriceMonitor } = require('../src/market/bybitPriceMonitor');

createBybitPriceMonitor({
  settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
  logger: console,
  sampleLimit: 2,
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
