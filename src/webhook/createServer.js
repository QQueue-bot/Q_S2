const http = require('http');
const { URL } = require('url');
const path = require('path');
const { parseSignalString } = require('../signals/parseSignal');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { resolveBotContext } = require('../config/resolveBotContext');
const { createRiskEngine } = require('../risk/evaluateSignal');
const { executePaperTrade, executeSignalClose } = require('../execution/bybitExecution');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
const { computeS3Score } = require('../scoring/computeS3Score');
const { tryDispatchS21 } = require('../s21/webhookHandler');

function isHeartbeatSignal(input) {
  return typeof input === 'string' && input.trim().toUpperCase() === 'S2_HEARTBEAT';
}

function createWebhookServer(options = {}) {
  const {
    host = '127.0.0.1',
    port = 3001,
    path: webhookPath = '/webhook/tradingview',
    secret = process.env.WEBHOOK_SECRET || '',
    settingsPath = options.settingsPath,
    logger = console,
  } = options;

  function json(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
  }

  const dbPath = process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite';
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${host}:${port}`);

    if (req.method !== 'POST') {
      return json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    if (requestUrl.pathname !== webhookPath) {
      return json(res, 404, { ok: false, error: 'Not found' });
    }

    const providedSecret = requestUrl.searchParams.get('secret');
    if (!secret || providedSecret !== secret) {
      persistence.recordWebhookEvent({
        received_at: new Date().toISOString(),
        request_path: requestUrl.pathname,
        method: req.method,
        auth_ok: 0,
        parse_ok: 0,
        raw_body: null,
        error_message: 'Unauthorized',
      });
      logger.warn('Webhook auth failure', { path: requestUrl.pathname, providedSecret: providedSecret ? '[redacted]' : null });
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
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
          persistence.recordWebhookEvent({
            received_at: new Date().toISOString(),
            request_path: requestUrl.pathname,
            method: req.method,
            auth_ok: 1,
            parse_ok: 0,
            raw_body: rawBody,
            error_message: 'Invalid JSON body',
          });
          logger.warn('Webhook JSON parse failure', { error: error.message, rawBody });
          return json(res, 400, { ok: false, error: 'Invalid JSON body' });
        }
      }

      try {
        const { settings, validation } = loadAndValidateSettings(settingsPath);

        if (isHeartbeatSignal(signalInput)) {
          const heartbeatAt = new Date().toISOString();
          persistence.recordWebhookEvent({
            received_at: heartbeatAt,
            request_path: requestUrl.pathname,
            method: req.method,
            auth_ok: 1,
            parse_ok: 1,
            raw_body: signalInput,
            error_message: null,
          });
          persistence.recordHeartbeatEvent({
            received_at: heartbeatAt,
            source: 'tradingview',
            raw_input: signalInput,
            status: 'received',
            details_json: JSON.stringify({ requestPath: requestUrl.pathname }),
          });
          return json(res, 200, {
            ok: true,
            heartbeat: true,
            receivedAt: heartbeatAt,
            staleAfterMinutes: 360,
            executionQueued: false,
          });
        }

        // ── S2.1 dispatch (PR 4) ────────────────────────────────────────────
        // Try the S2.1 engine BEFORE the legacy parse. tryDispatchS21 handles
        // its own forensic logging into s2_1_signals — if it returns
        // handled=true the legacy path is fully bypassed and the webhook
        // response reflects S2.1's verdict. Errors inside this branch must
        // NEVER cascade into legacy: any throw is swallowed, logged, and
        // legacy fall-through proceeds as today.
        try {
          const s21Result = await tryDispatchS21({
            rawSignal: signalInput,
            persistence,
            logger,
            options: { bybitBaseUrl: process.env.BYBIT_BASE_URL },
          });
          if (s21Result.handled) {
            persistence.recordWebhookEvent({
              received_at: new Date().toISOString(),
              request_path: requestUrl.pathname,
              method: req.method,
              auth_ok: 1,
              parse_ok: s21Result.ok ? 1 : 1,  // S2.1 parsed it; ok=false is a rejection not a parse error
              raw_body: signalInput,
              error_message: s21Result.ok ? null : `S2.1 rejected: ${s21Result.reject_reason}`,
            });
            return json(res, 200, {
              ok: s21Result.ok,
              engine: 's2_1',
              signalId: s21Result.signalId,
              tradeId: s21Result.tradeId || null,
              rejectReason: s21Result.reject_reason || null,
            });
          }
        } catch (s21Err) {
          // Defensive: a bug in the S2.1 branch must not kill legacy dispatch.
          logger.warn('[s2.1] dispatch crashed — falling through to legacy', { error: s21Err.message, stack: s21Err.stack });
        }

        const bootContext = resolveBotContext('Bot1');
        const parsedSignal = parseSignalString(signalInput, { allowedBots: bootContext.allowedBots });
        persistence.recordWebhookEvent({
          received_at: parsedSignal.receivedAt,
          request_path: requestUrl.pathname,
          method: req.method,
          auth_ok: 1,
          parse_ok: 1,
          raw_body: signalInput,
          error_message: null,
        });
        persistence.recordNormalizedSignal({
          received_at: parsedSignal.receivedAt,
          signal: parsedSignal.signal,
          bot_id: parsedSignal.botId,
          raw_input: parsedSignal.raw,
        });
        const botContext = resolveBotContext(parsedSignal.botId);
        logger.info('Webhook parsed signal', { parsedSignal, botContext: { botId: botContext.botId, symbol: botContext.symbol, settingsPath: botContext.settingsPath } });

        const riskEngine = createRiskEngine({ settingsPath: botContext.settingsPath, botContext, settings: botContext.settings });
        const risk = riskEngine.evaluate(parsedSignal);
        logger.info('Risk evaluation result', { risk });

        const isExitSignal = parsedSignal.signal === 'EXIT_LONG' || parsedSignal.signal === 'EXIT_SHORT';

        if (risk.allowed && risk.actionable) {
          setImmediate(async () => {
            try {
              const execution = await executePaperTrade(parsedSignal, {
                settingsPath: botContext.settingsPath,
                botContext,
                envPath: '/home/ubuntu/.openclaw/.env',
              });
              logger.info('Execution result', { execution });
            } catch (executionError) {
              logger.warn('Background execution failure', {
                error: executionError.message,
                parsedSignal,
              });
            }
          });

          // S3 shadow scoring — fire-and-forget, runs concurrently with execution.
          // Never gates or delays executePaperTrade. Scores ENTER signals only.
          const s3Config = botContext.settings?.s3;
          const isEnterSignal = parsedSignal.signal === 'ENTER_LONG' || parsedSignal.signal === 'ENTER_SHORT';
          if (s3Config?.enabled && isEnterSignal) {
            const bybitBaseUrl = process.env.BYBIT_BASE_URL || 'https://api-demo.bybit.com';
            computeS3Score({
              signal: parsedSignal.signal,
              botId: parsedSignal.botId,
              symbol: botContext.symbol,
              db: persistence,
              s3Config,
              bybitBaseUrl,
            }).then(s3Result => {
              logger.info('[S3] Score', {
                botId: s3Result.botId,
                symbol: s3Result.symbol,
                signal: s3Result.signal,
                score: s3Result.score,
                latencyMs: s3Result.latencyMs,
                dataAvailable: s3Result.dataAvailable,
                components: s3Result.components,
              });
              persistence.recordS3Score(s3Result);
            }).catch(err => {
              logger.warn('[S3] Score computation failed', { error: err.message, botId: parsedSignal.botId });
            });
          }
        }

        if (risk.allowed && isExitSignal) {
          setImmediate(async () => {
            try {
              const exitResult = await executeSignalClose(parsedSignal, {
                settingsPath: botContext.settingsPath,
                botContext,
                envPath: '/home/ubuntu/.openclaw/.env',
              });
              logger.info('Signal exit result', { exitResult });
            } catch (exitError) {
              logger.warn('Background exit failure', {
                error: exitError.message,
                parsedSignal,
              });
            }
          });
        }

        persistence.recordHeartbeatEvent({
          received_at: new Date().toISOString(),
          source: 'tradingview',
          raw_input: signalInput,
          status: 'processed',
          details_json: JSON.stringify({ botId: parsedSignal.botId, signal: parsedSignal.signal, executionQueued: Boolean(risk.allowed && risk.actionable), exitQueued: Boolean(risk.allowed && isExitSignal) }),
        });

        return json(res, 200, {
          ok: true,
          validation: risk.configValidation,
          parsedSignal,
          risk,
          executionQueued: Boolean(risk.allowed && risk.actionable),
          exitQueued: Boolean(risk.allowed && isExitSignal),
          tradingEnabled: Boolean(botContext.settings?.trading?.enabled),
        });
      } catch (error) {
        persistence.recordWebhookEvent({
          received_at: new Date().toISOString(),
          request_path: requestUrl.pathname,
          method: req.method,
          auth_ok: 1,
          parse_ok: 0,
          raw_body: signalInput,
          error_message: error.message,
        });
        persistence.recordHeartbeatEvent({
          received_at: new Date().toISOString(),
          source: 'tradingview',
          raw_input: String(signalInput || ''),
          status: 'error',
          details_json: JSON.stringify({ error: error.message }),
        });
        logger.warn('Webhook processing failure', { error: error.message, rawBody: signalInput });
        return json(res, 400, { ok: false, error: error.message });
      }
    });
  });

  return {
    host,
    port,
    path: webhookPath,
    start() {
      return new Promise(resolve => {
        server.listen(port, host, () => {
          logger.info('Webhook server listening', { host, port, path: webhookPath });
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
