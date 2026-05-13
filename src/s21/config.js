'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 's21-bots.json');

function loadS21Config(configPath = DEFAULT_CONFIG_PATH) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  if (!Array.isArray(config.bots) || config.bots.length === 0) {
    throw new Error('s21-bots.json: bots array is missing or empty');
  }
  for (const bot of config.bots) {
    _validateBot(bot);
  }
  return config;
}

function _validateBot(bot) {
  const required = ['botId', 'engine', 'symbol', 'strategy', 'scaledEntry', 'credentialRef', 'notionalUsd'];
  for (const key of required) {
    if (bot[key] == null) throw new Error(`s21-bots.json: bot missing field "${key}"`);
  }
  if (typeof bot.notionalUsd !== 'number' || bot.notionalUsd <= 0) {
    throw new Error(`s21-bots.json: ${bot.botId} notionalUsd must be a positive number, got ${bot.notionalUsd}`);
  }
  const { tpTargetsPercent, tpAllocations } = bot.strategy;
  if (!Array.isArray(tpTargetsPercent) || tpTargetsPercent.length !== 6) {
    throw new Error(`s21-bots.json: ${bot.botId} tpTargetsPercent must be a 6-element array`);
  }
  if (!Array.isArray(tpAllocations) || tpAllocations.length !== 6) {
    throw new Error(`s21-bots.json: ${bot.botId} tpAllocations must be a 6-element array`);
  }
  const allocSum = tpAllocations.reduce((a, b) => a + b, 0);
  if (Math.abs(allocSum - 1.0) > 0.001) {
    throw new Error(`s21-bots.json: ${bot.botId} tpAllocations must sum to 1.0 (got ${allocSum})`);
  }
}

function getS21BotIds(configPath) {
  return loadS21Config(configPath).bots.map(b => b.botId);
}

function getS21BotConfig(botId, configPath) {
  const config = loadS21Config(configPath);
  const bot = config.bots.find(b => b.botId === botId);
  if (!bot) throw new Error(`S2.1 bot not found in registry: ${botId}`);
  return bot;
}

function resolveS21Credentials(bot, envPath) {
  const env = _loadEnv(envPath);
  const apiKey = env[bot.credentialRef.apiKeyEnv] || process.env[bot.credentialRef.apiKeyEnv];
  const apiSecret = env[bot.credentialRef.apiSecretEnv] || process.env[bot.credentialRef.apiSecretEnv];
  if (!apiKey || !apiSecret) {
    throw new Error(
      `S2.1 credentials not found for ${bot.botId}: need ${bot.credentialRef.apiKeyEnv} and ${bot.credentialRef.apiSecretEnv}`
    );
  }
  return { apiKey, apiSecret };
}

function _loadEnv(envPath) {
  if (!envPath) return {};
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

module.exports = {
  loadS21Config,
  getS21BotIds,
  getS21BotConfig,
  resolveS21Credentials,
};
