#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { manageTpSl, evaluateTpSl } = require('../src/execution/bybitExecution');

const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
const demoSettingsPath = '/tmp/qs2_sprint13_settings.json';
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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

const basePosition = {
  symbol: 'BTCUSDT',
  side: 'Buy',
  size: '0.100',
  avgPrice: '100',
  leverage: '10',
  positionStatus: 'Normal',
};

const tp1 = evaluateTpSl(settings, { ...basePosition, markPrice: '100.25' });
const tp2 = evaluateTpSl(settings, { ...basePosition, markPrice: '100.5' });
const sl = evaluateTpSl(settings, { ...basePosition, markPrice: '99.5' });
const hold = evaluateTpSl(settings, { ...basePosition, markPrice: '100.1' });

console.log(JSON.stringify({ tp1, tp2, sl, hold }, null, 2));

const ok = tp1?.type === 'take_profit' && tp1.closePercent === 50
  && tp2?.type === 'take_profit' && tp2.closePercent === 50
  && sl?.type === 'stop_loss' && sl.closePercent === 100
  && hold?.type === 'none';

process.exit(ok ? 0 : 1);
