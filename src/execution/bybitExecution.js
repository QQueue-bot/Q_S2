const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { resolveBotContext } = require('../config/resolveBotContext');
const { resolveBotSettings } = require('../config/resolveBotSettings');
const { resolveDcaStrategy } = require('../config/resolveDcaStrategy');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

const DEFAULT_BYBIT_BASE_URL = 'https://api-demo.bybit.com';
const ANALYSIS_QUEUE_DIR = '/home/ubuntu/s2/data/analysis_queue';

function getBybitBaseUrl(options = {}) {
  if (options.bybitBaseUrl) return options.bybitBaseUrl;
  if (process.env.BYBIT_BASE_URL) return process.env.BYBIT_BASE_URL;
  return DEFAULT_BYBIT_BASE_URL;
}

function loadProjectEnv(envPath) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function sideFromSignal(signal) {
  if (signal === 'ENTER_LONG') return 'Buy';
  if (signal === 'ENTER_SHORT') return 'Sell';
  throw new Error(`Unsupported execution signal: ${signal}`);
}

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes('.')) return 0;
  return text.split('.')[1].length;
}

function floorToStep(value, step) {
  const precision = decimalPlaces(step);
  const floored = Math.floor(value / step) * step;
  return Number(floored.toFixed(precision));
}

function computeOrderSizing({ effectiveAccountBalanceUsd, accountPercent, leverage, referencePrice, qtyStep, minOrderQty, maxMktOrderQty, minNotionalValue }) {
  const marginUsd = effectiveAccountBalanceUsd * (accountPercent / 100);
  const notionalUsd = marginUsd * leverage;
  let qty = notionalUsd / referencePrice;
  qty = floorToStep(qty, qtyStep);
  if (qty < minOrderQty) {
    throw new Error(`Computed qty ${qty} is below minOrderQty ${minOrderQty}`);
  }
  if (qty > maxMktOrderQty) {
    qty = floorToStep(maxMktOrderQty, qtyStep);
  }
  const finalNotional = qty * referencePrice;
  if (finalNotional < minNotionalValue) {
    throw new Error(`Computed notional ${finalNotional} is below minNotionalValue ${minNotionalValue}`);
  }
  return {
    marginUsd,
    notionalUsd: finalNotional,
    qty: qty.toFixed(decimalPlaces(qtyStep)),
  };
}

async function fetchKlineCandles(symbol, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=100`);
  const list = response.data?.result?.list || [];
  return list.slice().reverse().map(row => ({
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  }));
}

function writeAnalysisQueueJob({ botId, symbol, tradeId, side, signal, entryPrice, candles }) {
  try {
    fs.mkdirSync(ANALYSIS_QUEUE_DIR, { recursive: true });
    const safeId = tradeId.replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(ANALYSIS_QUEUE_DIR, `${safeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      jobId: safeId,
      status: 'pending',
      botId,
      symbol,
      tradeId,
      signalDirection: signal,
      side,
      entryPrice,
      timestamp: new Date().toISOString(),
      candles,
    }, null, 2));
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getInstrumentInfo(symbol, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}/v5/market/instruments-info?category=linear&symbol=${symbol}`);
  const instrument = response.data?.result?.list?.[0];
  if (!instrument) {
    throw new Error(`Instrument info not found for ${symbol}`);
  }
  return instrument;
}

async function getLiveReferencePrice(symbol, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}/v5/market/tickers?category=linear&symbol=${symbol}`);
  const ticker = response.data?.result?.list?.[0];
  const price = Number(ticker?.lastPrice || 0);
  if (!price) {
    throw new Error(`Live reference price not found for ${symbol}`);
  }
  return {
    last_price: price,
    source: 'bybit_ticker',
  };
}

function signRequest({ apiKey, apiSecret, timestamp, recvWindow, query = '', body = '' }) {
  const payloadToSign = timestamp + apiKey + recvWindow + (query || body);
  return crypto.createHmac('sha256', apiSecret).update(payloadToSign).digest('hex');
}

async function bybitPrivateGet(pathname, query, credentials, options = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow,
    query,
  });
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}${pathname}?${query}`, {
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

async function bybitPrivatePost(pathname, bodyObject, credentials, options = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const body = JSON.stringify(bodyObject);
  const signature = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow,
    body,
  });
  const baseUrl = getBybitBaseUrl(options);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    body,
  });
  return {
    ok: response.ok,
    json: await response.json(),
  };
}

async function getLivePosition(symbol, credentials, options = {}) {
  const response = await bybitPrivateGet('/v5/position/list', `category=linear&symbol=${symbol}`, credentials, options);
  const positions = response?.result?.list || [];
  return positions.find(position => Number(position.size || 0) > 0) || null;
}

async function getAvailableAccountBalance(credentials, options = {}) {
  const response = await bybitPrivateGet('/v5/account/wallet-balance', 'accountType=UNIFIED', credentials, options);
  const coins = response?.result?.list?.[0]?.coin || [];
  const usdt = coins.find(coin => coin.coin === 'USDT');
  const walletBalance = Number(usdt?.walletBalance || 0);
  if (!walletBalance) {
    throw new Error('Unable to resolve live USDT wallet balance for sizing');
  }
  return walletBalance;
}

function isOppositePosition(signal, positionSide) {
  return (signal === 'ENTER_LONG' && positionSide === 'Sell') || (signal === 'ENTER_SHORT' && positionSide === 'Buy');
}

async function closeOppositePosition({ symbol, parsedSignal, livePosition, credentials, persistence, bybitBaseUrl }) {
  const closeSide = livePosition.side === 'Buy' ? 'Sell' : 'Buy';
  const closePayload = {
    category: 'linear',
    symbol,
    side: closeSide,
    orderType: 'Market',
    qty: livePosition.size,
    positionIdx: 0,
    reduceOnly: true,
  };

  const result = await bybitPrivatePost('/v5/order/create', closePayload, credentials, { bybitBaseUrl });
  persistence.recordOrderAttempt({
    created_at: new Date().toISOString(),
    signal: `${parsedSignal.signal}_CLOSE_FIRST`,
    bot_id: parsedSignal.botId,
    symbol,
    side: closeSide,
    order_type: 'Market',
    qty: livePosition.size,
    notional_usd: Number(livePosition.size) * Number(livePosition.markPrice || livePosition.avgPrice || 0),
    status: result.ok && result.json.retCode === 0 ? 'submitted' : 'failed',
    response_json: JSON.stringify(result.json),
  });

  return {
    ok: result.ok && result.json.retCode === 0,
    side: closeSide,
    qty: livePosition.size,
    response: result.json,
  };
}

function computePnlPercent(positionSide, entryPrice, markPrice) {
  if (!entryPrice || !markPrice) return null;
  const entry = Number(entryPrice);
  const mark = Number(markPrice);
  if (!entry || !mark) return null;
  if (positionSide === 'Buy') {
    return ((mark - entry) / entry) * 100;
  }
  if (positionSide === 'Sell') {
    return ((entry - mark) / entry) * 100;
  }
  return null;
}

function getTradeId(livePosition, symbol) {
  const createdTime = livePosition?.createdTime ? String(livePosition.createdTime) : 'unknown';
  const side = livePosition?.side || 'unknown';
  return `${symbol}:${side}:${createdTime}`;
}

function hasTradeActionExecuted(persistence, tradeId, actionKey) {
  if (!persistence.findTradeStateEventByKey) {
    return false;
  }
  return Boolean(persistence.findTradeStateEventByKey({ trade_id: tradeId, action_key: actionKey }));
}

function recordTradeAction(persistence, payload) {
  if (!persistence.recordTradeStateEvent) {
    return;
  }
  persistence.recordTradeStateEvent(payload);
}

function hasBreakEvenArmed(persistence, symbol, livePosition = null) {
  const events = persistence.getBreakEvenEvents ? persistence.getBreakEvenEvents() : [];
  const entryTimestampMs = livePosition?.createdTime ? Number(livePosition.createdTime) : null;
  return events.some(event => {
    if (event.symbol !== symbol || event.event_type !== 'armed') {
      return false;
    }
    if (!entryTimestampMs) {
      return true;
    }
    const eventTimestampMs = Date.parse(event.created_at);
    if (Number.isNaN(eventTimestampMs)) {
      return false;
    }
    return eventTimestampMs >= entryTimestampMs;
  });
}

function shouldTriggerBreakEven(settings, livePosition, persistence) {
  if (!livePosition || !settings.breakEven?.enabled || settings.breakEven.triggerPercent <= 0) {
    return { type: 'none' };
  }

  const pnlPercent = computePnlPercent(livePosition.side, livePosition.avgPrice, livePosition.markPrice);
  if (pnlPercent === null) {
    return { type: 'none' };
  }

  const armed = hasBreakEvenArmed(persistence, livePosition.symbol, livePosition);
  const triggerPercent = Number(settings.breakEven.triggerPercent);
  const entryPrice = Number(livePosition.avgPrice || 0);
  const markPrice = Number(livePosition.markPrice || 0);

  if (!armed && pnlPercent >= triggerPercent) {
    return {
      type: 'arm_break_even',
      triggerPercent,
      pnlPercent,
      entryPrice,
      markPrice,
    };
  }

  const returnedToEntry = livePosition.side === 'Buy'
    ? markPrice <= entryPrice
    : markPrice >= entryPrice;

  if (armed && returnedToEntry) {
    return {
      type: 'break_even_close',
      triggerPercent,
      pnlPercent,
      entryPrice,
      markPrice,
      closePercent: 100,
    };
  }

  return {
    type: 'none',
    armed,
    pnlPercent,
  };
}

function evaluateTpSl(settings, livePosition) {
  if (!livePosition) return null;
  const pnlPercent = computePnlPercent(livePosition.side, livePosition.avgPrice, livePosition.markPrice);
  if (pnlPercent === null) return null;

  const tpLevels = (settings.takeProfit?.levels || []).filter(level => level.enabled && level.triggerPercent > 0 && level.closePercent > 0)
    .sort((a, b) => a.triggerPercent - b.triggerPercent);

  const reachedTakeProfits = tpLevels.filter(level => pnlPercent >= level.triggerPercent);
  if (reachedTakeProfits.length > 0) {
    const level = reachedTakeProfits[reachedTakeProfits.length - 1];
    return {
      type: 'take_profit',
      triggerPercent: level.triggerPercent,
      closePercent: level.closePercent,
      pnlPercent,
    };
  }

  if (settings.stopLoss?.enabled && settings.stopLoss?.triggerPercent > 0 && pnlPercent <= -Math.abs(settings.stopLoss.triggerPercent)) {
    return {
      type: 'stop_loss',
      triggerPercent: settings.stopLoss.triggerPercent,
      closePercent: 100,
      pnlPercent,
    };
  }

  return {
    type: 'none',
    pnlPercent,
  };
}

function computeCloseQty(positionSize, closePercent, qtyStep) {
  const rawQty = Number(positionSize) * (Number(closePercent) / 100);
  return floorToStep(rawQty, qtyStep).toFixed(decimalPlaces(qtyStep));
}

function resolvePersistence(options, settingsPath, settings) {
  const configuredDbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const candidateDbPaths = [
    options.dbPath,
    process.env.S2_DB_PATH,
    configuredDbPath,
    '/tmp/qs2_review/data/s2.sqlite',
  ].filter(Boolean);

  for (const candidate of candidateDbPaths) {
    const dbPath = path.resolve(candidate);
    const db = createDatabase(dbPath);
    initSchema(db);
    const persistence = buildPersistence(db);
    const hasPriceTicks = persistence.getPriceTicks().length > 0;
    if (hasPriceTicks) {
      return { dbPath, db, persistence };
    }
  }

  const fallbackDbPath = path.resolve(candidateDbPaths[0]);
  const db = createDatabase(fallbackDbPath);
  initSchema(db);
  return { dbPath: fallbackDbPath, db, persistence: buildPersistence(db) };
}

async function executeCloseOrder({ symbol, botId, livePosition, closePercent, exitReason, triggerPercent, credentials, persistence, bybitBaseUrl }) {
  const instrument = await getInstrumentInfo(symbol, { bybitBaseUrl });
  const qtyStep = Number(instrument.lotSizeFilter.qtyStep);
  const requestedQty = closePercent >= 100 ? Number(livePosition.size).toFixed(decimalPlaces(qtyStep)) : computeCloseQty(livePosition.size, closePercent, qtyStep);
  const closeSide = livePosition.side === 'Buy' ? 'Sell' : 'Buy';
  const payload = {
    category: 'linear',
    symbol,
    side: closeSide,
    orderType: 'Market',
    qty: requestedQty,
    positionIdx: 0,
    reduceOnly: true,
  };
  const result = await bybitPrivatePost('/v5/order/create', payload, credentials, { bybitBaseUrl });
  persistence.recordExitEvent({
    created_at: new Date().toISOString(),
    bot_id: botId || 'Bot1',
    symbol,
    exit_reason: exitReason,
    trigger_percent: Number(triggerPercent),
    close_percent: Number(closePercent),
    side: closeSide,
    qty: requestedQty,
    mark_price: Number(livePosition.markPrice || 0),
    response_json: JSON.stringify(result.json),
  });
  return {
    ok: result.ok && result.json.retCode === 0,
    exitReason,
    triggerPercent,
    closePercent,
    side: closeSide,
    qty: requestedQty,
    response: result.json,
  };
}

// Place a native stop-loss at position level via /v5/position/trading-stop.
// Called immediately after an entry order fills. Uses the reference price at entry
// time as a proxy for fill price (market orders fill within ms of submission).
// Position-level SL is automatically cleared by Bybit when the position closes.
async function submitNativeSL({ symbol, side, referencePrice, stopLossPercent, tickSize, credentials, bybitBaseUrl, persistence, botId }) {
  const slPct = Number(stopLossPercent) || 0;
  if (slPct <= 0) {
    return { ok: false, skipped: true, reason: 'no_sl_configured' };
  }

  const tick = Number(tickSize) || 0.0001;
  const prec = decimalPlaces(tick);

  // Round SL away from entry so it is never closer than requested
  const rawSlPrice = side === 'Buy'
    ? referencePrice * (1 - slPct / 100)
    : referencePrice * (1 + slPct / 100);
  const slPrice = side === 'Buy'
    ? (Math.floor(rawSlPrice / tick) * tick).toFixed(prec)
    : (Math.ceil(rawSlPrice / tick) * tick).toFixed(prec);

  const payload = {
    category: 'linear',
    symbol,
    stopLoss: slPrice,
    slTriggerBy: 'LastPrice',
    positionIdx: 0,
  };

  const result = await bybitPrivatePost('/v5/position/trading-stop', payload, credentials, { bybitBaseUrl });
  const ok = result.ok && result.json?.retCode === 0;

  if (persistence?.recordNativeSLEvent) {
    persistence.recordNativeSLEvent({
      created_at: new Date().toISOString(),
      bot_id: botId || 'unknown',
      symbol,
      event_type: 'placed',
      sl_price: slPrice,
      sl_percent: slPct,
      side,
      response_json: JSON.stringify(result.json),
    });
  }

  return { ok, slPrice, slPct, response: result.json };
}

// Move the native position SL to break-even (avgPrice) after BE trigger fires.
async function updateNativeSLToBreakEven({ symbol, avgPrice, side, botId, credentials, bybitBaseUrl, persistence }) {
  const slPrice = String(avgPrice);
  const payload = {
    category: 'linear',
    symbol,
    stopLoss: slPrice,
    slTriggerBy: 'LastPrice',
    positionIdx: 0,
  };

  const result = await bybitPrivatePost('/v5/position/trading-stop', payload, credentials, { bybitBaseUrl });
  const ok = result.ok && result.json?.retCode === 0;

  if (persistence?.recordNativeSLEvent) {
    persistence.recordNativeSLEvent({
      created_at: new Date().toISOString(),
      bot_id: botId || 'unknown',
      symbol,
      event_type: 'be_update',
      sl_price: slPrice,
      sl_percent: 0,
      side: side || null,
      response_json: JSON.stringify(result.json),
    });
  }

  return { ok, slPrice, response: result.json };
}

async function submitEntryOrder({ symbol, side, qty, botId, signal, notionalUsd, credentials, persistence, stageName = 'initial_entry', bybitBaseUrl }) {
  const entryPayload = {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty,
    positionIdx: 0,
  };

  const entryResult = await bybitPrivatePost('/v5/order/create', entryPayload, credentials, { bybitBaseUrl });
  const responseJson = entryResult.json;
  persistence.recordOrderAttempt({
    created_at: new Date().toISOString(),
    signal,
    bot_id: botId,
    symbol,
    side,
    order_type: 'Market',
    qty,
    notional_usd: notionalUsd,
    status: entryResult.ok && responseJson.retCode === 0 ? 'submitted' : 'failed',
    response_json: JSON.stringify({ ...responseJson, stageName }),
  });

  return {
    ok: entryResult.ok && responseJson.retCode === 0,
    response: responseJson,
  };
}

async function executePaperTrade(parsedSignal, options = {}) {
  const settingsPath = options.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const envPath = options.envPath || path.join(__dirname, '..', '..', '.env');
  loadProjectEnv(envPath);

  const botContext = options.botContext || resolveBotContext(parsedSignal.botId, { envPath });
  const apiKey = botContext.credentials.apiKey;
  const apiSecret = botContext.credentials.apiSecret;
  if (!apiKey || !apiSecret) {
    throw new Error(`Missing resolved live credentials for ${parsedSignal.botId}`);
  }

  const { settings } = loadAndValidateSettings(settingsPath);
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);

  const symbol = botContext.symbol;
  const side = sideFromSignal(parsedSignal.signal);
  const bybitBaseUrl = options.bybitBaseUrl || 'https://api.bybit.com';
  const credentials = { apiKey, apiSecret };
  const livePosition = await getLivePosition(symbol, credentials, { bybitBaseUrl });
  let reversal = null;

  if (livePosition && isOppositePosition(parsedSignal.signal, livePosition.side)) {
    const closeResult = await closeOppositePosition({
      symbol,
      parsedSignal,
      livePosition,
      credentials,
      persistence,
      bybitBaseUrl,
    });
    reversal = {
      detected: true,
      existingPositionSide: livePosition.side,
      existingPositionSize: livePosition.size,
      closeFirst: closeResult,
    };
    if (!closeResult.ok) {
      return {
        ok: false,
        symbol,
        side,
        reversal,
        abortedNewEntry: true,
        error: 'Failed to close opposite position before new entry',
      };
    }
  }

  let latestTick = persistence.getPriceTicks().filter(tick => tick.symbol === symbol).slice(-1)[0] || null;
  let sizingPriceSource = 'stored_tick';
  if (!latestTick) {
    latestTick = await getLiveReferencePrice(symbol, { bybitBaseUrl });
    sizingPriceSource = latestTick.source || 'bybit_ticker';
  }

  const instrument = await getInstrumentInfo(symbol, { bybitBaseUrl });
  const lot = instrument.lotSizeFilter;
  const actualAccountBalanceUsd = await getAvailableAccountBalance(credentials, { bybitBaseUrl });
  const effectiveAccountBalanceUsd = Math.min(actualAccountBalanceUsd, 5000);
  const sizing = computeOrderSizing({
    effectiveAccountBalanceUsd,
    accountPercent: settings.positionSizing.accountPercent,
    leverage: settings.positionSizing.leverage,
    referencePrice: latestTick.last_price,
    qtyStep: Number(lot.qtyStep),
    minOrderQty: Number(lot.minOrderQty),
    maxMktOrderQty: Number(lot.maxMktOrderQty),
    minNotionalValue: Number(lot.minNotionalValue),
  });

  const dcaStrategy = resolveDcaStrategy({ profile: botContext.mdx?.profile || 'balanced', bot: botContext.bot });
  const triggerCandle = options.triggerCandle || null;
  const recentCandles = options.recentCandles || [];
  const { classifyTriggerCandle, shouldBlockDcaAdd } = require('./evaluateDcaEntry');
  const impulse = classifyTriggerCandle(triggerCandle, recentCandles, dcaStrategy);
  const delayCandles = impulse.impulsive ? dcaStrategy.addTiming.maxDelayCandles : dcaStrategy.addTiming.minDelayCandles;
  const candleDurationSeconds = options.candleDurationSeconds ?? 60;
  const stageDelaySeconds = delayCandles * candleDurationSeconds;
  const stageOneQty = computeCloseQty(sizing.qty, dcaStrategy.entries.initialEntryPercent, Number(lot.qtyStep));
  const stageTwoQtyRaw = Number(sizing.qty) - Number(stageOneQty);
  const stageTwoQty = stageTwoQtyRaw.toFixed(decimalPlaces(Number(lot.qtyStep)));

  const firstEntry = await submitEntryOrder({
    symbol,
    side,
    qty: stageOneQty,
    botId: parsedSignal.botId,
    signal: parsedSignal.signal,
    notionalUsd: Number(stageOneQty) * Number(latestTick.last_price),
    credentials,
    persistence,
    stageName: 'initial_entry_50',
    bybitBaseUrl,
  });
  persistence.recordStagedEntryEvent({
    created_at: new Date().toISOString(),
    symbol,
    bot_id: parsedSignal.botId,
    stage_name: 'initial_entry_50',
    delay_seconds: 0,
    qty: stageOneQty,
    status: firstEntry.ok ? 'submitted' : 'failed',
    response_json: JSON.stringify(firstEntry.response),
  });

  // Phase 4.5: place native position-level SL immediately after initial entry fills
  let nativeSl = null;
  if (firstEntry.ok) {
    const slPct = botContext.settings?.stopLoss?.triggerPercent || 0;
    const tickSize = instrument.priceFilter?.tickSize || '0.0001';
    nativeSl = await submitNativeSL({
      symbol,
      side,
      referencePrice: Number(latestTick.last_price),
      stopLossPercent: slPct,
      tickSize,
      credentials,
      bybitBaseUrl,
      persistence,
      botId: parsedSignal.botId,
    });
  }

  let delayedEntry = null;
  const tradeId = firstEntry.ok ? `${symbol}:${side}:${Date.now()}` : null;

  // Phase 6: write analysis queue job with 100 1H candles immediately after entry
  let analysisJob = null;
  if (tradeId) {
    try {
      const candles = await fetchKlineCandles(symbol, { bybitBaseUrl });
      analysisJob = writeAnalysisQueueJob({
        botId: parsedSignal.botId,
        symbol,
        tradeId,
        side,
        signal: parsedSignal.signal,
        entryPrice: Number(latestTick.last_price),
        candles,
      });
    } catch (err) {
      analysisJob = { ok: false, error: err.message };
    }
  }

  if (firstEntry.ok && !dcaStrategy.enabled) {
    persistence.recordDcaEvent({
      created_at: new Date().toISOString(),
      bot_id: parsedSignal.botId,
      symbol,
      event_type: 'dca_add_skipped',
      candle_delay: delayCandles,
      status: 'skipped',
      details_json: JSON.stringify({
        trade_id: tradeId,
        dca_enabled: false,
        dca_policy_version: 'selective-dca-default-off',
        decision: 'skipped',
        reason: 'policy_disabled',
      }),
    });
    delayedEntry = {
      ok: false,
      skipped: true,
      reasons: ['policy_disabled'],
      qty: stageTwoQty,
    };
  } else if (firstEntry.ok) {
    persistence.recordDcaEvent({
      created_at: new Date().toISOString(),
      bot_id: parsedSignal.botId,
      symbol,
      event_type: 'dca_add_scheduled',
      candle_delay: delayCandles,
      status: 'scheduled',
      details_json: JSON.stringify({
        trade_id: tradeId,
        impulse,
        stageDelaySeconds,
        qty: stageTwoQty,
        dca_enabled: true,
        dca_policy_version: 'selective-dca-default-off',
      }),
    });
    await new Promise(resolve => setTimeout(resolve, stageDelaySeconds * 1000));
    const guardState = shouldBlockDcaAdd({
      breakEvenArmed: dcaStrategy.guards.blockIfBreakEvenArmed && hasBreakEvenArmed(persistence, symbol),
      takeProfitStarted: dcaStrategy.guards.blockIfTakeProfitStarted && (persistence.getExitEvents ? persistence.getExitEvents().some(event => event.symbol === symbol && event.exit_reason === 'take_profit') : false),
      oppositeSignal: false,
      regimeInvalid: false,
    });
    if (guardState.blocked) {
      persistence.recordStagedEntryEvent({
        created_at: new Date().toISOString(),
        symbol,
        bot_id: parsedSignal.botId,
        stage_name: 'dca_add_entry',
        delay_seconds: stageDelaySeconds,
        qty: stageTwoQty,
        status: `skipped_${guardState.reasons.join('_')}`,
        response_json: JSON.stringify({ skipped: true, reasons: guardState.reasons }),
      });
      persistence.recordDcaEvent({
        created_at: new Date().toISOString(),
        bot_id: parsedSignal.botId,
        symbol,
        event_type: 'dca_add_skipped',
        candle_delay: delayCandles,
        status: 'skipped',
        details_json: JSON.stringify({
          trade_id: tradeId,
          dca_enabled: true,
          dca_policy_version: 'selective-dca-default-off',
          decision: 'skipped',
          reasons: guardState.reasons,
          qty: stageTwoQty,
        }),
      });
      delayedEntry = {
        ok: false,
        skipped: true,
        reasons: guardState.reasons,
        qty: stageTwoQty,
      };
    } else {
      const secondEntry = await submitEntryOrder({
        symbol,
        side,
        qty: stageTwoQty,
        botId: parsedSignal.botId,
        signal: `${parsedSignal.signal}_DCA_ADD`,
        notionalUsd: Number(stageTwoQty) * Number(latestTick.last_price),
        credentials,
        persistence,
        stageName: 'dca_add_entry',
        bybitBaseUrl,
      });
      persistence.recordStagedEntryEvent({
        created_at: new Date().toISOString(),
        symbol,
        bot_id: parsedSignal.botId,
        stage_name: 'dca_add_entry',
        delay_seconds: stageDelaySeconds,
        qty: stageTwoQty,
        status: secondEntry.ok ? 'submitted' : 'failed',
        response_json: JSON.stringify(secondEntry.response),
      });
      persistence.recordDcaEvent({
        created_at: new Date().toISOString(),
        bot_id: parsedSignal.botId,
        symbol,
        event_type: 'dca_add_executed',
        candle_delay: delayCandles,
        status: secondEntry.ok ? 'executed' : 'failed',
        details_json: JSON.stringify({
          trade_id: tradeId,
          dca_enabled: true,
          dca_policy_version: 'selective-dca-default-off',
          decision: secondEntry.ok ? 'executed' : 'failed',
          impulse,
          qty: stageTwoQty,
          response: secondEntry.response,
        }),
      });
      delayedEntry = secondEntry;
    }
  }

  return {
    ok: firstEntry.ok,
    symbol,
    side,
    sizing,
    sizingPriceSource,
    actualAccountBalanceUsd,
    effectiveAccountBalanceUsd,
    instrumentLotSize: lot,
    reversal,
    nativeSl,
    analysisJob,
    stagedEntry: {
      enabled: true,
      strategy: dcaStrategy.mode,
      impulse,
      delayCandles,
      stageDelaySeconds,
      firstEntryQty: stageOneQty,
      delayedEntryQty: stageTwoQty,
      delayedEntry,
    },
    dbPath,
    response: firstEntry.response,
  };
}

async function manageBreakEven(options = {}) {
  const envPath = options.envPath || '/home/ubuntu/.openclaw/.env';
  const botId = options.botId || 'Bot1';
  const botContext = options.botContext || resolveBotContext(botId, { envPath });
  const botSettingsContext = options.botSettingsContext || resolveBotSettings(botId, {
    registryPath: options.registryPath,
  });
  const settingsPath = botSettingsContext.settingsPath || options.settingsPath || botContext.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  loadProjectEnv(envPath);

  const apiKey = botContext.credentials.apiKey;
  const apiSecret = botContext.credentials.apiSecret;
  if (!apiKey || !apiSecret) {
    throw new Error(`Missing resolved live credentials for ${botContext.botId}`);
  }

  const settings = botSettingsContext.settings;
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);
  const symbol = botContext.symbol;
  const bybitBaseUrl = options.bybitBaseUrl || 'https://api.bybit.com';
  const credentials = { apiKey, apiSecret };
  const livePosition = options.livePositionOverride || await getLivePosition(symbol, credentials, { bybitBaseUrl });
  if (!livePosition) {
    return { ok: true, action: 'no_position', dbPath };
  }

  const decision = shouldTriggerBreakEven(settings, livePosition, persistence);
  if (!decision || decision.type === 'none') {
    return { ok: true, action: 'hold', dbPath, decision };
  }

  const tradeId = getTradeId(livePosition, symbol);

  if (decision.type === 'arm_break_even') {
    const actionKey = 'BE_ARM';
    if (hasTradeActionExecuted(persistence, tradeId, actionKey)) {
      return { ok: true, action: 'armed_skip_duplicate', dbPath, decision, tradeId };
    }
    persistence.recordBreakEvenEvent({
      created_at: new Date().toISOString(),
      bot_id: botContext.botId,
      symbol,
      event_type: 'armed',
      trigger_percent: Number(decision.triggerPercent),
      side: livePosition.side,
      entry_price: Number(livePosition.avgPrice || 0),
      mark_price: Number(livePosition.markPrice || 0),
      response_json: JSON.stringify({ action: 'armed', trade_id: tradeId }),
    });
    recordTradeAction(persistence, {
      created_at: new Date().toISOString(),
      trade_id: tradeId,
      bot_id: botContext.botId,
      symbol,
      action_type: 'break_even',
      action_key: actionKey,
      state: 'be_armed',
      level_name: 'BE',
      details_json: JSON.stringify({ trigger_percent: Number(decision.triggerPercent) }),
    });

    // Phase 4.5: move native SL to entry price (break-even) when BE arms
    const beSlResult = await updateNativeSLToBreakEven({
      symbol,
      avgPrice: livePosition.avgPrice,
      side: livePosition.side,
      botId: botContext.botId,
      credentials,
      bybitBaseUrl,
      persistence,
    });

    return { ok: true, action: 'armed', dbPath, decision, tradeId, beSlResult };
  }

  const closeActionKey = 'BE_CLOSE';
  if (hasTradeActionExecuted(persistence, tradeId, closeActionKey)) {
    return { ok: true, action: 'break_even_close_skip_duplicate', dbPath, decision, tradeId };
  }

  const closeResult = await executeCloseOrder({
    symbol,
    botId: botContext.botId,
    livePosition,
    closePercent: 100,
    exitReason: 'break_even',
    triggerPercent: decision.triggerPercent,
    credentials,
    persistence,
    bybitBaseUrl,
  });
  persistence.recordBreakEvenEvent({
    created_at: new Date().toISOString(),
    bot_id: botContext.botId,
    symbol,
    event_type: 'closed_at_break_even',
    trigger_percent: Number(decision.triggerPercent),
    side: livePosition.side,
    entry_price: Number(livePosition.avgPrice || 0),
    mark_price: Number(livePosition.markPrice || 0),
    response_json: JSON.stringify({ ...closeResult.response, trade_id: tradeId }),
  });
  recordTradeAction(persistence, {
    created_at: new Date().toISOString(),
    trade_id: tradeId,
    bot_id: botContext.botId,
    symbol,
    action_type: 'break_even',
    action_key: closeActionKey,
    state: 'closed',
    level_name: 'BE',
    details_json: JSON.stringify({ trigger_percent: Number(decision.triggerPercent) }),
  });

  return {
    ok: closeResult.ok,
    action: 'break_even_close',
    dbPath,
    decision,
    closeResult,
    tradeId,
  };
}

async function manageTpSl(options = {}) {
  const envPath = options.envPath || '/home/ubuntu/.openclaw/.env';
  const botId = options.botId || 'Bot1';
  const botContext = options.botContext || resolveBotContext(botId, { envPath });
  const botSettingsContext = options.botSettingsContext || resolveBotSettings(botId, {
    registryPath: options.registryPath,
  });
  const settingsPath = botSettingsContext.settingsPath || options.settingsPath || botContext.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  loadProjectEnv(envPath);

  const apiKey = botContext.credentials.apiKey;
  const apiSecret = botContext.credentials.apiSecret;
  if (!apiKey || !apiSecret) {
    throw new Error(`Missing resolved live credentials for ${botContext.botId}`);
  }

  const settings = botSettingsContext.settings;
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);
  const symbol = botContext.symbol;
  const bybitBaseUrl = options.bybitBaseUrl || 'https://api.bybit.com';
  const credentials = { apiKey, apiSecret };
  const livePosition = options.livePositionOverride || await getLivePosition(symbol, credentials, { bybitBaseUrl });
  if (!livePosition) {
    return { ok: true, action: 'no_position', dbPath };
  }

  const decision = evaluateTpSl(settings, livePosition);
  if (!decision || decision.type === 'none') {
    return { ok: true, action: 'hold', dbPath, decision };
  }

  const tradeId = getTradeId(livePosition, symbol);
  const levelName = decision.type === 'take_profit' ? `TP_${decision.triggerPercent}_${decision.closePercent}` : 'STOP_LOSS';
  const actionKey = `${decision.type}:${levelName}`;
  if (hasTradeActionExecuted(persistence, tradeId, actionKey)) {
    recordTradeAction(persistence, {
      created_at: new Date().toISOString(),
      trade_id: tradeId,
      bot_id: botContext.botId,
      symbol,
      action_type: decision.type,
      action_key: `${actionKey}:SKIP`,
      state: 'skipped',
      level_name: levelName,
      details_json: JSON.stringify({ skip_reason: 'already_completed' }),
    });
    return {
      ok: true,
      action: `${decision.type}_skip_duplicate`,
      dbPath,
      decision,
      tradeId,
    };
  }

  const closeResult = await executeCloseOrder({
    symbol,
    botId: botContext.botId,
    livePosition,
    closePercent: decision.closePercent,
    exitReason: decision.type,
    triggerPercent: decision.triggerPercent,
    credentials,
    persistence,
    bybitBaseUrl,
  });

  recordTradeAction(persistence, {
    created_at: new Date().toISOString(),
    trade_id: tradeId,
    bot_id: botContext.botId,
    symbol,
    action_type: decision.type,
    action_key: actionKey,
    state: decision.type === 'take_profit' ? 'tp_done' : 'closed',
    level_name: levelName,
    details_json: JSON.stringify({
      trigger_percent: decision.triggerPercent,
      close_percent: decision.closePercent,
      executed: closeResult.ok,
    }),
  });

  return {
    ok: closeResult.ok,
    action: decision.type,
    dbPath,
    decision,
    closeResult,
    tradeId,
  };
}

module.exports = {
  executePaperTrade,
  manageTpSl,
  manageBreakEven,
  computeOrderSizing,
  computePnlPercent,
  computeCloseQty,
  evaluateTpSl,
  shouldTriggerBreakEven,
  getLivePosition,
  isOppositePosition,
  closeOppositePosition,
};
