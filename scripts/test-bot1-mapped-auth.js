#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');
const { resolveBotContext } = require('../src/config/resolveBotContext');

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
  });

  return response.data;
}

(async () => {
  const bot1 = resolveBotContext('Bot1', { envPath: '/home/ubuntu/.openclaw/.env' });
  const credentials = {
    apiKey: bot1.credentials.apiKey,
    apiSecret: bot1.credentials.apiSecret,
  };

  const wallet = await bybitPrivateGet('/v5/account/wallet-balance', 'accountType=UNIFIED', credentials);
  const instrument = await bybitPrivateGet('/v5/market/instruments-info', 'category=linear&symbol=BTCUSDT', credentials);
  const position = await bybitPrivateGet('/v5/position/list', 'category=linear&symbol=BTCUSDT', credentials);

  console.log(JSON.stringify({
    botId: bot1.botId,
    symbol: bot1.symbol,
    credentialRef: bot1.credentials.credentialRef,
    walletRetCode: wallet?.retCode,
    walletRetMsg: wallet?.retMsg,
    instrumentRetCode: instrument?.retCode,
    instrumentRetMsg: instrument?.retMsg,
    positionRetCode: position?.retCode,
    positionRetMsg: position?.retMsg,
    positionSize: position?.result?.list?.[0]?.size || null,
  }, null, 2));

  if (wallet?.retCode !== 0) process.exit(1);
  if (instrument?.retCode !== 0) process.exit(1);
  if (position?.retCode !== 0) process.exit(1);
})();
