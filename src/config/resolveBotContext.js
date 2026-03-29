const path = require('path');
const { loadBotRegistry } = require('./botRegistry');
const { resolveBotSettings } = require('./resolveBotSettings');
const { resolveBotCredentials } = require('./resolveBotCredentials');

function resolveBotContext(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const registry = loadBotRegistry(registryPath);
  const allowedBots = registry.bots.filter(bot => bot.enabled).map(bot => bot.botId);

  const resolved = resolveBotSettings(botId, { registryPath });
  const credentials = resolveBotCredentials(botId, {
    registryPath,
    envPath: options.envPath || '/home/ubuntu/.openclaw/.env',
  });
  if (!resolved.bot.enabled) {
    throw new Error(`Bot ${botId} is disabled`);
  }

  return {
    botId: resolved.bot.botId,
    symbol: resolved.bot.symbol,
    settingsPath: resolved.settingsPath,
    settings: resolved.settings,
    validation: resolved.validation,
    bot: resolved.bot,
    credentials,
    allowedBots,
    registryPath,
  };
}

module.exports = {
  resolveBotContext,
};
