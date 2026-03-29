#!/usr/bin/env node
const { loadBotRegistry } = require('../src/config/botRegistry');
const { resolveBotSettings } = require('../src/config/resolveBotSettings');
const { resolveBotCredentials } = require('../src/config/resolveBotCredentials');
const { resolveBotContext } = require('../src/config/resolveBotContext');
const { parseSignalString } = require('../src/signals/parseSignal');

const registryPath = require('path').join(__dirname, '..', 'config', 'bots.json');
const envPath = '/home/ubuntu/.openclaw/.env';

const registry = loadBotRegistry(registryPath);
const readiness = registry.bots.map(bot => {
  const settings = resolveBotSettings(bot.botId, { registryPath });
  const creds = resolveBotCredentials(bot.botId, { registryPath, envPath });
  return {
    botId: bot.botId,
    enabled: bot.enabled,
    symbol: bot.symbol,
    settingsPath: settings.settingsPath,
    credentialRef: creds.credentialRef,
    hasApiKey: Boolean(creds.apiKey),
    hasApiSecret: Boolean(creds.apiSecret),
  };
});

const bot1Context = resolveBotContext('Bot1', { registryPath, envPath });
let disabledBotError = null;
try {
  resolveBotContext('Bot2', { registryPath, envPath });
} catch (error) {
  disabledBotError = error.message;
}

let disabledParseError = null;
try {
  parseSignalString('ENTER_LONG_Bot2', { allowedBots: bot1Context.allowedBots });
} catch (error) {
  disabledParseError = error.message;
}

console.log(JSON.stringify({
  botCount: registry.bots.length,
  readiness,
  enabledBots: bot1Context.allowedBots,
  disabledBotError,
  disabledParseError,
}, null, 2));

if (registry.bots.length !== 8) process.exit(1);
if (!bot1Context.allowedBots.includes('Bot1')) process.exit(1);
if (bot1Context.allowedBots.some(botId => botId !== 'Bot1')) process.exit(1);
if (!disabledBotError || disabledBotError !== 'Bot Bot2 is disabled') process.exit(1);
if (!disabledParseError || !disabledParseError.includes('Bot is not allowed: Bot2')) process.exit(1);
if (readiness.some(item => item.symbol !== 'BTCUSDT')) process.exit(1);
if (readiness.some(item => item.settingsPath.indexOf('/config/settings.json') === -1)) process.exit(1);
if (readiness.some(item => !item.hasApiKey || !item.hasApiSecret)) process.exit(1);
