const WebSocket = require('ws');
const path = require('path');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

function createBybitPriceMonitor(options = {}) {
  const settingsPath = options.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const { settings } = loadAndValidateSettings(settingsPath);
  const symbol = settings.trading.defaultSymbol;
  const dbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);
  const logger = options.logger || console;
  const wsUrl = options.wsUrl || 'wss://stream-testnet.bybit.com/v5/public/linear';
  const sampleLimit = options.sampleLimit || 3;
  const timeoutMs = options.timeoutMs || 15000;
  const priceMonitoring = settings.priceMonitoring || { logEveryTick: true, samplingIntervalMs: 0 };
  let samples = 0;
  let lastStoredAt = 0;
  let settled = false;
  let latestTicker = null;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const finish = (fn, payload) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch (_) {}
      fn(payload);
    };

    const timer = setTimeout(() => {
      finish(resolve, {
        ok: samples > 0,
        symbol,
        samples,
        timedOut: true,
        priceTicks: persistence.getPriceTicks(),
      });
    }, timeoutMs);

    ws.on('open', () => {
      logger.info('Bybit price monitor connected', { symbol, wsUrl });
      ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${symbol}`] }));
    });

    ws.on('message', (raw) => {
      const text = raw.toString('utf8');
      let message;
      try {
        message = JSON.parse(text);
      } catch (error) {
        logger.warn('Failed to parse price message', { error: error.message, text });
        return;
      }

      if (!message.topic || !message.data) {
        return;
      }

      const incoming = Array.isArray(message.data) ? message.data[0] : message.data;
      if (!incoming || incoming.symbol !== symbol) {
        return;
      }

      latestTicker = { ...(latestTicker || {}), ...incoming };
      const candidatePrice = latestTicker.lastPrice || latestTicker.markPrice || latestTicker.indexPrice;
      const parsedPrice = candidatePrice ? Number(candidatePrice) : null;
      if (!parsedPrice) return;

      const now = Date.now();
      const shouldStore = priceMonitoring.logEveryTick || !priceMonitoring.samplingIntervalMs || (now - lastStoredAt >= priceMonitoring.samplingIntervalMs);
      if (shouldStore) {
        const receivedAt = new Date(now).toISOString();
        persistence.recordPriceTick({
          received_at: receivedAt,
          symbol,
          last_price: parsedPrice,
          source: 'bybit_testnet',
        });
        lastStoredAt = now;
        samples += 1;
        logger.info('Stored price tick', { symbol, parsedPrice, receivedAt, samples });
      }

      if (samples >= sampleLimit) {
        clearTimeout(timer);
        finish(resolve, {
          ok: true,
          symbol,
          samples,
          timedOut: false,
          priceTicks: persistence.getPriceTicks(),
        });
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      finish(reject, error);
    });

    ws.on('close', () => {
      logger.info('Bybit price monitor closed', { symbol });
    });
  });
}

module.exports = {
  createBybitPriceMonitor,
};
