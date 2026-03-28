#!/usr/bin/env node
const path = require('path');
const { createRiskEngine } = require('../src/risk/evaluateSignal');

const engine = createRiskEngine({
  settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
});

const samples = [
  { signal: 'ENTER_LONG', botId: 'Bot1', receivedAt: new Date().toISOString(), raw: 'ENTER_LONG_Bot1' },
  { signal: 'EXIT_LONG', botId: 'Bot1', receivedAt: new Date().toISOString(), raw: 'EXIT_LONG_Bot1' },
];

console.log(JSON.stringify({
  ok: true,
  evaluations: samples.map(sample => engine.evaluate(sample)),
}, null, 2));
