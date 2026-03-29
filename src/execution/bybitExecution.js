const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
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

function computeOrderSizing({ maxMarginUsd, accountPercent, leverage, referencePrice }) {
  const marginUsd = maxMarginUsd * (accountPercent / 100);
  const notionalUsd = marginUsd * leverage;
  const qty = notionalUsd / referencePrice;
  return {
    marginUsd,
    notionalUsd,
    qty: qty.toFixed(6),
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

  const sizing = computeOrderSizing({
    maxMarginUsd: 5000,
    accountPercent: settings.positionSizing.accountPercent,
    leverage: settings.positionSizing.leverage,
    referencePrice: latestTick.last_price,
  });

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const body = JSON.stringify({
    category: 'linear',
    symbol,
    side,
    orderType: 'Market',
    qty: sizing.qty,
    marketUnit: 'baseCoin',
    isLeverage: 1,
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
    response: responseJson,
  };
}

module.exports = {
  executePaperTrade,
  computeOrderSizing,
};
