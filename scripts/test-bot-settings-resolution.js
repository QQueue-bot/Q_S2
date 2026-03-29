#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { resolveBotSettings } = require('../src/config/resolveBotSettings');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');

const bot1 = resolveBotSettings('Bot1', { registryPath });

let unknownBotError = null;
try {
  resolveBotSettings('UnknownBot', { registryPath });
} catch (error) {
  unknownBotError = error.message;
}

const brokenRegistryPath = '/tmp/qs2_broken_bots.json';
const brokenRegistry = {
  bots: [
    {
      botId: 'BrokenBot',
      enabled: true,
      symbol: 'BTCUSDT',
      settingsRef: './missing-settings.json'
    }
  ]
};
fs.writeFileSync(brokenRegistryPath, JSON.stringify(brokenRegistry, null, 2));

let missingSettingsError = null;
try {
  resolveBotSettings('BrokenBot', { registryPath: brokenRegistryPath });
} catch (error) {
  missingSettingsError = error.message;
}

console.log(JSON.stringify({
  bot1: {
    botId: bot1.bot.botId,
    symbol: bot1.bot.symbol,
    settingsPath: bot1.settingsPath,
    validation: bot1.validation,
  },
  unknownBotError,
  missingSettingsError,
}, null, 2));

if (!bot1 || bot1.bot.botId !== 'Bot1' || !unknownBotError || !missingSettingsError) {
  process.exit(1);
}
