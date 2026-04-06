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

function hasBreakEvenArmed(persistence, symbol) {
  const events = persistence.getBreakEvenEvents ? persistence.getBreakEvenEvents() : [];
  return events.some(event => event.symbol === symbol && event.event_type === 'armed');
}

function shouldTriggerBreakEven(settings, livePosition, persistence) {
  if (!livePosition || !settings.breakEven?.enabled || settings.breakEven.triggerPercent <= 0) {
    return { type: 'none' };
  }

  const pnlPercent = computePnlPercent(livePosition.side, livePosition.avgPrice, livePosition.markPrice);
  if (pnlPercent === null) {
    return { type: 'none' };
  }

  const armed = hasBreakEvenArmed(persistence, livePosition.symbol);
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

  const dcaStrategy = resolveDcaStrategy({ profile: botContext.mdx?.profile || 'balanced' });
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

  let delayedEntry = null;
  if (firstEntry.ok) {
    persistence.recordDcaEvent({
      created_at: new Date().toISOString(),
      bot_id: parsedSignal.botId,
      symbol,
      event_type: 'dca_add_scheduled',
      candle_delay: delayCandles,
      status: 'scheduled',
      details_json: JSON.stringify({ impulse, stageDelaySeconds, qty: stageTwoQty }),
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
        details_json: JSON.stringify({ reasons: guardState.reasons, qty: stageTwoQty }),
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
        details_json: JSON.stringify({ impulse, qty: stageTwoQty, response: secondEntry.response }),
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

  if (decision.type === 'arm_break_even') {
    persistence.recordBreakEvenEvent({
      created_at: new Date().toISOString(),
      bot_id: botContext.botId,
      symbol,
      event_type: 'armed',
      trigger_percent: Number(decision.triggerPercent),
      side: livePosition.side,
      entry_price: Number(livePosition.avgPrice || 0),
      mark_price: Number(livePosition.markPrice || 0),
      response_json: JSON.stringify({ action: 'armed' }),
    });
    return { ok: true, action: 'armed', dbPath, decision };
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
    response_json: JSON.stringify(closeResult.response),
  });

  return {
    ok: closeResult.ok,
    action: 'break_even_close',
    dbPath,
    decision,
    closeResult,
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

  return {
    ok: closeResult.ok,
    action: decision.type,
    dbPath,
    decision,
    closeResult,
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
