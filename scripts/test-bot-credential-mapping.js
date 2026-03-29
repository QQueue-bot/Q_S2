#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { resolveBotCredentials } = require('../src/config/resolveBotCredentials');
const { resolveBotContext } = require('../src/config/resolveBotContext');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');
const envPath = '/home/ubuntu/.openclaw/workspace/.env';

const bot1Credentials = resolveBotCredentials('Bot1', { registryPath, envPath });
const bot1Context = resolveBotContext('Bot1', { registryPath, envPath });

const brokenRegistryPath = '/tmp/qs2_broken_credentials_registry.json';
fs.writeFileSync(brokenRegistryPath, JSON.stringify({
  bots: [
    {
      botId: 'BrokenBot',
      enabled: true,
      symbol: 'BTCUSDT',
      settingsRef: './settings.json',
      credentialRef: {
        apiKeyEnv: 'MISSING_BROKEN_API_KEY',
        apiSecretEnv: 'MISSING_BROKEN_API_SECRET'
      }
    }
  ]
}, null, 2));

let missingCredentialError = null;
try {
  resolveBotCredentials('BrokenBot', { registryPath: brokenRegistryPath, envPath });
} catch (error) {
  missingCredentialError = error.message;
}

const invalidRegistryPath = '/tmp/qs2_invalid_credentials_registry.json';
fs.writeFileSync(invalidRegistryPath, JSON.stringify({
  bots: [
    {
      botId: 'InvalidBot',
      enabled: true,
      symbol: 'BTCUSDT',
      settingsRef: './settings.json',
      credentialRef: {
        apiKeyEnv: '',
        apiSecretEnv: 'BYBIT_TESTNET_API_SECRET'
      }
    }
  ]
}, null, 2));

let invalidCredentialRefError = null;
try {
  resolveBotCredentials('InvalidBot', { registryPath: invalidRegistryPath, envPath });
} catch (error) {
  invalidCredentialRefError = error.message;
}

console.log(JSON.stringify({
  bot1CredentialRef: bot1Credentials.credentialRef,
  bot1Context: {
    botId: bot1Context.botId,
    symbol: bot1Context.symbol,
    credentialRef: bot1Context.credentials.credentialRef,
  },
  missingCredentialError,
  invalidCredentialRefError,
}, null, 2));

if (!bot1Credentials.apiKey || !bot1Credentials.apiSecret) process.exit(1);
if (!missingCredentialError) process.exit(1);
if (!invalidCredentialRefError) process.exit(1);
