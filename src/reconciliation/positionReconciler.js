const { fetchClosedPnl } = require('./closedPnlClient');
const { filterUnreconciled, DEFAULT_TOLERANCES } = require('./exitEventDedup');

const ENTER_SIGNALS = new Set([
  'ENTER_LONG', 'ENTER_SHORT',
  'ENTER_LONG_DCA_ADD', 'ENTER_SHORT_DCA_ADD',
]);

const DEFAULT_MIN_QUIET_SECONDS_AFTER_ENTER = 60;
const BE_PRICE_REL_TOL = 0.003;

function nowIso() {
  return new Date().toISOString();
}

function isoToMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function msToIso(ms) {
  return new Date(Number(ms)).toISOString();
}

function readExitEventsSince(db, botId, symbol, sinceIso) {
  return db.prepare(`
    SELECT id, created_at, bot_id, symbol, exit_reason, trigger_percent, close_percent, side, qty, mark_price
    FROM exit_events
    WHERE bot_id = ? AND symbol = ? AND created_at >= ?
    ORDER BY created_at ASC, id ASC
  `).all(botId, symbol, sinceIso);
}

function readMostRecentFullClose(db, botId, symbol) {
  return db.prepare(`
    SELECT id, created_at, close_percent
    FROM exit_events
    WHERE bot_id = ? AND symbol = ? AND close_percent >= 100
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(botId, symbol) || null;
}

function readSessionEnters(db, botId, symbol, afterIso) {
  const placeholders = Array.from(ENTER_SIGNALS).map(() => '?').join(',');
  const where = afterIso
    ? `bot_id = ? AND symbol = ? AND created_at > ? AND signal IN (${placeholders})`
    : `bot_id = ? AND symbol = ? AND signal IN (${placeholders})`;
  const params = afterIso
    ? [botId, symbol, afterIso, ...ENTER_SIGNALS]
    : [botId, symbol, ...ENTER_SIGNALS];
  return db.prepare(`
    SELECT id, created_at, signal, bot_id, symbol, side, qty
    FROM order_attempts
    WHERE ${where}
    ORDER BY created_at ASC, id ASC
  `).all(...params);
}

function findCurrentTradeSession(db, botId, symbol) {
  const lastClose = readMostRecentFullClose(db, botId, symbol);
  const enters = readSessionEnters(db, botId, symbol, lastClose ? lastClose.created_at : null);
  if (enters.length === 0) return null;
  return { sessionStart: enters[0], enters };
}

function sumQty(rows) {
  return rows.reduce((acc, r) => acc + (Number(r.qty) || 0), 0);
}

function readNativeSlEventsSince(db, botId, symbol, sinceIso) {
  return db.prepare(`
    SELECT id, created_at, bot_id, symbol, event_type, sl_price, sl_percent, side
    FROM native_sl_events
    WHERE bot_id = ? AND symbol = ? AND created_at >= ?
    ORDER BY created_at ASC, id ASC
  `).all(botId, symbol, sinceIso);
}

function sumClosePercent(exitEvents) {
  return exitEvents.reduce((acc, ev) => acc + (Number(ev.close_percent) || 0), 0);
}

function classifyExitReason(record, nativeSlEvents) {
  const beUpdates = nativeSlEvents.filter((e) => e.event_type === 'be_update');
  if (beUpdates.length > 0) {
    const exitPrice = record.avgExitPrice;
    for (const be of beUpdates) {
      const sl = Number(be.sl_price);
      if (!Number.isFinite(sl) || !Number.isFinite(exitPrice)) continue;
      const denom = Math.max(Math.abs(sl), Math.abs(exitPrice));
      if (denom === 0) continue;
      if (Math.abs(sl - exitPrice) / denom <= BE_PRICE_REL_TOL) {
        return 'reconciled_native_be_stop';
      }
    }
  }
  if (record.execType === 'BustTrade') return 'reconciled_liquidation';
  return 'reconciled_native_close';
}

function buildExitRow({ record, botId, exitReason }) {
  return {
    created_at: msToIso(record.updatedTimeMs),
    bot_id: botId,
    symbol: record.symbol,
    exit_reason: exitReason,
    trigger_percent: 0,
    close_percent: 100,
    side: record.closingSide,
    qty: String(record.qty),
    mark_price: record.avgExitPrice,
    response_json: JSON.stringify({
      source: 'reconciliation_poller',
      exec_type: record.execType,
      order_type: record.orderType,
      avg_entry_price_at_close: record.avgEntryPrice,
      closed_pnl_usd: record.closedPnlUsd,
      open_fee_usd: record.openFeeUsd,
      close_fee_usd: record.closeFeeUsd,
      fill_count: record.fillCount,
      bybit_created_time_ms: record.createdTimeMs,
      bybit_updated_time_ms: record.updatedTimeMs,
      reconciler_run_at: nowIso(),
    }),
  };
}

function invariantsOk({ row, lastEnter, logger }) {
  const enterMs = isoToMs(lastEnter.created_at);
  const closedMs = isoToMs(row.created_at);
  if (enterMs === null || closedMs === null) {
    logger.warn('[reconciler] skip: unparseable timestamps', { row, lastEnter });
    return false;
  }
  if (closedMs < enterMs) {
    logger.warn('[reconciler] skip: close before enter', { row, lastEnter });
    return false;
  }
  if (closedMs > Date.now() + 60 * 1000) {
    logger.warn('[reconciler] skip: close in the future', { row });
    return false;
  }
  if (!Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0) {
    logger.warn('[reconciler] skip: invalid qty', { row });
    return false;
  }
  if (!Number.isFinite(row.mark_price) || row.mark_price <= 0) {
    logger.warn('[reconciler] skip: invalid mark_price', { row });
    return false;
  }
  return true;
}

async function defaultFetchLivePosition({ symbol, credentials }) {
  const axios = require('axios');
  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const query = `category=linear&symbol=${symbol}`;
  const sig = crypto.createHmac('sha256', credentials.apiSecret)
    .update(timestamp + credentials.apiKey + recvWindow + query)
    .digest('hex');
  const response = await axios.get(`https://api.bybit.com/v5/position/list?${query}`, {
    headers: {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': sig,
    },
    timeout: 10000,
    validateStatus: () => true,
  });
  return response.data;
}

async function reconcileBot({
  db,
  bot,
  credentials,
  fetchers = {},
  options = {},
  logger = console,
}) {
  const {
    dryRun = false,
    minQuietSecondsAfterEnter = DEFAULT_MIN_QUIET_SECONDS_AFTER_ENTER,
    tolerances = DEFAULT_TOLERANCES,
  } = options;

  const fetchLivePosition = fetchers.fetchLivePosition || defaultFetchLivePosition;
  const fetchClosedPnlFn = fetchers.fetchClosedPnl || ((args) => fetchClosedPnl({ ...args, credentials }));

  const report = {
    bot_id: bot.botId,
    symbol: bot.symbol,
    in_sync: null,
    skipped_reason: null,
    inserted: [],
    skipped_records: [],
    dryRun,
  };

  const session = findCurrentTradeSession(db, bot.botId, bot.symbol);
  if (!session) {
    report.in_sync = true;
    report.skipped_reason = 'no_open_trade_session';
    return report;
  }
  const sessionStart = session.sessionStart;
  const lastEnter = session.enters[session.enters.length - 1];

  const exitsSince = readExitEventsSince(db, bot.botId, bot.symbol, sessionStart.created_at);
  const closedPct = sumClosePercent(exitsSince);
  const s2ThinksOpen = closedPct < 99;

  const positionResp = await fetchLivePosition({ symbol: bot.symbol, credentials });
  const positionList = positionResp && positionResp.result && positionResp.result.list || [];
  const livePos = positionList.find((p) => Number(p.size || 0) > 0);
  const bybitOpen = Boolean(livePos);

  if (!s2ThinksOpen && !bybitOpen) {
    report.in_sync = true;
    return report;
  }
  if (s2ThinksOpen && bybitOpen) {
    report.in_sync = true;
    report.skipped_reason = 'both_open_no_divergence';
    return report;
  }
  if (!s2ThinksOpen && bybitOpen) {
    report.in_sync = false;
    report.skipped_reason = 'phantom_position_on_bybit_human_review_required';
    logger.warn('[reconciler] divergence: Bybit open but S2 flat', {
      bot_id: bot.botId, symbol: bot.symbol, livePos,
    });
    return report;
  }

  const enterMs = isoToMs(lastEnter.created_at);
  if (enterMs !== null && Date.now() - enterMs < minQuietSecondsAfterEnter * 1000) {
    report.in_sync = false;
    report.skipped_reason = 'quiet_period_after_enter';
    return report;
  }

  let closedPnlRecords;
  try {
    closedPnlRecords = await fetchClosedPnlFn({
      symbol: bot.symbol,
      startTimeMs: enterMs,
      credentials,
    });
  } catch (err) {
    report.in_sync = false;
    report.skipped_reason = `closed_pnl_fetch_failed: ${err.message}`;
    return report;
  }

  const unreconciled = filterUnreconciled(closedPnlRecords, exitsSince, tolerances);
  if (unreconciled.length === 0) {
    report.in_sync = false;
    report.skipped_reason = 'no_unreconciled_records';
    return report;
  }

  const nativeSlEvents = readNativeSlEventsSince(db, bot.botId, bot.symbol, sessionStart.created_at);
  const enteredQty = sumQty(session.enters);
  const alreadyExitedQty = sumQty(exitsSince);
  const QTY_OVERSHOOT_REL_TOL = 0.01;

  const rowsToInsert = [];
  let runningExitedQty = alreadyExitedQty;
  for (const record of unreconciled) {
    const exitReason = classifyExitReason(record, nativeSlEvents);
    const row = buildExitRow({ record, botId: bot.botId, exitReason });
    if (!invariantsOk({ row, lastEnter, logger })) {
      report.skipped_records.push({ record, reason: 'invariant_failed' });
      continue;
    }
    const rowQty = Number(row.qty);
    if (enteredQty > 0 && runningExitedQty + rowQty > enteredQty * (1 + QTY_OVERSHOOT_REL_TOL)) {
      report.skipped_records.push({ record, reason: 'would_exceed_entered_qty' });
      logger.warn('[reconciler] skip: would exceed entered qty', {
        bot_id: bot.botId, enteredQty, runningExitedQty, addition: rowQty,
      });
      continue;
    }
    rowsToInsert.push(row);
    runningExitedQty += rowQty;
  }

  if (rowsToInsert.length === 0) {
    report.in_sync = false;
    report.skipped_reason = 'all_records_failed_invariants';
    return report;
  }

  if (dryRun) {
    report.in_sync = false;
    report.skipped_reason = 'dry_run';
    report.inserted = rowsToInsert.map((r) => ({ ...r, _dry_run: true }));
    return report;
  }

  const insertStmt = db.prepare(`
    INSERT INTO exit_events (
      created_at, bot_id, symbol, exit_reason, trigger_percent, close_percent, side, qty, mark_price, response_json
    ) VALUES (
      @created_at, @bot_id, @symbol, @exit_reason, @trigger_percent, @close_percent, @side, @qty, @mark_price, @response_json
    )
  `);
  const tx = db.transaction((rows) => {
    const ids = [];
    for (const r of rows) {
      const info = insertStmt.run(r);
      ids.push(info.lastInsertRowid);
    }
    return ids;
  });
  const insertedIds = tx(rowsToInsert);
  report.in_sync = false;
  report.inserted = rowsToInsert.map((r, i) => ({ ...r, id: insertedIds[i] }));
  logger.info('[reconciler] inserted reconciled exit_events', {
    bot_id: bot.botId, symbol: bot.symbol, count: rowsToInsert.length, ids: insertedIds,
  });
  return report;
}

async function reconcileAll({
  db,
  bots,
  credentialsResolver,
  fetchers,
  options = {},
  logger = console,
}) {
  const reports = [];
  for (const bot of bots) {
    if (!bot.enabled) {
      reports.push({ bot_id: bot.botId, symbol: bot.symbol, in_sync: true, skipped_reason: 'bot_disabled' });
      continue;
    }
    let credentials;
    try {
      credentials = credentialsResolver(bot.botId);
    } catch (err) {
      reports.push({ bot_id: bot.botId, symbol: bot.symbol, in_sync: false, skipped_reason: `credentials_unavailable: ${err.message}` });
      continue;
    }
    try {
      const r = await reconcileBot({ db, bot, credentials, fetchers, options, logger });
      reports.push(r);
    } catch (err) {
      reports.push({ bot_id: bot.botId, symbol: bot.symbol, in_sync: false, skipped_reason: `error: ${err.message}` });
      logger.warn('[reconciler] per-bot error', { bot_id: bot.botId, error: err.message });
    }
    if (options.perBotStaggerMs) {
      await new Promise((res) => setTimeout(res, options.perBotStaggerMs));
    }
  }
  return reports;
}

module.exports = {
  reconcileBot,
  reconcileAll,
  __test__: {
    classifyExitReason,
    buildExitRow,
    sumClosePercent,
    ENTER_SIGNALS,
  },
};
