const fs = require('fs');
const path = require('path');
const { getBotById } = require('./botRegistry');

function resolveBotMdxSource(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const registryDir = path.dirname(registryPath);
  const bot = getBotById(botId, registryPath);

  if (!bot) {
    throw new Error(`Unknown botId: ${botId}`);
  }

  if (!bot.mdxSourceRef || typeof bot.mdxSourceRef !== 'string') {
    throw new Error(`Bot ${botId} is missing mdxSourceRef`);
  }

  const sourcePath = path.resolve(registryDir, bot.mdxSourceRef);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`MDX source file not found for ${botId}: ${sourcePath}`);
  }

  return {
    botId,
    sourceRef: bot.mdxSourceRef,
    sourcePath,
  };
}

module.exports = {
  resolveBotMdxSource,
};
