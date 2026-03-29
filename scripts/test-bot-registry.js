#!/usr/bin/env node
const path = require('path');
const { loadBotRegistry, getBotById } = require('../src/config/botRegistry');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');
const registry = loadBotRegistry(registryPath);
const bot1 = getBotById('Bot1', registryPath);

console.log(JSON.stringify({
  registry,
  bot1,
}, null, 2));

if (!bot1 || bot1.symbol !== 'BTCUSDT' || bot1.enabled !== true) {
  process.exit(1);
}
