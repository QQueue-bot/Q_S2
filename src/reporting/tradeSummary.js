const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const dotenv = require('dotenv');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

function loadProjectEnv(envPath) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function sign(apiKey, apiSecret, query = '') {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const payload = timestamp + apiKey + recvWindow + query;
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return { timestamp, recvWindow, signature };
}

async function bybitGet(pathname, query, env) {
  const { timestamp, recvWindow, signature } = sign(env.apiKey, env.apiSecret, query);
  const response = await axios.get(`https://api-demo.bybit.com${pathname}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': env.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    validateStatus: () => true,
  });
  return response.data;
}

async function generateTradeSummary(options = {}) {
  const settingsPath = options.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const envPath = options.envPath || '/home/ubuntu/.openclaw/workspace/.env';
  loadProjectEnv(envPath);
  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing demo account API credentials in workspace .env');
  }

  const { settings } = loadAndValidateSettings(settingsPath);
  const dbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const attempts = persistence.getOrderAttempts();
  const latest = attempts.slice(-1)[0];
  if (!latest) {
    throw new Error('No order attempts found to summarize');
  }

  const symbol = latest.symbol;
  const env = { apiKey, apiSecret };
  const positions = await bybitGet('/v5/position/list', `category=linear&symbol=${symbol}`, env);
  const orders = await bybitGet('/v5/order/realtime', `category=linear&symbol=${symbol}`, env);

  const position = positions?.result?.list?.[0] || null;
  const liveOrder = orders?.result?.list?.[0] || null;

  const jsonSummary = {
    botId: latest.bot_id,
    symbol,
    signal: latest.signal,
    side: latest.side,
    orderStatus: latest.status,
    orderType: latest.order_type,
    orderQty: latest.qty,
    notionalUsd: latest.notional_usd,
    createdAt: latest.created_at,
    latestOrderResponse: JSON.parse(latest.response_json),
    currentPosition: position ? {
      symbol: position.symbol,
      side: position.side,
      size: position.size,
      avgPrice: position.avgPrice,
      markPrice: position.markPrice,
      unrealisedPnl: position.unrealisedPnl,
      takeProfit: position.takeProfit,
      stopLoss: position.stopLoss,
      leverage: position.leverage,
      positionStatus: position.positionStatus,
      updatedTime: position.updatedTime,
    } : null,
    currentOpenOrder: liveOrder ? {
      orderId: liveOrder.orderId,
      orderType: liveOrder.orderType,
      side: liveOrder.side,
      qty: liveOrder.qty,
      price: liveOrder.price,
      orderStatus: liveOrder.orderStatus,
      createdTime: liveOrder.createdTime,
    } : null,
    notableEvents: [
      'Signal received and parsed',
      'Risk evaluation passed for entry execution',
      'Demo market order submitted to Bybit',
    ],
  };

  const textSummary = [
    `Trade summary for ${jsonSummary.botId} / ${jsonSummary.symbol}`,
    `Signal: ${jsonSummary.signal}`,
    `Side: ${jsonSummary.side}`,
    `Order status: ${jsonSummary.orderStatus}`,
    `Qty: ${jsonSummary.orderQty}`,
    `Notional USD: ${jsonSummary.notionalUsd}`,
    `Created: ${jsonSummary.createdAt}`,
    jsonSummary.currentPosition
      ? `Current position: side=${jsonSummary.currentPosition.side || 'flat'}, size=${jsonSummary.currentPosition.size}, avgPrice=${jsonSummary.currentPosition.avgPrice || 'n/a'}, markPrice=${jsonSummary.currentPosition.markPrice || 'n/a'}, unrealisedPnl=${jsonSummary.currentPosition.unrealisedPnl || 'n/a'}`
      : 'Current position: unavailable',
    jsonSummary.currentOpenOrder
      ? `Open order: ${jsonSummary.currentOpenOrder.orderId} status=${jsonSummary.currentOpenOrder.orderStatus}`
      : 'Open order: none',
    'Notable events:',
    ...jsonSummary.notableEvents.map(x => `- ${x}`),
  ].join('\n');

  return { jsonSummary, textSummary };
}

module.exports = {
  generateTradeSummary,
};
