#!/usr/bin/env node
const { resolveBotContext } = require('../src/config/resolveBotContext');
const { createRiskEngine } = require('../src/risk/evaluateSignal');

const bot1 = resolveBotContext('Bot1');

let unknownBotError = null;
try {
  resolveBotContext('UnknownBot');
} catch (error) {
  unknownBotError = error.message;
}

const riskEngine = createRiskEngine({
  settingsPath: bot1.settingsPath,
  botContext: bot1,
});

const matchingRisk = riskEngine.evaluate({
  signal: 'ENTER_LONG',
  botId: 'Bot1',
  receivedAt: new Date().toISOString(),
  raw: 'ENTER_LONG_Bot1',
});

const mismatchedRisk = riskEngine.evaluate({
  signal: 'ENTER_LONG',
  botId: 'Bot999',
  receivedAt: new Date().toISOString(),
  raw: 'ENTER_LONG_Bot999',
});

console.log(JSON.stringify({
  bot1: {
    botId: bot1.botId,
    symbol: bot1.symbol,
    settingsPath: bot1.settingsPath,
    allowedBots: bot1.allowedBots,
  },
  matchingRisk,
  mismatchedRisk,
  unknownBotError,
}, null, 2));

if (bot1.botId !== 'Bot1') process.exit(1);
if (bot1.symbol !== 'BTCUSDT') process.exit(1);
if (!Array.isArray(bot1.allowedBots) || !bot1.allowedBots.includes('Bot1')) process.exit(1);
if (mismatchedRisk.allowed !== false) process.exit(1);
if (!mismatchedRisk.reasons.some(reason => reason.includes('Bot is not allowed'))) process.exit(1);
if (!mismatchedRisk.reasons.some(reason => reason.includes('Resolved bot context mismatch'))) process.exit(1);
if (!unknownBotError) process.exit(1);
