const http = require('http');
const { URL } = require('url');
const { parseSignalString } = require('../signals/parseSignal');
const { loadAndValidateSettings } = require('../config/validateSettings');

function createWebhookServer(options = {}) {
  const {
    host = '127.0.0.1',
    port = 3001,
    path = '/webhook/tradingview',
    secret = process.env.WEBHOOK_SECRET || '',
    settingsPath = options.settingsPath,
    logger = console,
  } = options;

  function json(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
  }

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${host}:${port}`);

    if (req.method !== 'POST') {
      return json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    if (requestUrl.pathname !== path) {
      return json(res, 404, { ok: false, error: 'Not found' });
    }

    const providedSecret = requestUrl.searchParams.get('secret');
    if (!secret || providedSecret !== secret) {
      logger.warn('Webhook auth failure', { path: requestUrl.pathname, providedSecret: providedSecret ? '[redacted]' : null });
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8').trim();
      logger.info('Webhook raw body received', { rawBody });

      let signalInput = rawBody;
      if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
        try {
          const parsedBody = JSON.parse(rawBody || '{}');
          if (typeof parsedBody.signal === 'string') {
            signalInput = parsedBody.signal;
          }
        } catch (error) {
          logger.warn('Webhook JSON parse failure', { error: error.message, rawBody });
          return json(res, 400, { ok: false, error: 'Invalid JSON body' });
        }
      }

      try {
        const { settings, validation } = loadAndValidateSettings(settingsPath);
        const allowedBots = ['Bot1'];
        const parsedSignal = parseSignalString(signalInput, { allowedBots });

        logger.info('Webhook parsed signal', { parsedSignal });

        return json(res, 200, {
          ok: true,
          validation,
          parsedSignal,
          tradingEnabled: settings.trading.enabled,
        });
      } catch (error) {
        logger.warn('Webhook signal parse failure', { error: error.message, rawBody: signalInput });
        return json(res, 400, { ok: false, error: error.message });
      }
    });
  });

  return {
    host,
    port,
    path,
    start() {
      return new Promise(resolve => {
        server.listen(port, host, () => {
          logger.info('Webhook server listening', { host, port, path });
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

module.exports = {
  createWebhookServer,
};
