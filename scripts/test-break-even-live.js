#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { manageBreakEven } = require('../src/execution/bybitExecution');

const baseSettingsPath = path.join(__dirname, '..', 'config', 'settings.json');
const demoSettingsPath = '/tmp/qs2_sprint14_live_settings.json';
const settings = JSON.parse(fs.readFileSync(baseSettingsPath, 'utf8'));
settings.breakEven.enabled = true;
settings.breakEven.triggerPercent = 0.25;
fs.writeFileSync(demoSettingsPath, JSON.stringify(settings, null, 2));

manageBreakEven({
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
