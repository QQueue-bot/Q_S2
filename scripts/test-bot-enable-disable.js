#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { resolveBotContext } = require('../src/config/resolveBotContext');
const { parseSignalString } = require('../src/signals/parseSignal');

const baseRegistryPath = path.join(__dirname, '..', 'config', 'bots.json');
const envPath = '/home/ubuntu/.openclaw/.env';

const enabledRegistry = JSON.parse(fs.readFileSync(baseRegistryPath, 'utf8'));
const disabledRegistry = JSON.parse(JSON.stringify(enabledRegistry));
const originalSettingsRef = enabledRegistry.bots[0].settingsRef;
const absoluteSettingsPath = path.resolve(path.dirname(baseRegistryPath), originalSettingsRef);
disabledRegistry.bots[0].enabled = false;
disabledRegistry.bots[0].settingsRef = absoluteSettingsPath;
const disabledRegistryPath = '/tmp/qs2_disabled_bot_registry.json';
fs.writeFileSync(disabledRegistryPath, JSON.stringify(disabledRegistry, null, 2));

const enabledContext = resolveBotContext('Bot1', { registryPath: baseRegistryPath, envPath });
const parsedEnabled = parseSignalString('ENTER_LONG_Bot1', { allowedBots: enabledContext.allowedBots });

let disabledContextError = null;
try {
  resolveBotContext('Bot1', { registryPath: disabledRegistryPath, envPath });
} catch (error) {
  disabledContextError = error.message;
}

const disabledAllowedBots = disabledRegistry.bots.filter(bot => bot.enabled).map(bot => bot.botId);
let disabledParseError = null;
try {
  parseSignalString('ENTER_LONG_Bot1', { allowedBots: disabledAllowedBots });
} catch (error) {
  disabledParseError = error.message;
}

console.log(JSON.stringify({
  enabledBotId: enabledContext.botId,
  enabledAllowedBots: enabledContext.allowedBots,
  parsedEnabled,
  disabledContextError,
  disabledAllowedBots,
  disabledParseError,
}, null, 2));

if (!enabledContext.allowedBots.includes('Bot1')) process.exit(1);
if (!parsedEnabled || parsedEnabled.botId !== 'Bot1') process.exit(1);
if (disabledContextError !== 'Bot Bot1 is disabled') process.exit(1);
if (!disabledParseError || !disabledParseError.includes('Bot is not allowed')) process.exit(1);
