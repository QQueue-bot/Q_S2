const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const { loadBotRegistry } = require('../config/botRegistry');
const { resolveBotCredentials } = require('../config/resolveBotCredentials');
const { resolveBotSettings } = require('../config/resolveBotSettings');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

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

function resolveMdxMeta(botId, registryPath) {
  try {
    const ctx = resolveBotSettings(botId, { registryPath });
    return {
      mdxProfile: ctx.mdx.enabled ? ctx.mdx.profile : null,
      leverage: ctx.settings.positionSizing.leverage || null,
    };
  } catch {
    return { mdxProfile: null, leverage: null };
  }
}

async function fetchBotStatus(bot, registryPath, envPath) {
  const { mdxProfile, leverage } = resolveMdxMeta(bot.botId, registryPath);
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
    let unrealizedPnl = null;
    const pos = position?.result?.list?.[0];
    if (position?.retCode === 0 && pos && Number(pos.size || 0) > 0) {
      tradeState = pos.side === 'Buy' ? 'Long' : pos.side === 'Sell' ? 'Short' : 'In Trade';
      unrealizedPnl = Number(pos.unrealisedPnl ?? pos.unrealizedPnl ?? 0);
    }

    return {
      botId: bot.botId,
      symbol: bot.symbol,
      enabled: bot.enabled,
      mdxProfile,
      leverage,
      tradeState,
      balance,
      balanceStatus,
      unrealizedPnl,
    };
  } catch (error) {
    return {
      botId: bot.botId,
      symbol: bot.symbol,
      enabled: bot.enabled,
      mdxProfile,
      leverage,
      tradeState: 'Unknown',
      balance: null,
      balanceStatus: 'error',
      error: error.message,
    };
  }
}

function minutesAgo(isoString) {
  if (!isoString) return null;
  return Math.max(0, Math.floor((Date.now() - Date.parse(isoString)) / 60000));
}

function summarizeFailureReason(responseJson) {
  try {
    const parsed = JSON.parse(responseJson || '{}');
    return parsed.retMsg || parsed.error || 'failed';
  } catch {
    return 'failed';
  }
}

function loadLatestTradeActivity(dbPath) {
  try {
    const db = createDatabase(dbPath);
    initSchema(db);
    const latestSignal = db.prepare(`
      SELECT received_at, bot_id, signal, raw_input
      FROM normalized_signals
      ORDER BY id DESC
      LIMIT 1
    `).get() || null;
    const latestOrder = db.prepare(`
      SELECT created_at, bot_id, symbol, signal, status, side, qty, notional_usd, response_json
      FROM order_attempts
      ORDER BY id DESC
      LIMIT 1
    `).get() || null;
    const latestFailure = db.prepare(`
      SELECT created_at, bot_id, symbol, signal, status, response_json
      FROM order_attempts
      WHERE status = 'failed'
      ORDER BY id DESC
      LIMIT 1
    `).get() || null;
    db.close();
    return {
      latestSignal: latestSignal ? {
        ...latestSignal,
        ageMinutes: minutesAgo(latestSignal.received_at),
      } : null,
      latestOrder: latestOrder ? {
        ...latestOrder,
        ageMinutes: minutesAgo(latestOrder.created_at),
      } : null,
      latestFailure: latestFailure ? {
        ...latestFailure,
        ageMinutes: minutesAgo(latestFailure.created_at),
        reason: summarizeFailureReason(latestFailure.response_json),
      } : null,
    };
  } catch {
    return {
      latestSignal: null,
      latestOrder: null,
      latestFailure: null,
    };
  }
}

function loadHeartbeatStatus(dbPath) {
  try {
    const db = createDatabase(dbPath);
    initSchema(db);
    const persistence = buildPersistence(db);
    const latest = persistence.getLatestHeartbeatEvent ? persistence.getLatestHeartbeatEvent() : null;
    db.close();
    if (!latest || !latest.received_at) {
      return {
        lastHeartbeatAt: null,
        heartbeatAgeMinutes: null,
        heartbeatFresh: null,
        heartbeatStale: null,
        heartbeatStaleThresholdMinutes: 360,
      };
    }
    const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(latest.received_at)) / 60000));
    const stale = ageMinutes > 360;
    return {
      lastHeartbeatAt: latest.received_at,
      heartbeatAgeMinutes: ageMinutes,
      heartbeatFresh: !stale,
      heartbeatStale: stale,
      heartbeatStaleThresholdMinutes: 360,
    };
  } catch {
    return {
      lastHeartbeatAt: null,
      heartbeatAgeMinutes: null,
      heartbeatFresh: null,
      heartbeatStale: null,
      heartbeatStaleThresholdMinutes: 360,
    };
  }
}

async function buildMobileBotStatus(options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const envPath = options.envPath || '/home/ubuntu/.openclaw/.env';
  const dbPath = options.dbPath || '/tmp/qs2_review/data/s2.sqlite';
  const registry = loadBotRegistry(registryPath);

  const bots = await Promise.all(registry.bots.map((bot) => fetchBotStatus(bot, registryPath, envPath)));
  const heartbeat = loadHeartbeatStatus(dbPath);
  const activity = loadLatestTradeActivity(dbPath);

  return {
    totals: {
      bots: bots.length,
      enabled: bots.filter((bot) => bot.enabled).length,
      inTrade: bots.filter((bot) => bot.tradeState === 'Long' || bot.tradeState === 'Short').length,
    },
    bots,
    heartbeat,
    activity,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildMobileBotStatus,
};
