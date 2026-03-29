const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getBotById } = require('./botRegistry');

function loadEnv(envPath) {
  if (!envPath || !fs.existsSync(envPath)) {
    return process.env;
  }
  const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  return { ...process.env, ...parsed };
}

function resolveBotCredentials(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const envPath = options.envPath || '/home/ubuntu/.openclaw/workspace/.env';
  const bot = getBotById(botId, registryPath);

  if (!bot) {
    throw new Error(`Unknown botId: ${botId}`);
  }

  const credentialRef = bot.credentialRef;
  if (!credentialRef || typeof credentialRef !== 'object' || Array.isArray(credentialRef)) {
    throw new Error(`Bot ${botId} is missing credentialRef`);
  }

  const { apiKeyEnv, apiSecretEnv } = credentialRef;
  if (!apiKeyEnv || typeof apiKeyEnv !== 'string') {
    throw new Error(`Bot ${botId} is missing credentialRef.apiKeyEnv`);
  }
  if (!apiSecretEnv || typeof apiSecretEnv !== 'string') {
    throw new Error(`Bot ${botId} is missing credentialRef.apiSecretEnv`);
  }

  const env = loadEnv(envPath);
  const apiKey = env[apiKeyEnv];
  const apiSecret = env[apiSecretEnv];

  if (!apiKey) {
    throw new Error(`Missing credential env for ${botId}: ${apiKeyEnv}`);
  }
  if (!apiSecret) {
    throw new Error(`Missing credential env for ${botId}: ${apiSecretEnv}`);
  }

  return {
    botId,
    credentialRef: {
      apiKeyEnv,
      apiSecretEnv,
    },
    apiKey,
    apiSecret,
  };
}

module.exports = {
  resolveBotCredentials,
};
