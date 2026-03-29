const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

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
  const response = await axios.get(`https://api-demo.bybit.com/v5/market/instruments-info?category=linear&symbol=${symbol}`);
  const instrument = response.data?.result?.list?.[0];
  if (!instrument) {
    throw new Error(`Instrument info not found for ${symbol}`);
  }
  return instrument;
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
  const dbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const symbol = settings.trading.defaultSymbol;
  const side = sideFromSignal(parsedSignal.signal);
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

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const body = JSON.stringify({
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: sizing.qty,
    positionIdx: 0,
  });

  const payloadToSign = timestamp + apiKey + recvWindow + body;
  const signature = crypto.createHmac('sha256', apiSecret).update(payloadToSign).digest('hex');

  const response = await fetch('https://api-demo.bybit.com/v5/order/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    body,
  });

  const responseJson = await response.json();
  persistence.recordOrderAttempt({
    created_at: new Date().toISOString(),
    signal: parsedSignal.signal,
    bot_id: parsedSignal.botId,
    symbol,
    side,
    order_type: 'Market',
    qty: sizing.qty,
    notional_usd: sizing.notionalUsd,
    status: response.ok && responseJson.retCode === 0 ? 'submitted' : 'failed',
    response_json: JSON.stringify(responseJson),
  });

  return {
    ok: response.ok && responseJson.retCode === 0,
    symbol,
    side,
    sizing,
    instrumentLotSize: lot,
    response: responseJson,
  };
}

module.exports = {
  executePaperTrade,
  computeOrderSizing,
};
