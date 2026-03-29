const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { resolveBotContext } = require('../config/resolveBotContext');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

const BYBIT_DEMO_BASE_URL = 'https://api-demo.bybit.com';

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

function computeOrderSizing({ maxMarginUsd, accountPercent, leverage, referencePrice, qtyStep, minOrderQty, maxMktOrderQty, minNotionalValue }) {
  const marginUsd = maxMarginUsd * (accountPercent / 100);
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

async function getInstrumentInfo(symbol) {
  const response = await axios.get(`${BYBIT_DEMO_BASE_URL}/v5/market/instruments-info?category=linear&symbol=${symbol}`);
  const instrument = response.data?.result?.list?.[0];
  if (!instrument) {
    throw new Error(`Instrument info not found for ${symbol}`);
  }
  return instrument;
}

function signRequest({ apiKey, apiSecret, timestamp, recvWindow, query = '', body = '' }) {
  const payloadToSign = timestamp + apiKey + recvWindow + (query || body);
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
  const response = await axios.get(`${BYBIT_DEMO_BASE_URL}${pathname}?${query}`, {
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

async function bybitPrivatePost(pathname, bodyObject, credentials) {
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
  const response = await fetch(`${BYBIT_DEMO_BASE_URL}${pathname}`, {
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

async function getLivePosition(symbol, credentials) {
  const response = await bybitPrivateGet('/v5/position/list', `category=linear&symbol=${symbol}`, credentials);
  const positions = response?.result?.list || [];
  return positions.find(position => Number(position.size || 0) > 0) || null;
}

function isOppositePosition(signal, positionSide) {
  return (signal === 'ENTER_LONG' && positionSide === 'Sell') || (signal === 'ENTER_SHORT' && positionSide === 'Buy');
}

async function closeOppositePosition({ symbol, parsedSignal, livePosition, credentials, persistence }) {
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

  const result = await bybitPrivatePost('/v5/order/create', closePayload, credentials);
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

async function executeCloseOrder({ symbol, botId, livePosition, closePercent, exitReason, triggerPercent, credentials, persistence }) {
  const instrument = await getInstrumentInfo(symbol);
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
  const result = await bybitPrivatePost('/v5/order/create', payload, credentials);
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

async function submitEntryOrder({ symbol, side, qty, botId, signal, notionalUsd, credentials, persistence, stageName = 'initial_entry' }) {
  const entryPayload = {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty,
    positionIdx: 0,
  };

  const entryResult = await bybitPrivatePost('/v5/order/create', entryPayload, credentials);
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

  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing BYBIT_TESTNET_API_KEY or BYBIT_TESTNET_API_SECRET in project .env');
  }

  const botContext = options.botContext || resolveBotContext(parsedSignal.botId);
  const { settings } = loadAndValidateSettings(settingsPath);
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);

  const symbol = botContext.symbol;
  const side = sideFromSignal(parsedSignal.signal);
  const credentials = { apiKey, apiSecret };
  const livePosition = await getLivePosition(symbol, credentials);
  let reversal = null;

  if (livePosition && isOppositePosition(parsedSignal.signal, livePosition.side)) {
    const closeResult = await closeOppositePosition({
      symbol,
      parsedSignal,
      livePosition,
      credentials,
      persistence,
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

  const latestTick = persistence.getPriceTicks().slice(-1)[0];
  if (!latestTick) {
    throw new Error('No stored price tick available for sizing');
  }

  const instrument = await getInstrumentInfo(symbol);
  const lot = instrument.lotSizeFilter;
  const sizing = computeOrderSizing({
    maxMarginUsd: 5000,
    accountPercent: settings.positionSizing.accountPercent,
    leverage: settings.positionSizing.leverage,
    referencePrice: latestTick.last_price,
    qtyStep: Number(lot.qtyStep),
    minOrderQty: Number(lot.minOrderQty),
    maxMktOrderQty: Number(lot.maxMktOrderQty),
    minNotionalValue: Number(lot.minNotionalValue),
  });

  const stageDelaySeconds = options.stageDelaySeconds ?? 60;
  const stageOneQty = computeCloseQty(sizing.qty, 50, Number(lot.qtyStep));
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
    await new Promise(resolve => setTimeout(resolve, stageDelaySeconds * 1000));
    const beArmed = hasBreakEvenArmed(persistence, symbol);
    if (beArmed) {
      persistence.recordStagedEntryEvent({
        created_at: new Date().toISOString(),
        symbol,
        bot_id: parsedSignal.botId,
        stage_name: 'delayed_entry_50',
        delay_seconds: stageDelaySeconds,
        qty: stageTwoQty,
        status: 'skipped_break_even_armed',
        response_json: JSON.stringify({ skipped: true, reason: 'break_even_armed' }),
      });
      delayedEntry = {
        ok: false,
        skipped: true,
        reason: 'break_even_armed',
        qty: stageTwoQty,
      };
    } else {
      const secondEntry = await submitEntryOrder({
        symbol,
        side,
        qty: stageTwoQty,
        botId: parsedSignal.botId,
        signal: `${parsedSignal.signal}_STAGE_2`,
        notionalUsd: Number(stageTwoQty) * Number(latestTick.last_price),
        credentials,
        persistence,
        stageName: 'delayed_entry_50',
      });
      persistence.recordStagedEntryEvent({
        created_at: new Date().toISOString(),
        symbol,
        bot_id: parsedSignal.botId,
        stage_name: 'delayed_entry_50',
        delay_seconds: stageDelaySeconds,
        qty: stageTwoQty,
        status: secondEntry.ok ? 'submitted' : 'failed',
        response_json: JSON.stringify(secondEntry.response),
      });
      delayedEntry = secondEntry;
    }
  }

  return {
    ok: firstEntry.ok,
    symbol,
    side,
    sizing,
    instrumentLotSize: lot,
    reversal,
    stagedEntry: {
      enabled: true,
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
  const botContext = options.botContext || resolveBotContext(options.botId || 'Bot1');
  const settingsPath = options.settingsPath || botContext.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const envPath = options.envPath || path.join(__dirname, '..', '..', '.env');
  loadProjectEnv(envPath);

  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing BYBIT_TESTNET_API_KEY or BYBIT_TESTNET_API_SECRET in project .env');
  }

  const { settings } = loadAndValidateSettings(settingsPath);
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);
  const symbol = botContext.symbol;
  const credentials = { apiKey, apiSecret };
  const livePosition = options.livePositionOverride || await getLivePosition(symbol, credentials);
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
  const botContext = options.botContext || resolveBotContext(options.botId || 'Bot1');
  const settingsPath = options.settingsPath || botContext.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const envPath = options.envPath || path.join(__dirname, '..', '..', '.env');
  loadProjectEnv(envPath);

  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing BYBIT_TESTNET_API_KEY or BYBIT_TESTNET_API_SECRET in project .env');
  }

  const { settings } = loadAndValidateSettings(settingsPath);
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);
  const symbol = botContext.symbol;
  const credentials = { apiKey, apiSecret };
  const livePosition = options.livePositionOverride || await getLivePosition(symbol, credentials);
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
