'use strict';

// S2.1 fill watcher.
//
// Purpose: detect when an S2.1 order has filled or stopped on Bybit and
// dispatch the result to the trade engine's lifecycle handlers
// (onT2Fill, onTpHit, onSlHit). Without this, the engine would be
// open-loop in live mode — placement happens, but the close paths only
// fire if something explicitly calls them.
//
// Architecture: peer to src/reconciliation/positionReconciler.js. They
// run in the same webhook process, on independent intervals, against
// completely disjoint tables and bot sets. The reconciler covers legacy
// S2 (Bot1–Bot8 via config/bots.json + exit_events table). This watcher
// covers S2.1 (Bot9+ via config/s21-bots.json + s2_1_trades / s2_1_events).
//
// Refinement #4 — Mode-aware tick:
//   The watcher ticks on every interval REGARDLESS of whether any open
//   trade is live or paper. When all open trades are dry-run, it
//   short-circuits before the Bybit REST call, so it costs nothing in
//   API budget. But the orchestration scaffolding (re-entrancy guard,
//   timer wiring, logging, shutdown handler) runs every tick — so the
//   first live trade doesn't hit a never-exercised code path.
//
// Refinement #1 (in run-webhook.js boot, not here): the registry
// collision check ensures Bot9 isn't ALSO being processed by the
// reconciler with wrong credentials.

const DEFAULT_INTERVAL_MS = 30 * 1000;

// Map from orderLinkId suffix → handler kind. Used to classify fills.
function _classifyOrderLinkId(orderLinkId, tradeId) {
  if (!orderLinkId || !orderLinkId.startsWith(tradeId + '_')) return null;
  const suffix = orderLinkId.slice(tradeId.length + 1);
  if (suffix === 't1_market') return { kind: 'T1_ENTRY' };
  if (suffix === 't1_sl')     return { kind: 'T1_SL' };
  if (suffix === 't2_trigger') return { kind: 'T2_FIRE' };
  if (suffix === 't2_sl')     return { kind: 'T2_SL' };
  const tpMatch = suffix.match(/^(t1|t2)_tp([1-6])$/);
  if (tpMatch) return { kind: 'TP_HIT', tranche: tpMatch[1], tpIdx: Number(tpMatch[2]) - 1 };
  return null;
}

// Returns the set of orderLinkIds we'd expect to see if a trade were
// fully alive: the trade-row order ids plus the TP ladder linkIds. The
// watcher uses this to (a) figure out which fills are ours, (b) record
// which ones we've already dispatched.
function _expectedOrderLinkIds(trade) {
  const out = [`${trade.trade_id}_t1_market`];
  if (trade.t1_sl_order_id) out.push(trade.t1_sl_order_id);
  if (trade.t2_order_id) out.push(trade.t2_order_id);
  if (trade.t2_sl_order_id) out.push(trade.t2_sl_order_id);
  for (let i = 1; i <= 6; i++) out.push(`${trade.trade_id}_t1_tp${i}`);
  for (let i = 1; i <= 6; i++) out.push(`${trade.trade_id}_t2_tp${i}`);
  return out;
}

// The persistence layer records every fill dispatch as an event. We use
// that to avoid double-firing: before dispatching, check if the
// orderLinkId has already been seen.
function _alreadyDispatched(persistence, tradeId, orderLinkId) {
  const events = persistence.getS21EventsForTrade(tradeId);
  return events.some(e => {
    if (!e.details_json) return false;
    try {
      const d = JSON.parse(e.details_json);
      return d && d.dispatched_orderLinkId === orderLinkId;
    } catch { return false; }
  });
}

async function tickOnce({
  persistence, botConfigs, credentialsResolver, options = {}, alerts, logger,
  // injection hooks for testing
  _fetchExecutions, _fetchOpenOrders, _engine,
}) {
  const engine = _engine || require('./tradeEngine');
  const openTrades = persistence.getOpenS21Trades();
  if (openTrades.length === 0) {
    return { ticks: 0, openTrades: 0, dispatched: 0, mode: 'idle' };
  }

  const allDryRun = openTrades.every(t => t.dry_run === 1);
  if (allDryRun) {
    // §4 firewall: do not make any Bybit calls when all trades are paper.
    // The tick still RAN (this function was called); re-entrancy guard
    // and shutdown wiring are exercised by the outer loop.
    return { ticks: 1, openTrades: openTrades.length, dispatched: 0, mode: 'paper_only_skipped_rest' };
  }

  let dispatched = 0;
  for (const trade of openTrades) {
    if (trade.dry_run === 1) continue;  // live tick: skip paper trades
    const botConfig = botConfigs.find(b => b.botId === trade.bot_id);
    if (!botConfig) {
      logger.warn('[s21-watcher] no botConfig for trade — skipping', { tradeId: trade.trade_id, botId: trade.bot_id });
      continue;
    }
    let credentials;
    try {
      credentials = credentialsResolver(botConfig);
    } catch (err) {
      logger.warn('[s21-watcher] credentials unavailable — skipping', { tradeId: trade.trade_id, error: err.message });
      continue;
    }

    let executions;
    try {
      const since = trade.created_at;
      executions = _fetchExecutions
        ? await _fetchExecutions({ symbol: trade.symbol, since, credentials, options })
        : await _liveFetchExecutions({ symbol: trade.symbol, since, credentials, options });
    } catch (err) {
      logger.warn('[s21-watcher] execution fetch failed', { tradeId: trade.trade_id, error: err.message });
      continue;
    }

    for (const exec of executions) {
      const orderLinkId = exec.orderLinkId;
      const classification = _classifyOrderLinkId(orderLinkId, trade.trade_id);
      if (!classification) continue;
      if (_alreadyDispatched(persistence, trade.trade_id, orderLinkId)) continue;

      // Mark dispatch BEFORE calling the handler — if the handler throws,
      // we don't want to retry forever. The error is logged separately.
      persistence.insertS21Event({
        trade_id: trade.trade_id,
        event_type: 'WATCHER_DISPATCH',
        details: { dispatched_orderLinkId: orderLinkId, kind: classification.kind, execId: exec.execId },
      });

      try {
        const fillPrice = Number(exec.execPrice);
        switch (classification.kind) {
          case 'T2_FIRE':
            await engine.onT2Fill({
              tradeId: trade.trade_id, fillPrice,
              persistence, botConfig, credentials, options, alerts, logger,
            });
            break;
          case 'T1_SL':
            await engine.onSlHit({
              tradeId: trade.trade_id, tranche: 'T1', slPrice: fillPrice,
              persistence, botConfig, credentials, options, alerts, logger,
            });
            break;
          case 'T2_SL':
            await engine.onSlHit({
              tradeId: trade.trade_id, tranche: 'T2', slPrice: fillPrice,
              persistence, botConfig, credentials, options, alerts, logger,
            });
            break;
          case 'TP_HIT':
            await engine.onTpHit({
              tradeId: trade.trade_id, tranche: classification.tranche,
              tpIdx: classification.tpIdx, hitPrice: fillPrice, qtyClosed: Number(exec.execQty),
              persistence, botConfig, credentials, options, alerts, logger,
            });
            break;
          case 'T1_ENTRY':
            // T1 entry fill is captured synchronously by openScaledTrade —
            // we don't dispatch on a second sighting.
            break;
          default:
            logger.warn('[s21-watcher] unhandled classification', classification);
        }
        dispatched++;
      } catch (err) {
        logger.error('[s21-watcher] handler failed', {
          tradeId: trade.trade_id, kind: classification.kind, error: err.message,
        });
        persistence.insertS21Event({
          trade_id: trade.trade_id,
          event_type: 'WATCHER_DISPATCH_ERROR',
          details: { orderLinkId, kind: classification.kind, error: err.message },
        });
      }
    }
  }

  return { ticks: 1, openTrades: openTrades.length, dispatched, mode: 'live' };
}

// Default Bybit execution-history fetcher. Returns array of executions
// matching one of our orderLinkIds.
async function _liveFetchExecutions({ symbol, since, credentials, options }) {
  const { bybitPrivateGet } = require('./bybitClient');
  const startTimeMs = Date.parse(since) || 0;
  const query = `category=linear&symbol=${symbol}&startTime=${startTimeMs}&limit=50`;
  const resp = await bybitPrivateGet('/v5/execution/list', query, credentials, options);
  return (resp?.result?.list || []).map(e => ({
    execId: e.execId,
    orderId: e.orderId,
    orderLinkId: e.orderLinkId,
    symbol: e.symbol,
    side: e.side,
    execPrice: e.execPrice,
    execQty: e.execQty,
    execTime: e.execTime,
    execType: e.execType,
    closedSize: e.closedSize,
  }));
}

// Starts the polling loop. Returns { stop, enabled, tickNow } — tickNow is
// exposed for tests so a tick can be triggered without waiting on the timer.
function startWatcher({
  persistence,
  botConfigs,
  credentialsResolver,
  intervalMs = DEFAULT_INTERVAL_MS,
  options = {},
  alerts,
  logger = console,
  _fetchExecutions,
  _engine,
}) {
  let running = false;
  let stopped = false;

  const safeTick = async () => {
    if (stopped) return;
    if (running) {
      logger.warn('[s21-watcher] previous tick still running — skipping');
      return;
    }
    running = true;
    try {
      const result = await tickOnce({
        persistence, botConfigs, credentialsResolver, options, alerts, logger,
        _fetchExecutions, _engine,
      });
      if (result.dispatched > 0) {
        logger.info('[s21-watcher] dispatched fills', result);
      }
    } catch (err) {
      logger.error('[s21-watcher] tick crashed', { error: err.message, stack: err.stack });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(safeTick, intervalMs);
  // First tick happens immediately so we don't pay an interval-wait on boot.
  safeTick();

  return {
    enabled: true,
    config: { intervalMs },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tickNow: safeTick,
  };
}

module.exports = {
  startWatcher,
  tickOnce,
  // exposed for unit tests
  _classifyOrderLinkId,
  _expectedOrderLinkIds,
  _alreadyDispatched,
  DEFAULT_INTERVAL_MS,
};
