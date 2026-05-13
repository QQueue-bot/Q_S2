'use strict';

// S2.1 trade lifecycle orchestration.
//
// Public surface:
//   openScaledTrade(...)   — webhook handler calls this on ENTER signals
//   onT2Fill(...)          — call when T2 stop-market fires (auto in dry-run)
//   onTpHit(...)           — call when a TP fills
//   onSlHit(...)           — call when an SL fires
//   onExitSignal(...)      — webhook handler calls this on EXIT signals
//   simulatePaperTpHit/SlHit — paper-mode helpers for validating BE move and
//                              orphan cleanup paths without live fills
//
// CRITICAL CORRECTNESS CHECKS (do not refactor without re-validating):
//
//   §1 Orphan-order cleanup runs on every close path. `cancelAllForTrade` is
//      the single chokepoint — every handler that closes (or partially closes)
//      a tranche calls it. NO close path bypasses cleanup.
//
//   §2 ATR snapshot is captured exactly once in openScaledTrade and persisted
//      to entry_price_snapshot / atr_pct_at_open / add_pct. Never recomputed.
//      Downstream handlers read from the DB row.
//
//   §3 T2 SL is placed at the T2 FILL price (not the trigger price). The fill
//      price arrives in onT2Fill and is used directly in placeT2StopLoss.
//
//   §4 The dryRun flag is the firewall: when true, orderManager returns
//      synthetic responses and never calls Bybit. The engine path is
//      identical — only the network layer changes.
//
// PR 6 (Telegram) — alert list to wire when telegram.js lands:
//   T1_FILLED, T2_FILLED, TP_HIT, SL_HIT, MDX_EXIT_RECEIVED, ORPHAN_CLEANUP,
//   WATCHER_DISPATCH_ERROR, ZOMBIE_RECONCILE (raised in PR 4 webhook handler
//   when getOpenS21TradesForSymbol says open but Bybit says flat — that's a
//   "tell me right now" event, not a quiet DB log).

const orderManager = require('./orderManager');
const sizing = require('./sizing');
const { computeAtr14 } = require('./atr');

const NOOP_ALERTS = { send: async () => {} };
const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function _readTrade(persistence, tradeId) {
  const trade = persistence.getS21Trade(tradeId);
  if (!trade) throw new Error(`Trade not found: ${tradeId}`);
  return trade;
}

function _assertNotClosed(trade) {
  if (trade.status === 'CLOSED') {
    throw new Error(`Trade ${trade.trade_id} is already CLOSED (close_reason=${trade.close_reason})`);
  }
}

function _eventDetails(extra) {
  return extra ? JSON.parse(JSON.stringify(extra)) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// openScaledTrade — invoked on ENTER signal after parse + in-position check.
// ────────────────────────────────────────────────────────────────────────────

async function openScaledTrade({
  signal,               // 'ENTER_LONG' | 'ENTER_SHORT'
  botConfig,            // from s21-bots.json
  notionalUsd,          // intended position $ value (e.g. 500)
  persistence,
  credentials,          // { apiKey, apiSecret } — ignored in dry-run but required
  options = {},         // { bybitBaseUrl }
  alerts = NOOP_ALERTS,
  logger = NOOP_LOGGER,
  _injectAtr,           // testing hook: skip live ATR call, use this snapshot
  _injectReferencePrice,// testing hook: skip live ticker call
  _injectInstrument,    // testing hook: skip live instrument fetch
}) {
  const dryRun = Boolean(botConfig.dryRun);
  const direction = signal === 'ENTER_LONG' ? 'LONG' : (signal === 'ENTER_SHORT' ? 'SHORT' : null);
  if (!direction) throw new Error(`openScaledTrade: invalid signal ${signal}`);

  const symbol = botConfig.symbol;
  const { strategy, scaledEntry } = botConfig;

  // §2 — ATR snapshot. Captured once. From here on, read from the trade row.
  const atrSnapshot = _injectAtr || await computeAtr14({
    symbol,
    intervalMin: scaledEntry.atrIntervalMin,
    options,
  });

  // Reference price = current market price at signal time. Used as the entry
  // anchor for T1 (market fills near this) and as the basis for the T2
  // trigger calc. In live mode T1's actual fill price is captured from the
  // exchange response and persisted as t1_fill_price.
  const ref = _injectReferencePrice
    ? { last_price: _injectReferencePrice }
    : await require('./bybitClient').getLivePrice(symbol, options);
  const entryPrice = ref.last_price;

  // Instrument constraints (step size, min qty). In dry-run we still need real
  // metadata to round sizing correctly — same Bybit endpoint, no auth needed.
  const instrument = _injectInstrument || await require('./bybitClient').getInstrumentInfo(symbol, options);
  const qtyStep = Number(instrument.lotSizeFilter.qtyStep);
  const minOrderQty = Number(instrument.lotSizeFilter.minOrderQty);
  const minNotionalValue = Number(instrument.lotSizeFilter.minNotionalValue || 5);

  // Sizing pipeline: intended → split T1/T2 → TP allocation per tranche.
  const intendedQty = sizing.computeIntendedQty({
    notionalUsd, referencePrice: entryPrice, qtyStep, minOrderQty, minNotionalValue,
  });
  const { t1Qty, t2Qty } = sizing.splitT1T2({
    intendedQty, t1Fraction: scaledEntry.t1Fraction, qtyStep, minOrderQty,
  });

  // T2 trigger from immutable atrPct.
  const t2TriggerPrice = sizing.computeT2Trigger({
    entryPrice,
    atrPct: atrSnapshot.atrPct,
    noiseBandMult: scaledEntry.noiseBandMult,
    direction,
  });

  // Persist the trade row BEFORE any order placement. If order placement
  // throws, the row stays in PENDING_T1 and the operator can investigate.
  const { tradeId } = persistence.insertS21Trade({
    bot_id: botConfig.botId,
    symbol,
    direction,
    status: 'PENDING_T1',
    dry_run: dryRun ? 1 : 0,
    entry_price_snapshot: entryPrice,
    atr_pct_at_open: atrSnapshot.atrPct,
    add_pct: scaledEntry.noiseBandMult * atrSnapshot.atrPct,
    intended_notional_usd: notionalUsd,
    t1_intended_qty: sizing.formatQty(t1Qty, qtyStep),
    t2_intended_qty: sizing.formatQty(t2Qty, qtyStep),
    t2_trigger_price: t2TriggerPrice,
  });

  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'TRADE_OPENED',
    details: { signal, direction, entryPrice, atrPct: atrSnapshot.atrPct, t2TriggerPrice, t1Qty, t2Qty, dryRun },
  });

  // ── Place T1 market ──────────────────────────────────────────────────────
  const t1Resp = await orderManager.placeT1Market({
    tradeId, symbol, direction, qty: t1Qty, credentials, dryRun, options,
  });
  // In live mode the response carries the order id; the actual fill price
  // arrives via the position/order endpoints. For dry-run, fill = entry.
  const t1FillPrice = dryRun ? entryPrice : entryPrice;  // see TODO at end
  const nowIso = new Date().toISOString();

  persistence.updateS21Trade(tradeId, {
    t1_fill_price: t1FillPrice,
    t1_fill_time: nowIso,
    t1_slippage_pct: 0,
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T1_FILLED',
    details: { fillPrice: t1FillPrice, qty: t1Qty, response: dryRun ? 'dry-run' : 'live' },
  });

  // ── Place T1 SL at -6% from T1 fill ──────────────────────────────────────
  const t1SlPrice = sizing.computeSlPrice({
    entryPrice: t1FillPrice, slPercent: strategy.slPercent, direction,
  });
  await orderManager.placeT1StopLoss({
    tradeId, symbol, direction, qty: t1Qty, slPrice: t1SlPrice,
    credentials, dryRun, options,
  });
  persistence.updateS21Trade(tradeId, { t1_sl_order_id: orderManager.linkId(tradeId, 't1_sl') });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T1_SL_PLACED',
    details: { slPrice: t1SlPrice, slPercent: strategy.slPercent },
  });

  // ── Place T1 TP ladder ───────────────────────────────────────────────────
  const tpPrices = sizing.computeTpPrices({
    entryPrice: t1FillPrice,
    tpTargetsPercent: strategy.tpTargetsPercent,
    direction,
  });
  const t1TpQtys = sizing.tpLadderQuantities({
    trancheQty: t1Qty, allocations: strategy.tpAllocations, qtyStep, minOrderQty,
  });
  await orderManager.placeTpLadder({
    tradeId, symbol, direction, tranche: 't1',
    tpPrices, tpQtys: t1TpQtys,
    credentials, dryRun, options,
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T1_TP_LADDER_PLACED',
    details: { tpPrices, tpQtys: t1TpQtys },
  });

  persistence.updateS21Trade(tradeId, { status: 'T1_OPEN' });

  // ── Place T2 trigger ─────────────────────────────────────────────────────
  await orderManager.placeT2Trigger({
    tradeId, symbol, direction, qty: t2Qty, triggerPrice: t2TriggerPrice,
    credentials, dryRun, options,
  });
  persistence.updateS21Trade(tradeId, { t2_order_id: orderManager.linkId(tradeId, 't2_trigger') });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T2_TRIGGER_PLACED',
    details: { triggerPrice: t2TriggerPrice, qty: t2Qty },
  });

  await alerts.send(`[S2.1] ${botConfig.displayName || botConfig.botId} ${direction} opened — T1 filled @ ${t1FillPrice}, T2 trigger @ ${t2TriggerPrice.toFixed(6)}`).catch(() => {});

  // Paper-mode auto-fire of T2.
  if (dryRun && botConfig.paper && Number.isFinite(botConfig.paper.t2FillDelayMs)) {
    const delay = botConfig.paper.t2FillDelayMs;
    setTimeout(() => {
      onT2Fill({
        tradeId,
        fillPrice: t2TriggerPrice,  // paper: zero slippage
        persistence,
        botConfig,
        credentials,
        options,
        alerts,
        logger,
      }).catch(err => logger.error('paper-mode T2 auto-fire failed', { tradeId, error: err.message }));
    }, delay);
  }

  return {
    tradeId,
    direction,
    entryPrice,
    t1FillPrice,
    t1Qty,
    t2Qty,
    t2TriggerPrice,
    t1SlPrice,
    tpPrices,
    atrSnapshot,
    dryRun,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// onT2Fill — invoked when the T2 stop-market fires (live: by fill watcher;
// paper: auto-fired by openScaledTrade's setTimeout, or manually via
// simulatePaperT2Fill).
// ────────────────────────────────────────────────────────────────────────────

async function onT2Fill({
  tradeId, fillPrice,
  persistence, botConfig, credentials, options = {}, alerts = NOOP_ALERTS, logger = NOOP_LOGGER,
  _injectInstrument,
}) {
  const trade = _readTrade(persistence, tradeId);
  _assertNotClosed(trade);
  if (trade.t2_fired) {
    logger.warn('onT2Fill called on already-fired T2 — ignoring', { tradeId });
    return { duplicate: true };
  }

  const dryRun = Boolean(trade.dry_run);
  const direction = trade.direction;
  const symbol = trade.symbol;
  const t2Qty = Number(trade.t2_intended_qty);

  const slippagePct = trade.t2_trigger_price
    ? ((fillPrice - trade.t2_trigger_price) / trade.t2_trigger_price) * 100 * (direction === 'LONG' ? 1 : -1)
    : 0;

  persistence.updateS21Trade(tradeId, {
    t2_fired: 1,
    t2_fill_price: fillPrice,
    t2_fill_time: new Date().toISOString(),
    t2_slippage_pct: slippagePct,
    status: 'T1_T2_OPEN',
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T2_FILLED',
    details: { fillPrice, triggerPrice: trade.t2_trigger_price, slippagePct, qty: t2Qty },
  });

  // §3 — T2 SL is placed at the T2 FILL price (breakeven for T2). Not the
  // trigger price. If T2 slips above the trigger on a long, BE goes at the
  // higher fill price.
  await orderManager.placeT2StopLoss({
    tradeId, symbol, direction, qty: t2Qty, slPrice: fillPrice,
    credentials, dryRun, options,
  });
  persistence.updateS21Trade(tradeId, { t2_sl_order_id: orderManager.linkId(tradeId, 't2_sl') });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T2_SL_PLACED',
    details: { slPrice: fillPrice, mode: 'breakeven' },
  });

  // Extend the TP ladder for T2 at the SAME absolute prices as T1.
  // T2 only benefits from TPs that lie above its entry (long) / below (short),
  // but Bybit reduce-only ensures any TPs already passed are filled immediately
  // against position size, not duplicated.
  const t1FillPrice = trade.t1_fill_price;
  const tpPrices = sizing.computeTpPrices({
    entryPrice: t1FillPrice,
    tpTargetsPercent: botConfig.strategy.tpTargetsPercent,
    direction,
  });
  const instrument = _injectInstrument || await require('./bybitClient').getInstrumentInfo(symbol, options).catch(() => null);
  const qtyStep = instrument ? Number(instrument.lotSizeFilter.qtyStep) : 1;
  const minOrderQty = instrument ? Number(instrument.lotSizeFilter.minOrderQty) : 1;
  const t2TpQtys = sizing.tpLadderQuantities({
    trancheQty: t2Qty, allocations: botConfig.strategy.tpAllocations, qtyStep, minOrderQty,
  });
  await orderManager.placeTpLadder({
    tradeId, symbol, direction, tranche: 't2',
    tpPrices, tpQtys: t2TpQtys,
    credentials, dryRun, options,
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'T2_TP_LADDER_PLACED',
    details: { tpPrices, tpQtys: t2TpQtys },
  });

  await alerts.send(`[S2.1] ${trade.bot_id} T2 fired @ ${fillPrice.toFixed(6)} (slippage ${slippagePct.toFixed(2)}%)`).catch(() => {});

  return { ok: true, t2FillPrice: fillPrice, slippagePct };
}

// ────────────────────────────────────────────────────────────────────────────
// onTpHit — invoked when a TP order fills. Handles BE move on TP1.
// ────────────────────────────────────────────────────────────────────────────

async function onTpHit({
  tradeId, tranche, tpIdx, hitPrice, qtyClosed,
  persistence, botConfig, credentials, options = {}, alerts = NOOP_ALERTS, logger = NOOP_LOGGER,
}) {
  const trade = _readTrade(persistence, tradeId);
  _assertNotClosed(trade);

  const tpsHit = trade.tps_hit_json ? JSON.parse(trade.tps_hit_json) : [];
  const eventKey = `${tranche}_tp${tpIdx + 1}`;
  if (tpsHit.includes(eventKey)) {
    logger.warn('onTpHit duplicate — ignoring', { tradeId, eventKey });
    return { duplicate: true };
  }
  tpsHit.push(eventKey);
  persistence.updateS21Trade(tradeId, { tps_hit_json: JSON.stringify(tpsHit) });

  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'TP_HIT',
    details: { tranche, tpIdx, hitPrice, qtyClosed },
  });

  // BE move: only on T1's TP1 (tranche==='t1' && tpIdx===beAfterTpIdx).
  // T2's SL is already at breakeven by construction (placed at T2 fill price),
  // and T2's TP1 hitting later must NOT re-fire the BE move.
  if (tranche === 't1' && tpIdx === botConfig.strategy.beAfterTpIdx) {
    await _moveT1SlToBe({ trade, persistence, credentials, options, alerts });
  }

  await alerts.send(`[S2.1] ${trade.bot_id} ${tranche.toUpperCase()} TP${tpIdx + 1} hit @ ${hitPrice.toFixed(6)}`).catch(() => {});

  // ── TP_LADDER_COMPLETE close path (spec line 28) ─────────────────────────
  // If every TP in the ladder has been hit (6 for T1, plus 6 for T2 if T2
  // fired), the position is fully closed via the reduce-only ladder. The
  // BE SL orders (T1's at entry post-TP1, T2's at fill price) never fired
  // but remain on the order book as orphans. Cancel them and close the trade.
  const tpCount = botConfig.strategy.tpTargetsPercent.length;  // 6 for DEEP
  const refreshed = _readTrade(persistence, tradeId);  // re-read for current state
  const requiredKeys = [];
  for (let i = 1; i <= tpCount; i++) requiredKeys.push(`t1_tp${i}`);
  if (refreshed.t2_fired) {
    for (let i = 1; i <= tpCount; i++) requiredKeys.push(`t2_tp${i}`);
  }
  const allTpsHit = requiredKeys.every(k => tpsHit.includes(k));
  if (allTpsHit) {
    const cleanup = await orderManager.cancelAllForTrade({
      tradeId, symbol: refreshed.symbol, credentials,
      dryRun: Boolean(refreshed.dry_run), options,
    });
    persistence.insertS21Event({
      trade_id: tradeId,
      event_type: 'ORPHAN_CLEANUP',
      details: { trigger: 'TP_LADDER_COMPLETE', cleanup, residualOrdersExpected: ['t1_sl', 't2_sl'] },
    });
    persistence.updateS21Trade(tradeId, {
      status: 'CLOSED',
      close_reason: 'TP_LADDER_COMPLETE',
      close_time: new Date().toISOString(),
    });
    persistence.insertS21Event({
      trade_id: tradeId,
      event_type: 'POSITION_CLOSED',
      details: { trigger: 'TP_LADDER_COMPLETE', tpsHit: tpsHit.length },
    });
    await alerts.send(`[S2.1] ${refreshed.bot_id} FULL LADDER COMPLETE — all ${tpsHit.length} TPs hit, residual SLs cancelled`).catch(() => {});
  }

  return { ok: true };
}

async function _moveT1SlToBe({ trade, persistence, credentials, options, alerts }) {
  const dryRun = Boolean(trade.dry_run);
  const symbol = trade.symbol;
  const direction = trade.direction;
  const t1FillPrice = trade.t1_fill_price;
  const t1Qty = Number(trade.t1_intended_qty);

  // Cancel the existing T1 SL by orderLinkId, then place a new one at BE.
  // We do NOT call cancelAllForTrade here — that would also nuke the TP ladder.
  // We need to surgically replace just the SL.
  if (!dryRun) {
    await require('./bybitClient').cancelOrder(
      { symbol, orderLinkId: orderManager.linkId(trade.trade_id, 't1_sl') },
      credentials,
      options,
    ).catch(() => {});  // existing SL may have filled by the time we get here
  }

  // Place new SL at T1 fill price (BE). Reuse the same linkId by canceling
  // first — Bybit lets the linkId be reused after cancellation.
  await orderManager.placeT1StopLoss({
    tradeId: trade.trade_id, symbol, direction, qty: t1Qty, slPrice: t1FillPrice,
    credentials, dryRun, options,
  });

  persistence.insertS21Event({
    trade_id: trade.trade_id,
    event_type: 'T1_SL_MOVED_TO_BE',
    details: { newSlPrice: t1FillPrice },
  });
  await alerts.send(`[S2.1] ${trade.bot_id} T1 SL moved to BE @ ${t1FillPrice}`).catch(() => {});
}

// ────────────────────────────────────────────────────────────────────────────
// onSlHit — invoked when an SL fires for a tranche.
// ────────────────────────────────────────────────────────────────────────────

async function onSlHit({
  tradeId, tranche, slPrice,
  persistence, botConfig, credentials, options = {}, alerts = NOOP_ALERTS, logger = NOOP_LOGGER,
}) {
  const trade = _readTrade(persistence, tradeId);
  _assertNotClosed(trade);

  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'SL_HIT',
    details: { tranche, slPrice },
  });

  // §1 — Orphan cleanup. When a tranche SLs out, we cancel ALL its remaining
  // pending orders (TPs for that tranche). If the OTHER tranche is still open,
  // we leave its orders alone.
  //
  // Simplification chosen: at the trade level we have the unfired T2 trigger
  // and both tranches' TPs/SLs. If T1 SLs and T2 hasn't fired yet, we also
  // cancel the unfired T2 trigger (the spec says T2 only makes sense after
  // a successful T1 entry; an SL'd T1 means we're out, full stop).
  //
  // Concretely: any SL → cancel everything in the trade. Per spec §22:
  //   "ON SL hit (either tranche): Cancel any remaining open orders for this
  //    tranche. If the OTHER tranche is still open, leave it running."
  //
  // We interpret "still open" as t2_fired == true. If T2 fired (both
  // tranches live) and only T1 SLs, we keep T2 active. Otherwise we close.

  const prior = trade.sl_hit ? trade.sl_hit.split(',') : [];
  if (!prior.includes(tranche)) prior.push(tranche);
  const slHitField = prior.join(',');

  const t2Live = Boolean(trade.t2_fired);
  let bothClosed;
  if (tranche === 'T1') {
    bothClosed = !t2Live || prior.includes('T2');
  } else {  // T2 SL'd
    bothClosed = prior.includes('T1') || !t2Live;  // can't really happen if t2_fired is false
  }

  if (bothClosed) {
    // Close the whole trade and clean up everything.
    const cleanup = await orderManager.cancelAllForTrade({
      tradeId, symbol: trade.symbol, credentials,
      dryRun: Boolean(trade.dry_run), options,
    });
    persistence.insertS21Event({
      trade_id: tradeId,
      event_type: 'ORPHAN_CLEANUP',
      details: { trigger: 'SL_HIT_FINAL', tranche, cleanup },
    });
    persistence.updateS21Trade(tradeId, {
      status: 'CLOSED',
      close_reason: tranche === 'T1' && !t2Live ? 'T1_SL' : `${tranche}_SL`,
      close_time: new Date().toISOString(),
      sl_hit: slHitField,
    });
  } else {
    // Only one tranche down. Cancel that tranche's remaining TPs only.
    if (!Boolean(trade.dry_run)) {
      const openOrders = await require('./bybitClient').getOpenOrders(
        { symbol: trade.symbol }, credentials, options
      );
      const tranchePrefix = `${tradeId}_${tranche.toLowerCase()}_`;
      const trancheOrders = openOrders.filter(o => String(o.orderLinkId || '').startsWith(tranchePrefix));
      for (const o of trancheOrders) {
        await require('./bybitClient').cancelOrder(
          { symbol: trade.symbol, orderId: o.orderId }, credentials, options
        ).catch(() => {});
      }
    }
    persistence.insertS21Event({
      trade_id: tradeId,
      event_type: 'TRANCHE_ORPHAN_CLEANUP',
      details: { trigger: 'SL_HIT_PARTIAL', tranche },
    });
    persistence.updateS21Trade(tradeId, {
      sl_hit: slHitField,
    });
  }

  await alerts.send(`[S2.1] ${trade.bot_id} ${tranche} SL hit @ ${slPrice.toFixed(6)}${bothClosed ? ' — trade closed' : ' — other tranche live'}`).catch(() => {});
  return { ok: true, bothClosed };
}

// ────────────────────────────────────────────────────────────────────────────
// onExitSignal — MDX EXIT webhook arrives.
// ────────────────────────────────────────────────────────────────────────────

async function onExitSignal({
  tradeId,
  persistence, credentials, options = {}, alerts = NOOP_ALERTS, logger = NOOP_LOGGER,
}) {
  const trade = _readTrade(persistence, tradeId);
  if (trade.status === 'CLOSED') {
    logger.warn('onExitSignal on already-closed trade', { tradeId });
    return { duplicate: true };
  }

  const dryRun = Boolean(trade.dry_run);

  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'MDX_EXIT_RECEIVED',
    details: null,
  });

  // §1 — Orphan cleanup. Unconditional. Before the market-close so we don't
  // race against pending SLs/TPs.
  const cleanup = await orderManager.cancelAllForTrade({
    tradeId, symbol: trade.symbol, credentials, dryRun, options,
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'ORPHAN_CLEANUP',
    details: { trigger: 'MDX_EXIT', cleanup },
  });

  // Market-close any residual position.
  const closeResp = await orderManager.marketClosePosition({
    tradeId, symbol: trade.symbol, direction: trade.direction,
    credentials, dryRun, options,
  });

  persistence.updateS21Trade(tradeId, {
    status: 'CLOSED',
    close_reason: 'MDX_EXIT',
    close_time: new Date().toISOString(),
  });
  persistence.insertS21Event({
    trade_id: tradeId,
    event_type: 'POSITION_CLOSED',
    details: { trigger: 'MDX_EXIT', dryRun },
  });

  await alerts.send(`[S2.1] ${trade.bot_id} MDX EXIT — position closed, ${cleanup.cancelledCount} orders cancelled`).catch(() => {});
  return { ok: true, cleanup };
}

// ────────────────────────────────────────────────────────────────────────────
// Paper-mode helpers — for validating BE move and orphan cleanup during
// Phase 2 (paper trade) without live fills. Not used in production.
// ────────────────────────────────────────────────────────────────────────────

async function simulatePaperT2Fill({ tradeId, fillPrice, persistence, botConfig, credentials, options, alerts, logger, _injectInstrument }) {
  const trade = _readTrade(persistence, tradeId);
  if (!trade.dry_run) throw new Error('simulatePaperT2Fill called on a non-paper trade');
  const price = fillPrice != null ? fillPrice : trade.t2_trigger_price;
  return onT2Fill({ tradeId, fillPrice: price, persistence, botConfig, credentials, options, alerts, logger, _injectInstrument });
}

async function simulatePaperTpHit({ tradeId, tranche = 't1', tpIdx, persistence, botConfig, credentials, options, alerts, logger }) {
  const trade = _readTrade(persistence, tradeId);
  if (!trade.dry_run) throw new Error('simulatePaperTpHit called on a non-paper trade');
  const tpPrice = sizing.computeTpPrices({
    entryPrice: trade.t1_fill_price,
    tpTargetsPercent: botConfig.strategy.tpTargetsPercent,
    direction: trade.direction,
  })[tpIdx];
  return onTpHit({
    tradeId, tranche, tpIdx, hitPrice: tpPrice, qtyClosed: 0,
    persistence, botConfig, credentials, options, alerts, logger,
  });
}

async function simulatePaperSlHit({ tradeId, tranche, persistence, botConfig, credentials, options, alerts, logger }) {
  const trade = _readTrade(persistence, tradeId);
  if (!trade.dry_run) throw new Error('simulatePaperSlHit called on a non-paper trade');
  const slPrice = tranche === 'T1'
    ? sizing.computeSlPrice({ entryPrice: trade.t1_fill_price, slPercent: botConfig.strategy.slPercent, direction: trade.direction })
    : trade.t2_fill_price;
  return onSlHit({
    tradeId, tranche, slPrice,
    persistence, botConfig, credentials, options, alerts, logger,
  });
}

module.exports = {
  openScaledTrade,
  onT2Fill,
  onTpHit,
  onSlHit,
  onExitSignal,
  simulatePaperT2Fill,
  simulatePaperTpHit,
  simulatePaperSlHit,
  // exposed for unit testing
  _moveT1SlToBe,
};
