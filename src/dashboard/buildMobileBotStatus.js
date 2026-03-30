const crypto = require('crypto');
const axios = require('axios');
const { loadBotRegistry } = require('../config/botRegistry');
const { resolveBotCredentials } = require('../config/resolveBotCredentials');

function signRequest({ apiKey, apiSecret, timestamp, recvWindow, query = '' }) {
  const payloadToSign = timestamp + apiKey + recvWindow + query;
  return crypto.createHmac('sha256', apiSecret).update(payloadToSign).digest('hex');
}

async function bybitPrivateGet(pathname, query, credentials) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow,
    query,
  });

  const response = await axios.get(`https://api.bybit.com${pathname}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    validateStatus: () => true,
    timeout: 10000,
  });

  return response.data;
}

async function fetchBotStatus(bot, registryPath, envPath) {
  try {
    const resolved = resolveBotCredentials(bot.botId, { registryPath, envPath });
    const credentials = { apiKey: resolved.apiKey, apiSecret: resolved.apiSecret };

    const [wallet, position] = await Promise.all([
      bybitPrivateGet('/v5/account/wallet-balance', 'accountType=UNIFIED', credentials),
      bybitPrivateGet('/v5/position/list', `category=linear&symbol=${bot.symbol}`, credentials),
    ]);

    let balance = null;
    let balanceStatus = 'unavailable';
    if (wallet?.retCode === 0) {
      const coins = wallet?.result?.list?.[0]?.coin || [];
      const usdt = coins.find((coin) => coin.coin === 'USDT');
      if (usdt) {
        const walletBalance = Number(usdt.walletBalance || 0);
        const unrealisedPnl = Number(usdt.unrealisedPnl || 0);
        balance = walletBalance + unrealisedPnl;
        balanceStatus = 'ok';
      } else {
        balance = 0;
        balanceStatus = 'empty';
      }
    }

    let tradeState = 'Flat';
    const pos = position?.result?.list?.[0];
    if (position?.retCode === 0 && pos && Number(pos.size || 0) > 0) {
      tradeState = pos.side === 'Buy' ? 'Long' : pos.side === 'Sell' ? 'Short' : 'In Trade';
    }

    return {
      botId: bot.botId,
      symbol: bot.symbol,
      enabled: bot.enabled,
      tradeState,
      balance,
      balanceStatus,
    };
  } catch (error) {
    return {
      botId: bot.botId,
      symbol: bot.symbol,
      enabled: bot.enabled,
      tradeState: 'Unknown',
      balance: null,
      balanceStatus: 'error',
      error: error.message,
    };
  }
}

async function buildMobileBotStatus(options = {}) {
  const registryPath = options.registryPath || require('path').join(__dirname, '..', '..', 'config', 'bots.json');
  const envPath = options.envPath || '/home/ubuntu/.openclaw/.env';
  const registry = loadBotRegistry(registryPath);

  const bots = await Promise.all(registry.bots.map((bot) => fetchBotStatus(bot, registryPath, envPath)));

  return {
    totals: {
      bots: bots.length,
      enabled: bots.filter((bot) => bot.enabled).length,
      inTrade: bots.filter((bot) => bot.tradeState === 'Long' || bot.tradeState === 'Short').length,
    },
    bots,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildMobileBotStatus,
};
