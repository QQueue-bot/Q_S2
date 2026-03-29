const fs = require('fs');
const path = require('path');
const { getBotById } = require('./botRegistry');
const { loadAndValidateSettings } = require('./validateSettings');

function resolveBotSettings(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const registryDir = path.dirname(registryPath);
  const bot = getBotById(botId, registryPath);

  if (!bot) {
    throw new Error(`Unknown botId: ${botId}`);
  }

  const settingsRef = bot.settingsRef;
  if (!settingsRef || typeof settingsRef !== 'string') {
    throw new Error(`Bot ${botId} is missing settingsRef`);
  }

  const settingsPath = path.resolve(registryDir, settingsRef);
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Settings file not found for ${botId}: ${settingsPath}`);
  }

  const validated = loadAndValidateSettings(settingsPath);
  return {
    bot,
    settingsPath,
    settings: validated.settings,
    validation: validated.validation,
  };
}

module.exports = {
  resolveBotSettings,
};
