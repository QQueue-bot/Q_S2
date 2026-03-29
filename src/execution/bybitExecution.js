const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { loadAndValidateSettings } = require('../config/validateSettings');
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

async function executePaperTrade(parsedSignal, options = {}) {
  const settingsPath = options.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const envPath = options.envPath || path.join(__dirname, '..', '..', '.env');
  loadProjectEnv(envPath);

  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Missing BYBIT_TESTNET_API_KEY or BYBIT_TESTNET_API_SECRET in project .env');
  }

  const { settings } = loadAndValidateSettings(settingsPath);
  const { dbPath, persistence } = resolvePersistence(options, settingsPath, settings);

  const symbol = settings.trading.defaultSymbol;
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

  const entryPayload = {
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: sizing.qty,
    positionIdx: 0,
  };

  const entryResult = await bybitPrivatePost('/v5/order/create', entryPayload, credentials);
  const responseJson = entryResult.json;
  persistence.recordOrderAttempt({
    created_at: new Date().toISOString(),
    signal: parsedSignal.signal,
    bot_id: parsedSignal.botId,
    symbol,
    side,
    order_type: 'Market',
    qty: sizing.qty,
    notional_usd: sizing.notionalUsd,
    status: entryResult.ok && responseJson.retCode === 0 ? 'submitted' : 'failed',
    response_json: JSON.stringify(responseJson),
  });

  return {
    ok: entryResult.ok && responseJson.retCode === 0,
    symbol,
    side,
    sizing,
    instrumentLotSize: lot,
    reversal,
    dbPath,
    response: responseJson,
  };
}

module.exports = {
  executePaperTrade,
  computeOrderSizing,
  getLivePosition,
  isOppositePosition,
  closeOppositePosition,
};
