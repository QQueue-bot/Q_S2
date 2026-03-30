const fs = require('fs');
const path = require('path');

function loadBotRegistry(registryPath = path.join(__dirname, '..', '..', 'config', 'bots.json')) {
  const raw = fs.readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || !Array.isArray(parsed.bots)) {
    throw new Error('Bot registry must contain a bots array');
  }

  const seen = new Set();
  for (const bot of parsed.bots) {
    if (!bot.botId || typeof bot.botId !== 'string') {
      throw new Error('Each bot entry must include a string botId');
    }
    if (seen.has(bot.botId)) {
      throw new Error(`Duplicate botId in registry: ${bot.botId}`);
    }
    seen.add(bot.botId);
    if (!bot.symbol || typeof bot.symbol !== 'string') {
      throw new Error(`Bot ${bot.botId} must include a symbol`);
    }
    if (typeof bot.enabled !== 'boolean') {
      throw new Error(`Bot ${bot.botId} must include boolean enabled state`);
    }
    if (!bot.settingsRef || typeof bot.settingsRef !== 'string') {
      throw new Error(`Bot ${bot.botId} must include settingsRef`);
    }
    if (!bot.credentialRef || typeof bot.credentialRef !== 'object' || Array.isArray(bot.credentialRef)) {
      throw new Error(`Bot ${bot.botId} must include credentialRef object`);
    }
    if (!bot.mdxSourceRef || typeof bot.mdxSourceRef !== 'string') {
      throw new Error(`Bot ${bot.botId} must include mdxSourceRef`);
    }
    if (!bot.credentialRef.apiKeyEnv || typeof bot.credentialRef.apiKeyEnv !== 'string') {
      throw new Error(`Bot ${bot.botId} must include credentialRef.apiKeyEnv`);
    }
    if (!bot.credentialRef.apiSecretEnv || typeof bot.credentialRef.apiSecretEnv !== 'string') {
      throw new Error(`Bot ${bot.botId} must include credentialRef.apiSecretEnv`);
    }
  }

  return parsed;
}

function getBotById(botId, registryPath) {
  const registry = loadBotRegistry(registryPath);
  return registry.bots.find(bot => bot.botId === botId) || null;
}

module.exports = {
  loadBotRegistry,
  getBotById,
};
