'use strict';

// S2.1 webhook dispatch.
//
// Called from within the existing src/webhook/createServer.js handler BEFORE
// the legacy parseSignalString path. If the signal is S2.1-bound, this module
// fully handles it and returns { handled: true }. Otherwise it returns
// { handled: false } and the caller falls through to legacy.
//
// Approved dispatch sequence (verbatim from the PR 1 review):
//
//   1. Receive POST → auth check                       [caller does this]
//   2. INSERT s2_1_signals (acted=NULL) → signalId
//   3. Try parseS21Signal(rawBody)
//      ├─ throw  : update row with reject_reason='PARSE_ERROR' (forensic), return handled=false
//      └─ ok     : continue
//   4. Update row with bot_id, symbol, direction
//   5. Registry check
//      ├─ legacy bot (in bots.json)   : DELETE row, log INFO fall-through, return handled=false
//      ├─ unknown   (in neither)      : keep row with reject_reason='UNKNOWN_BOT', log WARN, return handled=false
//      └─ S2.1 bot                    : continue
//   6. Bot enabled check
//      └─ disabled : update row { acted=false, reject_reason='BOT_DISABLED' }, return handled=true (ok=false)
//   7. ENTER signals: hybrid in-position check
//      a. getOpenS21TradesForSymbol — DB read
//      b. if open trade exists: getLivePosition from Bybit
//         ├─ bybit size > 0  : reject IN_POSITION
//         └─ bybit size == 0 : ZOMBIE_RECONCILE — mark stale trade CLOSED, WARN log, then proceed
//      c. dispatch engine.openScaledTrade
//   7'. EXIT signals: find open trade, dispatch engine.onExitSignal
//   8. Engine throw   : update row { acted=false, reject_reason='ENGINE_ERROR: …' }
//      Engine success : update row { acted=true }

const path = require('path');
const { parseS21Signal } = require('./signalParser');
const { getS21BotConfig, getS21BotIds, resolveS21Credentials } = require('./config');
const engine = require('./tradeEngine');

// Lazy bybitClient — we only need it on the rare reject-path Bybit double-check.
function _client() { return require('./bybitClient'); }

// Lazy legacy registry — same reason; only needed to classify fall-through bots.
function _legacyBotIds(registryPath) {
  try {
    const { loadBotRegistry } = require('../config/botRegistry');
    return new Set(loadBotRegistry(registryPath).bots.map(b => b.botId));
  } catch {
    return new Set();
  }
}

async function tryDispatchS21({
  rawSignal,
  persistence,
  envPath = '/home/ubuntu/.openclaw/.env',
  legacyRegistryPath = path.join(__dirname, '..', '..', 'config', 'bots.json'),
  logger = console,
  options = {},
  alerts,
  // injection seams for testing
  _injectLivePosition,
  _injectEngine,
  _injectS21BotIds,
  _injectLegacyBotIds,
  _injectBotConfig,
  _injectCredentials,
}) {
  // ── Step 2: insert pending row (always — even garbage gets a forensic trail) ──
  const { signalId } = persistence.insertS21Signal({
    received_at: new Date().toISOString(),
    raw_body: rawSignal,
  });

  // ── Step 3: parse ─────────────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseS21Signal(rawSignal);
  } catch (err) {
    persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'PARSE_ERROR' });
    logger.info('[s2.1] parse error — signal logged for forensics, falling through to legacy', { rawSignal, error: err.message });
    return { handled: false, signalId };
  }

  // ── Step 4: enrich row with parsed fields ─────────────────────────────────
  // direction may be null for direction-less EXIT_BotN — store as 'EXIT' marker so
  // the signal log row is informative when read back.
  const directionField = parsed.direction || (parsed.action === 'EXIT' ? 'EXIT' : null);
  persistence.updateS21Signal(signalId, {
    bot_id: parsed.botId,
    direction: directionField,
  });

  // ── Step 5: registry check ────────────────────────────────────────────────
  const s21Ids = _injectS21BotIds || new Set(getS21BotIds());
  if (!s21Ids.has(parsed.botId)) {
    const legacyIds = _injectLegacyBotIds || _legacyBotIds(legacyRegistryPath);
    if (legacyIds.has(parsed.botId)) {
      // Known legacy bot — clean fall-through. Delete row to keep s2_1_signals strictly S2.1-relevant.
      persistence.deleteS21Signal(signalId);
      logger.info(`[s2.1] legacy fall-through: bot_id=${parsed.botId} action=${parsed.action} direction=${parsed.direction || 'EXIT'}`);
    } else {
      // Unknown bot — keep row with WARN reject_reason so we can grep for misfires.
      persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'UNKNOWN_BOT' });
      logger.warn(`[s2.1] unknown bot_id: ${parsed.botId} (in neither s21-bots.json nor bots.json)`);
    }
    return { handled: false, signalId, parsed };
  }

  // ── S2.1-bound from here on ───────────────────────────────────────────────
  let botConfig;
  try {
    botConfig = _injectBotConfig || getS21BotConfig(parsed.botId);
  } catch (err) {
    persistence.updateS21Signal(signalId, { acted: false, reject_reason: `CONFIG_ERROR: ${err.message.slice(0, 100)}` });
    return { handled: true, ok: false, signalId, reject_reason: 'CONFIG_ERROR' };
  }
  persistence.updateS21Signal(signalId, { symbol: botConfig.symbol });

  // ── Step 6: bot enabled check ─────────────────────────────────────────────
  if (botConfig.enabled === false) {
    persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'BOT_DISABLED' });
    return { handled: true, ok: false, signalId, reject_reason: 'BOT_DISABLED' };
  }

  // Resolve credentials (needed for in-position double-check and engine dispatch).
  // Skip in dry-run if the bot config explicitly opts out.
  let credentials;
  try {
    credentials = _injectCredentials || resolveS21Credentials(botConfig, envPath);
  } catch (err) {
    if (botConfig.dryRun) {
      credentials = { apiKey: 'paper', apiSecret: 'paper' };
    } else {
      persistence.updateS21Signal(signalId, { acted: false, reject_reason: `CREDENTIALS_MISSING: ${err.message.slice(0, 100)}` });
      logger.warn('[s2.1] credentials missing for live bot — cannot dispatch', { bot: parsed.botId, error: err.message });
      return { handled: true, ok: false, signalId, reject_reason: 'CREDENTIALS_MISSING' };
    }
  }

  // ── Step 7 / 7': dispatch ─────────────────────────────────────────────────
  const dispatchEngine = _injectEngine || engine;

  if (parsed.action === 'ENTER') {
    return _dispatchEnter({
      parsed, botConfig, credentials, persistence, dispatchEngine,
      signalId, logger, options, alerts, _injectLivePosition,
    });
  } else {
    return _dispatchExit({
      parsed, botConfig, credentials, persistence, dispatchEngine,
      signalId, logger, options, alerts,
    });
  }
}

async function _dispatchEnter({ parsed, botConfig, credentials, persistence, dispatchEngine, signalId, logger, options, alerts, _injectLivePosition }) {
  const symbol = botConfig.symbol;

  // Step 7a: cheap DB read
  const openInDb = persistence.getOpenS21TradesForSymbol(symbol);

  // Step 7b: hybrid check — only call Bybit if DB thinks we're in
  if (openInDb.length > 0) {
    let livePos;
    try {
      livePos = _injectLivePosition
        ? await _injectLivePosition({ symbol, credentials })
        : await _client().getLivePosition(symbol, credentials, options);
    } catch (err) {
      // Bybit unreachable — fail closed (genuine reject to be safe).
      persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'BYBIT_UNREACHABLE_ON_REJECT_CHECK' });
      logger.warn('[s2.1] bybit unreachable during hybrid in-position check — failing closed', { symbol, error: err.message });
      return { handled: true, ok: false, signalId, reject_reason: 'BYBIT_UNREACHABLE_ON_REJECT_CHECK' };
    }

    const bybitSize = Number(livePos?.size || 0);
    if (bybitSize > 0) {
      // Genuine in-position. Reject.
      persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'IN_POSITION' });
      return { handled: true, ok: false, signalId, reject_reason: 'IN_POSITION' };
    }

    // Bybit flat, DB thought open — ZOMBIE_RECONCILE.
    for (const stale of openInDb) {
      // Snapshot pre-update fields before mutation. Required even though
      // SQLite returns row copies in prod — defends against in-memory
      // persistences and any future ORM that returns live references.
      const priorStatus = stale.status;
      const priorTradeId = stale.trade_id;
      const lastEvent = persistence.getS21EventsForTrade(priorTradeId).slice(-1)[0];
      const lastEventType = lastEvent ? lastEvent.event_type : null;

      persistence.insertS21Event({
        trade_id: priorTradeId,
        event_type: 'ZOMBIE_RECONCILE',
        details: {
          bybit_position_size: bybitSize,
          db_thought_status: priorStatus,
          last_event_in_timeline: lastEventType,
          new_signal: parsed.raw,
        },
      });
      persistence.updateS21Trade(priorTradeId, {
        status: 'CLOSED',
        close_reason: 'ZOMBIE_RECONCILE',
        close_time: new Date().toISOString(),
      });
      logger.warn('[s2.1] ZOMBIE_RECONCILE — DB had trade open but Bybit position flat. Marked stale trade CLOSED.', {
        trade_id: priorTradeId,
        bybit_position_size: bybitSize,
        db_thought_status: priorStatus,
        last_event: lastEventType,
        new_signal_raw: parsed.raw,
      });
      // "Tell me right now" — refinement #2 from the PR 3 review.
      if (alerts && alerts.send) {
        alerts.send(
          `[S2.1] ZOMBIE_RECONCILE — trade ${priorTradeId} marked CLOSED. ` +
          `DB thought ${priorStatus}, Bybit position flat (size=${bybitSize}). ` +
          `Last event in timeline: ${lastEventType || 'none'}. ` +
          `Incoming signal: ${parsed.raw}.`
        ).catch(() => {});
      }
    }
    // Proceed with new signal — fall through to engine dispatch below.
  }

  // Step 7c: dispatch
  try {
    const result = await dispatchEngine.openScaledTrade({
      signal: `ENTER_${parsed.direction}`,
      botConfig,
      notionalUsd: botConfig.notionalUsd,
      persistence,
      credentials,
      options,
      alerts,
      logger,
    });
    persistence.updateS21Signal(signalId, { acted: true });
    return { handled: true, ok: true, signalId, tradeId: result.tradeId };
  } catch (err) {
    persistence.updateS21Signal(signalId, {
      acted: false,
      reject_reason: `ENGINE_ERROR: ${err.message.slice(0, 120)}`,
    });
    logger.error('[s2.1] engine dispatch failed for ENTER', { signal: parsed.raw, error: err.message });
    return { handled: true, ok: false, signalId, reject_reason: 'ENGINE_ERROR' };
  }
}

async function _dispatchExit({ parsed, botConfig, credentials, persistence, dispatchEngine, signalId, logger, options, alerts }) {
  const symbol = botConfig.symbol;
  const openTrades = persistence.getOpenS21TradesForSymbol(symbol);
  if (openTrades.length === 0) {
    persistence.updateS21Signal(signalId, { acted: false, reject_reason: 'NO_OPEN_TRADE' });
    return { handled: true, ok: false, signalId, reject_reason: 'NO_OPEN_TRADE' };
  }

  try {
    for (const trade of openTrades) {
      await dispatchEngine.onExitSignal({
        tradeId: trade.trade_id,
        persistence, credentials, options, alerts, logger,
      });
    }
    persistence.updateS21Signal(signalId, { acted: true });
    return { handled: true, ok: true, signalId, closedCount: openTrades.length };
  } catch (err) {
    persistence.updateS21Signal(signalId, {
      acted: false,
      reject_reason: `ENGINE_ERROR: ${err.message.slice(0, 120)}`,
    });
    logger.error('[s2.1] engine dispatch failed for EXIT', { signal: parsed.raw, error: err.message });
    return { handled: true, ok: false, signalId, reject_reason: 'ENGINE_ERROR' };
  }
}

module.exports = { tryDispatchS21 };
