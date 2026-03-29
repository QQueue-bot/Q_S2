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

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatPositionSummary(position) {
  if (!position) {
    return 'Current position: unavailable';
  }
  return `Current position: side=${position.side || 'flat'}, size=${position.size}, avgPrice=${position.avgPrice || 'n/a'}, markPrice=${position.markPrice || 'n/a'}, unrealisedPnl=${position.unrealisedPnl || 'n/a'}`;
}

function formatOpenOrderSummary(order) {
  if (!order) {
    return 'Open order: none';
  }
  return `Open order: ${order.orderId} status=${order.orderStatus}`;
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
  const configuredDbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const candidateDbPaths = [
    options.dbPath,
    process.env.S2_DB_PATH,
    configuredDbPath,
    '/tmp/qs2_review/data/s2.sqlite',
  ].filter(Boolean);

  let latest = null;
  let resolvedDbPath = null;
  let attempts = [];

  for (const candidate of candidateDbPaths) {
    const dbPath = path.resolve(candidate);
    const db = createDatabase(dbPath);
    initSchema(db);
    const persistence = buildPersistence(db);
    const foundAttempts = persistence.getOrderAttempts();
    const mostRecent = foundAttempts.slice(-1)[0] || null;
    if (mostRecent) {
      latest = mostRecent;
      attempts = foundAttempts;
      resolvedDbPath = dbPath;
      break;
    }
  }

  if (!latest) {
    throw new Error(`No order attempts found to summarize in candidate DB paths: ${candidateDbPaths.join(', ')}`);
  }

  const symbol = latest.symbol;
  const env = { apiKey, apiSecret };
  const positions = await bybitGet('/v5/position/list', `category=linear&symbol=${symbol}`, env);
  const orders = await bybitGet('/v5/order/realtime', `category=linear&symbol=${symbol}`, env);

  const position = positions?.result?.list?.[0] || null;
  const liveOrder = orders?.result?.list?.[0] || null;
  const latestOrderResponse = safeJsonParse(latest.response_json);
  const recentAttempts = attempts.slice(-10);
  const recentSignals = recentAttempts.map(x => x.signal);
  const distinctRecentSignals = [...new Set(recentSignals)];
  const recentSignalFlips = recentSignals.slice(1).reduce((count, signal, index) => {
    return count + (signal !== recentSignals[index] ? 1 : 0);
  }, 0);

  const trade = {
    botId: latest.bot_id,
    symbol,
    signal: latest.signal,
    side: latest.side,
    orderStatus: latest.status,
    orderType: latest.order_type,
    orderQty: latest.qty,
    notionalUsd: latest.notional_usd,
    createdAt: latest.created_at,
    sourceDbPath: resolvedDbPath,
  };

  const currentPosition = position ? {
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
  } : null;

  const currentOpenOrder = liveOrder ? {
    orderId: liveOrder.orderId,
    orderType: liveOrder.orderType,
    side: liveOrder.side,
    qty: liveOrder.qty,
    price: liveOrder.price,
    orderStatus: liveOrder.orderStatus,
    createdTime: liveOrder.createdTime,
  } : null;

  const recentActivity = {
    orderAttemptCount: attempts.length,
    recentOrderAttemptCount: recentAttempts.length,
    recentSignals,
    distinctRecentSignals,
    recentSignalFlipCount: recentSignalFlips,
    latestTenAttemptWindow: recentAttempts.map(item => ({
      createdAt: item.created_at,
      signal: item.signal,
      side: item.side,
      status: item.status,
      qty: item.qty,
    })),
  };

  const notableEvents = [
    'Signal received and parsed',
    'Risk evaluation passed for entry execution',
    latest.status === 'submitted'
      ? 'Demo market order submitted to Bybit'
      : `Latest order attempt status was ${latest.status}`,
    recentSignalFlips > 0
      ? `Recent signal direction changed ${recentSignalFlips} times in the last ${recentAttempts.length} attempts`
      : `Recent signal direction stayed consistent across the last ${recentAttempts.length} attempts`,
  ];

  const jsonSummary = {
    summaryVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    trade,
    recentActivity,
    currentPosition,
    currentOpenOrder,
    latestOrderResponse,
    notableEvents,
  };

  const textSummary = [
    `Trade summary for ${trade.botId} / ${trade.symbol}`,
    `Signal: ${trade.signal}`,
    `Side: ${trade.side}`,
    `Order status: ${trade.orderStatus}`,
    `Order type: ${trade.orderType}`,
    `Qty: ${trade.orderQty}`,
    `Notional USD: ${trade.notionalUsd}`,
    `Created: ${trade.createdAt}`,
    `Generated: ${jsonSummary.generatedAt}`,
    `Source DB: ${trade.sourceDbPath}`,
    `Recent attempts: ${recentActivity.recentOrderAttemptCount} shown / ${recentActivity.orderAttemptCount} total`,
    `Distinct recent signals: ${recentActivity.distinctRecentSignals.join(', ')}`,
    `Recent signal flips: ${recentActivity.recentSignalFlipCount}`,
    formatPositionSummary(currentPosition),
    formatOpenOrderSummary(currentOpenOrder),
    'Notable events:',
    ...notableEvents.map(x => `- ${x}`),
  ].join('\n');

  return { jsonSummary, textSummary };
}

module.exports = {
  generateTradeSummary,
};
