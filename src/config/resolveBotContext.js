const path = require('path');
const { loadBotRegistry } = require('./botRegistry');
const { resolveBotSettings } = require('./resolveBotSettings');
const { resolveBotCredentials } = require('./resolveBotCredentials');
const { resolveBotMdxSource } = require('./resolveBotMdxSource');

function resolveBotContext(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const registry = loadBotRegistry(registryPath);
  const allowedBots = registry.bots.map(bot => bot.botId);
  const executionEnabledBots = registry.bots.filter(bot => bot.enabled).map(bot => bot.botId);

  const resolved = resolveBotSettings(botId, { registryPath });
  const mdxSource = resolveBotMdxSource(botId, { registryPath });
  const credentials = resolveBotCredentials(botId, {
    registryPath,
    envPath: options.envPath || '/home/ubuntu/.openclaw/.env',
  });

  return {
    botId: resolved.bot.botId,
    symbol: resolved.bot.symbol,
    settingsPath: resolved.settingsPath,
    settings: resolved.settings,
    validation: resolved.validation,
    bot: resolved.bot,
    mdx: resolved.mdx,
    mdxSource,
    credentials,
    allowedBots,
    executionEnabledBots,
    registryPath,
  };
}

module.exports = {
  resolveBotContext,
};
