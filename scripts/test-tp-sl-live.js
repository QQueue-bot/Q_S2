#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { manageTpSl } = require('../src/execution/bybitExecution');

const baseSettingsPath = path.join(__dirname, '..', 'config', 'settings.json');
const demoSettingsPath = '/tmp/qs2_sprint13_live_settings.json';
const settings = JSON.parse(fs.readFileSync(baseSettingsPath, 'utf8'));
settings.takeProfit.levels = [
  { index: 1, triggerPercent: 0.25, closePercent: 50, enabled: true },
  { index: 2, triggerPercent: 0.5, closePercent: 50, enabled: true },
  { index: 3, triggerPercent: 0.0, closePercent: 0.0, enabled: false },
  { index: 4, triggerPercent: 0.0, closePercent: 0.0, enabled: false },
  { index: 5, triggerPercent: 0.0, closePercent: 0.0, enabled: false },
  { index: 6, triggerPercent: 0.0, closePercent: 0.0, enabled: false },
];
settings.stopLoss.triggerPercent = 0.5;
fs.writeFileSync(demoSettingsPath, JSON.stringify(settings, null, 2));

manageTpSl({
  settingsPath: demoSettingsPath,
  envPath: '/home/ubuntu/.openclaw/workspace/.env',
  dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
