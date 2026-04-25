'use strict';

const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
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
    let positionSize = null;
    let avgEntryPrice = null;
    let markPrice = null;
    const pos = position?.result?.list?.[0];
    if (position?.retCode === 0 && pos && Number(pos.size || 0) > 0) {
      tradeState = pos.side === 'Buy' ? 'Long' : pos.side === 'Sell' ? 'Short' : 'In Trade';
      unrealizedPnl = Number(pos.unrealisedPnl ?? pos.unrealizedPnl ?? 0);
      positionSize = pos.size || null;
      avgEntryPrice = pos.avgPrice ? Number(pos.avgPrice) : null;
      markPrice = pos.markPrice ? Number(pos.markPrice) : null;
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
      positionSize,
      avgEntryPrice,
      markPrice,
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
      unrealizedPnl: null,
      positionSize: null,
      avgEntryPrice: null,
      markPrice: null,
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

// Estimate approximate P&L for a single exit event.
// Uses: gain = position_notional_at_entry * trigger_pct / 100
// where entry_notional ≈ qty * mark_price / (1 + trigger_pct/100)
function approxExitPnl(exit) {
  const qty = Number(exit.qty) || 0;
  const mp = Number(exit.mark_price) || 0;
  const pct = Math.abs(Number(exit.trigger_percent) || 0);
  if (!qty || !mp || !pct) return 0;
  const raw = qty * mp * pct / (100 + pct);
  return exit.exit_reason === 'stop_loss' ? -raw : raw;
}

function calcTradeStats(rows) {
  const count = rows.length;
  const wins = rows.filter(r => r.exit_reason === 'take_profit').length;
  const losses = rows.filter(r => r.exit_reason === 'stop_loss').length;
  const approxPnl = rows.reduce((s, r) => s + approxExitPnl(r), 0);
  return {
    count,
    wins,
    losses,
    winRate: count > 0 ? wins / count : null,
    approxPnl,
  };
}

function loadBotTradeStats(db, botId) {
  try {
    const todayStr = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const sevenDaysAgoStr = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const exits = db.prepare(`
      SELECT created_at, exit_reason, trigger_percent, qty, mark_price
      FROM exit_events WHERE bot_id = ?
      ORDER BY id DESC
    `).all(botId);

    const lastSignal = db.prepare(`
      SELECT received_at, signal, raw_input
      FROM normalized_signals WHERE bot_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(botId) || null;

    const lastOrder = db.prepare(`
      SELECT created_at, signal, status, side
      FROM order_attempts WHERE bot_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(botId) || null;

    return {
      allTime: calcTradeStats(exits),
      today: calcTradeStats(exits.filter(e => e.created_at >= todayStr)),
      sevenDay: calcTradeStats(exits.filter(e => e.created_at >= sevenDaysAgoStr)),
      lastSignal: lastSignal
        ? { ...lastSignal, ageMinutes: minutesAgo(lastSignal.received_at) }
        : null,
      lastOrder: lastOrder
        ? { ...lastOrder, ageMinutes: minutesAgo(lastOrder.created_at) }
        : null,
    };
  } catch {
    return { allTime: null, today: null, sevenDay: null, lastSignal: null, lastOrder: null };
  }
}

function loadPortfolioReviewCriteria(db, bots) {
  try {
    const allExits = db.prepare('SELECT exit_reason FROM exit_events').all();
    const totalExits = allExits.length;
    const totalWins = allExits.filter(e => e.exit_reason === 'take_profit').length;
    const winRate = totalExits > 0 ? totalWins / totalExits : 0;

    const baseline = 400; // 8 bots × 50 USDT
    const botBaseline = 50;
    const totalBalance = bots.reduce((s, b) => s + (Number.isFinite(b.balance) ? b.balance : 0), 0);
    const worstBot = bots.reduce((worst, b) => {
      if (!Number.isFinite(b.balance)) return worst;
      return b.balance < worst.balance ? { botId: b.botId, balance: b.balance } : worst;
    }, { botId: null, balance: Infinity });

    return [
      {
        label: 'Portfolio P&L positive (last 14 days)',
        pass: totalBalance > baseline,
        detail: `${totalBalance.toFixed(0)} USDT vs ${baseline} USDT baseline`,
      },
      {
        label: 'No single bot down >25% from starting wallet',
        pass: worstBot.balance >= botBaseline * 0.75,
        detail: worstBot.botId
          ? `Lowest: ${worstBot.botId} at ${worstBot.balance.toFixed(0)} USDT (threshold: ${(botBaseline * 0.75).toFixed(0)})`
          : 'No balance data',
      },
      {
        label: 'Portfolio win rate >40%',
        pass: winRate > 0.40,
        detail: `${totalExits > 0 ? (winRate * 100).toFixed(1) : 'n/a'}% (${totalWins}/${totalExits} exits)`,
      },
      {
        label: 'At least 30 closed trades (all bots)',
        pass: totalExits >= 30,
        detail: `${totalExits} closed trades recorded`,
      },
    ];
  } catch {
    return [];
  }
}

function loadServiceHealth(dbPath) {
  const health = {
    webhookService: 'unknown',
    tunnelService: 'unknown',
    dbConnected: false,
    exitEventCount: null,
    managementLoopLastAt: null,
    managementLoopAgeMinutes: null,
  };

  try {
    health.webhookService = execSync('systemctl is-active q-s2-webhook 2>/dev/null || echo inactive', { encoding: 'utf8', timeout: 3000 }).trim();
    health.tunnelService = execSync('systemctl is-active q-s2-tunnel 2>/dev/null || echo inactive', { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {}

  try {
    const db = createDatabase(dbPath);
    initSchema(db);
    health.dbConnected = true;
    health.exitEventCount = db.prepare('SELECT COUNT(*) AS n FROM exit_events').get()?.n ?? 0;

    const hasMgmtTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='management_loop_events'").get();
    const proxy = hasMgmtTable
      ? db.prepare('SELECT MAX(created_at) AS ts FROM management_loop_events').get()
      : db.prepare('SELECT MAX(created_at) AS ts FROM exit_events').get();
    health.managementLoopLastAt = proxy?.ts || null;
    if (health.managementLoopLastAt) {
      health.managementLoopAgeMinutes = minutesAgo(health.managementLoopLastAt);
    }
    db.close();
  } catch {}

  return health;
}

function buildMdxRenewalMeta() {
  const renewalDateStr = process.env.MDX_RENEWAL_DATE || null;
  if (!renewalDateStr) {
    return { renewalDate: null, daysRemaining: null, color: 'neutral' };
  }
  const renewal = new Date(renewalDateStr + 'T00:00:00Z');
  const todayUtc = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const daysRemaining = Math.ceil((renewal - todayUtc) / (1000 * 60 * 60 * 24));
  const color = daysRemaining <= 7 ? 'red' : daysRemaining <= 14 ? 'amber' : 'green';
  return { renewalDate: renewalDateStr, daysRemaining, color };
}

async function buildMobileBotStatus(options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const envPath = options.envPath || '/home/ubuntu/.openclaw/.env';
  const dbPath = options.dbPath || '/tmp/qs2_review/data/s2.sqlite';
  const registry = loadBotRegistry(registryPath);

  const bots = await Promise.all(registry.bots.map((bot) => fetchBotStatus(bot, registryPath, envPath)));
  const heartbeat = loadHeartbeatStatus(dbPath);
  const activity = loadLatestTradeActivity(dbPath);
  const mdx = buildMdxRenewalMeta();
  const serviceHealth = loadServiceHealth(dbPath);

  // Per-bot trade stats and portfolio review criteria from single DB open
  let botsWithStats = bots;
  let reviewCriteria = [];
  try {
    const db = createDatabase(dbPath);
    initSchema(db);
    const tradeStatsByBot = {};
    for (const bot of bots) {
      tradeStatsByBot[bot.botId] = loadBotTradeStats(db, bot.botId);
    }
    reviewCriteria = loadPortfolioReviewCriteria(db, bots);
    db.close();
    botsWithStats = bots.map(bot => ({
      ...bot,
      tradeStats: tradeStatsByBot[bot.botId] || null,
    }));
  } catch {}

  const validBalances = bots.filter(b => Number.isFinite(b.balance));
  const totalBalance = validBalances.reduce((s, b) => s + b.balance, 0);
  const totalUnrealizedPnl = bots.reduce((s, b) => s + (Number.isFinite(b.unrealizedPnl) ? b.unrealizedPnl : 0), 0);

  return {
    totals: {
      bots: bots.length,
      enabled: bots.filter((bot) => bot.enabled).length,
      inTrade: bots.filter((bot) => bot.tradeState === 'Long' || bot.tradeState === 'Short').length,
    },
    bots: botsWithStats,
    heartbeat,
    activity,
    mdx,
    reviewCriteria,
    serviceHealth,
    portfolio: {
      totalBalance,
      totalUnrealizedPnl,
      balanceDataCount: validBalances.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildMobileBotStatus,
};
