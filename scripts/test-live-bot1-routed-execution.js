#!/usr/bin/env node
const { executePaperTrade } = require('../src/execution/bybitExecution');
const { resolveBotContext } = require('../src/config/resolveBotContext');

(async () => {
  const envPath = '/home/ubuntu/.openclaw/.env';
  const botContext = resolveBotContext('Bot1', { envPath });

  const result = await executePaperTrade({
    signal: 'ENTER_LONG',
    botId: 'Bot1',
    receivedAt: new Date().toISOString(),
    raw: 'ENTER_LONG_Bot1',
  }, {
    settingsPath: '/tmp/qs2_review/config/settings.json',
    envPath,
    botContext,
    dbPath: '/tmp/qs2_review/data/s2.sqlite',
    bybitBaseUrl: 'https://api.bybit.com',
    stageDelaySeconds: 1,
  });

  console.log(JSON.stringify({
    botId: botContext.botId,
    symbol: botContext.symbol,
    credentialRef: botContext.credentials.credentialRef,
    ok: result.ok,
    dbPath: result.dbPath,
    side: result.side,
    sizing: result.sizing,
    reversal: result.reversal,
    stagedEntry: result.stagedEntry,
    response: result.response,
  }, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
})();
