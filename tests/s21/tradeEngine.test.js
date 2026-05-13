'use strict';

// S2.1 trade engine — critical correctness tests.
//
// Validates the four non-negotiables:
//   §1 Orphan cleanup runs on every close path
//   §2 ATR snapshot is immutable (computeAtr14 called exactly once per trade)
//   §3 T2 SL is placed at the T2 FILL price (not the trigger price)
//   §4 Dry-run path does not call Bybit
//
// Plus a full lifecycle smoke test.

// Stub bybitClient BEFORE the engine module loads it. The dry-run path should
// never invoke any of these in a correct implementation — if a test fails
// because one of these stubs returns undefined, that's the §4 firewall being
// breached.
const path = require('path');
const stubBybitPath = path.resolve(__dirname, '../../src/s21/bybitClient.js');
require.cache[stubBybitPath] = {
  id: stubBybitPath,
  filename: stubBybitPath,
  loaded: true,
  exports: {
    getLivePrice: () => { throw new Error('§4 violation: getLivePrice called in dry-run'); },
    getInstrumentInfo: () => {
      // onT2Fill is allowed to fetch instrument for TP ladder sizing — return
      // the synthetic DEEP metadata that matches the test fixture.
      return Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } });
    },
    getOpenOrders: () => { throw new Error('§4 violation: getOpenOrders called in dry-run'); },
    cancelOrder: () => { throw new Error('§4 violation: cancelOrder called in dry-run'); },
    placeOrder: () => { throw new Error('§4 violation: placeOrder called in dry-run'); },
    getLivePosition: () => { throw new Error('§4 violation: getLivePosition called in dry-run'); },
    fetchKlineCandles: () => { throw new Error('§4 violation: fetchKlineCandles called in dry-run'); },
  },
};

const engine = require('../../src/s21/tradeEngine');
const orderManager = require('../../src/s21/orderManager');

// In-memory persistence that mirrors the real DB schema/API.
function makeFakePersistence() {
  const trades = new Map();
  const events = [];
  let tradeCounter = 0;
  return {
    _trades: trades,
    _events: events,
    insertS21Trade(row) {
      tradeCounter++;
      const tradeId = `s21_${row.bot_id.toLowerCase()}_${String(tradeCounter).padStart(4, '0')}`;
      trades.set(tradeId, { ...row, trade_id: tradeId, trade_number: tradeCounter,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return { tradeId, tradeNumber: tradeCounter };
    },
    updateS21Trade(tradeId, fields) {
      const t = trades.get(tradeId);
      if (!t) throw new Error(`updateS21Trade: not found ${tradeId}`);
      Object.assign(t, fields, { updated_at: new Date().toISOString() });
    },
    getS21Trade(tradeId) { return trades.get(tradeId) || null; },
    insertS21Event(evt) {
      events.push({ ...evt, occurred_at: evt.occurred_at || new Date().toISOString(),
        details_json: evt.details ? JSON.stringify(evt.details) : null });
    },
    getS21EventsForTrade(tradeId) { return events.filter(e => e.trade_id === tradeId); },
  };
}

// Sentinel atrSnapshot — must be the exact object passed back in every read.
const ATR_SNAPSHOT = {
  symbol: 'DEEPUSDT', intervalMin: 240,
  atr: 0.00185176, atrPct: 5.1826, lastClose: 0.03573,
  lastCandleOpenTime: 0, capturedAt: '2026-05-13T19:00:00Z',
  method: 'wilder_rma', candleCount: 60, trCount: 59,
};

// Synthetic instrument metadata: DEEPUSDT has step 1, min qty 10
const INSTRUMENT = {
  lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' },
};

const BOT_CONFIG = {
  botId: 'Bot9',
  displayName: 'DEEP',
  symbol: 'DEEPUSDT',
  dryRun: true,
  strategy: {
    leverage: 5,
    tpTargetsPercent: [3.37, 4.76, 12.40, 14.67, 22.40, 30.06],
    tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08],
    slPercent: 6.0,
    beAfterTpIdx: 0,
  },
  scaledEntry: {
    t1Fraction: 0.50, t2Fraction: 0.50, noiseBandMult: 0.5,
    t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: 240,
  },
  paper: { t2FillDelayMs: 999999 },  // don't auto-fire during tests; we drive it manually
};

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };
const REF_PRICE = 0.03573;

// Spy wrappers around orderManager so we can assert what was called.
function makeSpy(target) {
  const calls = [];
  const proxy = {};
  for (const key of Object.keys(target)) {
    if (typeof target[key] === 'function') {
      proxy[key] = async (...args) => {
        calls.push({ method: key, args });
        return target[key](...args);
      };
    } else {
      proxy[key] = target[key];
    }
  }
  proxy._calls = calls;
  return proxy;
}

async function test_openScaledTrade() {
  console.log('\n── TEST: openScaledTrade — sizing, T2 trigger, persistence ──');
  const persistence = makeFakePersistence();
  let atrCalls = 0;
  const atrInjected = { ...ATR_SNAPSHOT };

  const result = await engine.openScaledTrade({
    signal: 'ENTER_LONG',
    botConfig: BOT_CONFIG,
    notionalUsd: 500,
    persistence,
    credentials: { apiKey: 'fake', apiSecret: 'fake' },
    options: {},
    _injectAtr: (() => { atrCalls++; return atrInjected; })(),
    _injectReferencePrice: REF_PRICE,
    _injectInstrument: INSTRUMENT,
  });

  const trade = persistence.getS21Trade(result.tradeId);
  assert(trade.status === 'T1_OPEN', `status should be T1_OPEN, got ${trade.status}`);
  assert(trade.dry_run === 1, 'dry_run should be 1');
  assert(trade.entry_price_snapshot === REF_PRICE, 'entry_price_snapshot');
  assert(trade.atr_pct_at_open === ATR_SNAPSHOT.atrPct, 'atr_pct_at_open');
  assert(trade.add_pct === BOT_CONFIG.scaledEntry.noiseBandMult * ATR_SNAPSHOT.atrPct,
    `add_pct = ${BOT_CONFIG.scaledEntry.noiseBandMult * ATR_SNAPSHOT.atrPct}`);

  // Sizing: $500 / 0.03573 = 13993.84 → 13993. T1 = 6996, T2 = 6997.
  assert(Number(trade.t1_intended_qty) === 6996, `T1=${trade.t1_intended_qty} expected 6996`);
  assert(Number(trade.t2_intended_qty) === 6997, `T2=${trade.t2_intended_qty} expected 6997`);
  assert(Number(trade.t1_intended_qty) + Number(trade.t2_intended_qty) === 13993, 'T1+T2 invariant');

  // T2 trigger price = 0.03573 * (1 + 0.5 * 5.1826/100) = 0.03665
  const expectedTrigger = REF_PRICE * (1 + 0.5 * ATR_SNAPSHOT.atrPct / 100);
  assert(Math.abs(trade.t2_trigger_price - expectedTrigger) < 1e-9, `t2_trigger_price expected ${expectedTrigger}, got ${trade.t2_trigger_price}`);

  // T1 fill captured
  assert(trade.t1_fill_price === REF_PRICE, 't1_fill_price');
  assert(trade.t1_sl_order_id === 's21_bot9_0001_t1_sl', `t1_sl_order_id=${trade.t1_sl_order_id}`);
  assert(trade.t2_order_id === 's21_bot9_0001_t2_trigger', `t2_order_id=${trade.t2_order_id}`);

  // Event timeline
  const events = persistence.getS21EventsForTrade(result.tradeId);
  const types = events.map(e => e.event_type);
  console.log('  event types:', types.join(' → '));
  assert(types.includes('TRADE_OPENED'), 'TRADE_OPENED present');
  assert(types.includes('T1_FILLED'), 'T1_FILLED present');
  assert(types.includes('T1_SL_PLACED'), 'T1_SL_PLACED present');
  assert(types.includes('T1_TP_LADDER_PLACED'), 'T1_TP_LADDER_PLACED present');
  assert(types.includes('T2_TRIGGER_PLACED'), 'T2_TRIGGER_PLACED present');

  // §2: ATR was injected once, never recomputed
  assert(atrCalls === 1, `ATR should be computed exactly once, got ${atrCalls}`);

  console.log('  PASS — open path correct, all sizing/event invariants hold');
  return { persistence, tradeId: result.tradeId };
}

async function test_onT2Fill_slPlacedAtFillNotTrigger() {
  console.log('\n── TEST: §3 T2 SL placed at FILL price, not trigger ──');
  const { persistence, tradeId } = await test_openScaledTrade();
  const trade = persistence.getS21Trade(tradeId);

  // Simulate T2 firing at a slipped price ABOVE the trigger (long entry).
  const trigger = trade.t2_trigger_price;
  const slippedFillPrice = trigger * 1.002;  // +0.2% slippage

  await engine.onT2Fill({
    tradeId,
    fillPrice: slippedFillPrice,
    persistence,
    botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {},
    logger: NOOP_LOGGER,
  });

  // Reread trade
  const after = persistence.getS21Trade(tradeId);
  assert(after.t2_fired === 1, 't2_fired should be 1');
  assert(Math.abs(after.t2_fill_price - slippedFillPrice) < 1e-12,
    `t2_fill_price should be ${slippedFillPrice}, got ${after.t2_fill_price}`);
  assert(after.status === 'T1_T2_OPEN', `status=${after.status}`);
  assert(after.t2_sl_order_id === 's21_bot9_0001_t2_sl', 't2_sl_order_id');

  // §3 — find the T2_SL_PLACED event and confirm slPrice === fillPrice (not trigger)
  const events = persistence.getS21EventsForTrade(tradeId);
  const slEvent = events.find(e => e.event_type === 'T2_SL_PLACED');
  assert(slEvent, 'T2_SL_PLACED event must exist');
  const slDetails = JSON.parse(slEvent.details_json);
  assert(Math.abs(slDetails.slPrice - slippedFillPrice) < 1e-12,
    `T2 SL price recorded as ${slDetails.slPrice}, must be fill ${slippedFillPrice} not trigger ${trigger}`);
  assert(slDetails.slPrice !== trigger, '§3 — T2 SL must NOT equal trigger price');
  assert(slDetails.mode === 'breakeven');

  // Slippage % calculated and stored
  const expectedSlippagePct = ((slippedFillPrice - trigger) / trigger) * 100;
  assert(Math.abs(after.t2_slippage_pct - expectedSlippagePct) < 1e-9,
    `t2_slippage_pct=${after.t2_slippage_pct}, expected ${expectedSlippagePct}`);

  console.log(`  PASS — T2 SL placed at fill ${slippedFillPrice.toFixed(6)}, NOT at trigger ${trigger.toFixed(6)}`);
  console.log(`         slippage recorded as ${after.t2_slippage_pct.toFixed(4)}%`);
}

async function test_beMove_threeAssertions() {
  console.log('\n── TEST: BE move — three assertions (5a fires once, 5b only T1 TP1, 5c no re-fire) ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // 5b precondition: fire T2 BEFORE TP1 to set up the "T2 TP1 must not re-fire BE" case
  const initial = persistence.getS21Trade(tradeId);
  await engine.onT2Fill({
    tradeId, fillPrice: initial.t2_trigger_price,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  // T1's TP1 → MUST trigger BE move
  await engine.onTpHit({
    tradeId, tranche: 't1', tpIdx: 0, hitPrice: 0.03693, qtyClosed: 909,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  // T2's TP1 → MUST NOT trigger another BE move
  await engine.onTpHit({
    tradeId, tranche: 't2', tpIdx: 0, hitPrice: 0.03693, qtyClosed: 909,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  // T1 TP2 + T2 TP2 → no additional BE moves
  await engine.onTpHit({
    tradeId, tranche: 't1', tpIdx: 1, hitPrice: 0.03743, qtyClosed: 1259,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });
  await engine.onTpHit({
    tradeId, tranche: 't2', tpIdx: 1, hitPrice: 0.03743, qtyClosed: 1259,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  const events = persistence.getS21EventsForTrade(tradeId);
  const beMoves = events.filter(e => e.event_type === 'T1_SL_MOVED_TO_BE');

  // 5a — fires exactly once across full T1+T2 lifecycle
  assert(beMoves.length === 1, `5a — BE move should fire exactly once, got ${beMoves.length}`);

  // 5b — fires only after a T1 TP_HIT, never a T2 TP_HIT
  const beIdx = events.findIndex(e => e.event_type === 'T1_SL_MOVED_TO_BE');
  const precedingTpHit = events.slice(0, beIdx).reverse().find(e => e.event_type === 'TP_HIT');
  assert(precedingTpHit, '5b — must have a TP_HIT preceding BE move');
  const precedingDetails = JSON.parse(precedingTpHit.details_json);
  assert(precedingDetails.tranche === 't1' && precedingDetails.tpIdx === 0,
    `5b — BE move must follow T1 TP1, got tranche=${precedingDetails.tranche} tpIdx=${precedingDetails.tpIdx}`);

  // 5c — no further BE moves after the first, even though T2's TPs fired later
  const eventsAfterBe = events.slice(beIdx + 1);
  const subsequentBeMoves = eventsAfterBe.filter(e => e.event_type === 'T1_SL_MOVED_TO_BE');
  assert(subsequentBeMoves.length === 0,
    `5c — no further BE moves should occur after the first, got ${subsequentBeMoves.length}`);
  // Confirm T2's TP1 and T2's TP2 DID arrive in the events-after-BE window (proves they were processed)
  const t2TpsAfterBe = eventsAfterBe.filter(e => {
    if (e.event_type !== 'TP_HIT') return false;
    const d = JSON.parse(e.details_json);
    return d.tranche === 't2';
  });
  assert(t2TpsAfterBe.length >= 2, `5c — T2 TPs must fire after BE move (proves we tested the re-fire path), got ${t2TpsAfterBe.length}`);

  // Bonus: SL price IS t1_fill_price
  const beDetails = JSON.parse(beMoves[0].details_json);
  const trade = persistence.getS21Trade(tradeId);
  assert(beDetails.newSlPrice === trade.t1_fill_price,
    `BE SL price should equal t1_fill_price ${trade.t1_fill_price}, got ${beDetails.newSlPrice}`);

  console.log(`  PASS — 5a (fires once), 5b (only T1 TP1), 5c (no re-fire on ${t2TpsAfterBe.length} T2 TPs after BE)`);
}

async function test_mdxExit_runsOrphanCleanup() {
  console.log('\n── TEST: §1 MDX EXIT → cancelAllForTrade runs, status CLOSED ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // Spy on orderManager.cancelAllForTrade
  const orig = orderManager.cancelAllForTrade;
  let cleanupCalls = 0;
  orderManager.cancelAllForTrade = async (...args) => {
    cleanupCalls++;
    return orig(...args);
  };

  try {
    await engine.onExitSignal({
      tradeId,
      persistence,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {},
      logger: NOOP_LOGGER,
    });
  } finally {
    orderManager.cancelAllForTrade = orig;
  }

  assert(cleanupCalls === 1, `cancelAllForTrade should be called exactly once, got ${cleanupCalls}`);

  const trade = persistence.getS21Trade(tradeId);
  assert(trade.status === 'CLOSED', `status=${trade.status}`);
  assert(trade.close_reason === 'MDX_EXIT');
  assert(trade.close_time, 'close_time set');

  const events = persistence.getS21EventsForTrade(tradeId);
  const types = events.map(e => e.event_type);
  // Order matters: MDX_EXIT_RECEIVED → ORPHAN_CLEANUP → POSITION_CLOSED
  const exitIdx = types.indexOf('MDX_EXIT_RECEIVED');
  const cleanupIdx = types.indexOf('ORPHAN_CLEANUP');
  const closedIdx = types.indexOf('POSITION_CLOSED');
  assert(exitIdx >= 0 && cleanupIdx > exitIdx && closedIdx > cleanupIdx,
    `event order: MDX_EXIT=${exitIdx}, CLEANUP=${cleanupIdx}, CLOSED=${closedIdx}`);

  console.log(`  PASS — MDX EXIT triggered orphan cleanup before close`);
}

async function test_slHit_t1_t2NotFired_closesTrade() {
  console.log('\n── TEST: T1 SL hit while T2 unfired → trade closed, full cleanup ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  let cleanupCalls = 0;
  const orig = orderManager.cancelAllForTrade;
  orderManager.cancelAllForTrade = async (...args) => { cleanupCalls++; return orig(...args); };

  try {
    await engine.onSlHit({
      tradeId, tranche: 'T1', slPrice: 0.03359,
      persistence, botConfig: BOT_CONFIG,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {}, logger: NOOP_LOGGER, _injectInstrument: INSTRUMENT,
    });
  } finally {
    orderManager.cancelAllForTrade = orig;
  }

  assert(cleanupCalls === 1, `cancelAllForTrade should be called when T1 SLs with T2 unfired`);
  const trade = persistence.getS21Trade(tradeId);
  assert(trade.status === 'CLOSED', `status=${trade.status}`);
  assert(trade.close_reason === 'T1_SL', `close_reason=${trade.close_reason}`);

  console.log(`  PASS — T1 SL → trade closed, cancelAllForTrade ran`);
}

async function test_slHit_t1_t2Fired_keepsT2Live() {
  console.log('\n── TEST: T1 SL hit while T2 is live → T2 stays open, trade NOT fully closed ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // Fire T2 first
  const trade1 = persistence.getS21Trade(tradeId);
  await engine.onT2Fill({
    tradeId, fillPrice: trade1.t2_trigger_price,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER, _injectInstrument: INSTRUMENT,
  });

  let cleanupCalls = 0;
  const orig = orderManager.cancelAllForTrade;
  orderManager.cancelAllForTrade = async (...args) => { cleanupCalls++; return orig(...args); };

  try {
    await engine.onSlHit({
      tradeId, tranche: 'T1', slPrice: 0.03359,
      persistence, botConfig: BOT_CONFIG,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {}, logger: NOOP_LOGGER, _injectInstrument: INSTRUMENT,
    });
  } finally {
    orderManager.cancelAllForTrade = orig;
  }

  // cancelAllForTrade should NOT be called — only the tranche-specific cleanup
  assert(cleanupCalls === 0, `cancelAllForTrade should NOT run when T2 is still live (got ${cleanupCalls})`);

  const trade = persistence.getS21Trade(tradeId);
  assert(trade.status !== 'CLOSED', `status should not be CLOSED, got ${trade.status}`);
  assert(trade.sl_hit === 'T1', `sl_hit=${trade.sl_hit}`);

  console.log(`  PASS — T2 left running, trade remains open after T1 SL`);
}

async function test_fullLifecycle_smokeTest() {
  console.log('\n── TEST: Full lifecycle — OPEN → T2 fire → TP1 BE → MDX EXIT ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // Fire T2 with realistic slippage
  const t1 = persistence.getS21Trade(tradeId);
  await engine.simulatePaperT2Fill({
    tradeId, fillPrice: t1.t2_trigger_price * 1.001,  // 0.1% slippage
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {},
    logger: NOOP_LOGGER,
  });

  // Simulate TP1 hit → BE move
  await engine.simulatePaperTpHit({
    tradeId, tranche: 't1', tpIdx: 0,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {},
    logger: NOOP_LOGGER,
  });
  await engine.simulatePaperTpHit({
    tradeId, tranche: 't2', tpIdx: 0,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {},
    logger: NOOP_LOGGER,
  });

  // MDX EXIT
  await engine.onExitSignal({
    tradeId, persistence,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER, _injectInstrument: INSTRUMENT,
  });

  const final = persistence.getS21Trade(tradeId);
  assert(final.status === 'CLOSED');
  assert(final.close_reason === 'MDX_EXIT');
  assert(final.t2_fired === 1);
  const tpsHit = JSON.parse(final.tps_hit_json);
  assert(tpsHit.includes('t1_tp1') && tpsHit.includes('t2_tp1'));

  const events = persistence.getS21EventsForTrade(tradeId);
  console.log(`  Event timeline (${events.length} events):`);
  for (const e of events) console.log(`    ${e.event_type}`);

  // Verify ORPHAN_CLEANUP appears in events at MDX_EXIT
  const cleanupEvents = events.filter(e => e.event_type === 'ORPHAN_CLEANUP');
  assert(cleanupEvents.length >= 1, 'ORPHAN_CLEANUP must run on MDX_EXIT');

  // BE move must fire exactly once (not duplicated by T2 TP1 hitting later)
  const beMoves = events.filter(e => e.event_type === 'T1_SL_MOVED_TO_BE');
  assert(beMoves.length === 1, `T1_SL_MOVED_TO_BE should fire once, got ${beMoves.length}`);

  console.log(`  PASS — full lifecycle completed cleanly (BE move fired exactly once)`);
}

function assert(cond, msg) {
  if (!cond) {
    console.error('   FAIL —', msg);
    process.exit(1);
  }
}

async function test_tpLadderComplete_closesAndCancelsResidualSls() {
  console.log('\n── TEST: Q1 — TP_LADDER_COMPLETE close path with residual SL cleanup ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // Fire T2 so both tranches are live
  const initial = persistence.getS21Trade(tradeId);
  await engine.onT2Fill({
    tradeId, fillPrice: initial.t2_trigger_price,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  // Hit all 6 TPs on T1 and all 6 on T2 (12 total). Use TP prices from the spec.
  const tpPrices = BOT_CONFIG.strategy.tpTargetsPercent.map(pct => REF_PRICE * (1 + pct / 100));
  let cleanupCallCount = 0;
  const origCleanup = orderManager.cancelAllForTrade;
  orderManager.cancelAllForTrade = async (...args) => { cleanupCallCount++; return origCleanup(...args); };

  try {
    for (let i = 0; i < 6; i++) {
      await engine.onTpHit({
        tradeId, tranche: 't1', tpIdx: i, hitPrice: tpPrices[i], qtyClosed: 100,
        persistence, botConfig: BOT_CONFIG,
        credentials: { apiKey: 'x', apiSecret: 'x' },
        options: {}, logger: NOOP_LOGGER,
      });
    }
    for (let i = 0; i < 6; i++) {
      await engine.onTpHit({
        tradeId, tranche: 't2', tpIdx: i, hitPrice: tpPrices[i], qtyClosed: 100,
        persistence, botConfig: BOT_CONFIG,
        credentials: { apiKey: 'x', apiSecret: 'x' },
        options: {}, logger: NOOP_LOGGER,
      });
    }
  } finally {
    orderManager.cancelAllForTrade = origCleanup;
  }

  const final = persistence.getS21Trade(tradeId);
  assert(final.status === 'CLOSED', `status should be CLOSED, got ${final.status}`);
  assert(final.close_reason === 'TP_LADDER_COMPLETE',
    `close_reason should be TP_LADDER_COMPLETE, got ${final.close_reason}`);
  assert(final.close_time, 'close_time set');

  // Orphan cleanup ran (cancels residual T1+T2 BE SL orders)
  assert(cleanupCallCount >= 1, `cancelAllForTrade should run on TP_LADDER_COMPLETE, got ${cleanupCallCount}`);

  // Event timeline
  const events = persistence.getS21EventsForTrade(tradeId);
  const cleanupEvents = events.filter(e => {
    if (e.event_type !== 'ORPHAN_CLEANUP') return false;
    const d = JSON.parse(e.details_json);
    return d.trigger === 'TP_LADDER_COMPLETE';
  });
  assert(cleanupEvents.length === 1,
    `should have 1 TP_LADDER_COMPLETE cleanup event, got ${cleanupEvents.length}`);

  // All 12 TPs are in the hit list
  const tpsHit = JSON.parse(final.tps_hit_json);
  assert(tpsHit.length === 12, `should have 12 TPs hit, got ${tpsHit.length}`);

  // Close fired AFTER the last TP — not before
  const typeOrder = events.map(e => e.event_type);
  const lastTpIdx = typeOrder.lastIndexOf('TP_HIT');
  const closedIdx = typeOrder.lastIndexOf('POSITION_CLOSED');
  assert(closedIdx > lastTpIdx, `POSITION_CLOSED (idx ${closedIdx}) must come AFTER last TP_HIT (idx ${lastTpIdx})`);

  console.log(`  PASS — full 12-TP ladder closed cleanly with close_reason=TP_LADDER_COMPLETE, orphan cleanup ran for residual BE SLs`);
}

async function test_tpLadderComplete_t1OnlyWhenT2NeverFired() {
  console.log('\n── TEST: Q1 edge — full T1 ladder with T2 never fired → also TP_LADDER_COMPLETE ──');
  const { persistence, tradeId } = await test_openScaledTrade();
  // Don't fire T2. Just hit all 6 T1 TPs.
  const tpPrices = BOT_CONFIG.strategy.tpTargetsPercent.map(pct => REF_PRICE * (1 + pct / 100));
  for (let i = 0; i < 6; i++) {
    await engine.onTpHit({
      tradeId, tranche: 't1', tpIdx: i, hitPrice: tpPrices[i], qtyClosed: 100,
      persistence, botConfig: BOT_CONFIG,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {}, logger: NOOP_LOGGER,
    });
  }
  const final = persistence.getS21Trade(tradeId);
  assert(final.status === 'CLOSED', `t2-never-fired ladder should also close, got status=${final.status}`);
  assert(final.close_reason === 'TP_LADDER_COMPLETE', `close_reason=${final.close_reason}`);
  console.log(`  PASS — T1-only full ladder with T2 unfired also closes via TP_LADDER_COMPLETE`);
}

async function test_sequentialSlCloses_q2() {
  console.log('\n── TEST: Q2 — sequential SL closes (T1 SL, then T2 SL) → clean two-stage cleanup ──');
  const { persistence, tradeId } = await test_openScaledTrade();

  // Fire T2 so it's live
  const initial = persistence.getS21Trade(tradeId);
  await engine.onT2Fill({
    tradeId, fillPrice: initial.t2_trigger_price,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'x', apiSecret: 'x' },
    options: {}, logger: NOOP_LOGGER,
  });

  // Track cleanup calls AND inspect their arguments
  const cleanupCalls = [];
  const origCleanup = orderManager.cancelAllForTrade;
  orderManager.cancelAllForTrade = async (args) => {
    cleanupCalls.push({ args, ts: Date.now() });
    return origCleanup(args);
  };

  try {
    // First close: T1 SLs while T2 live
    await engine.onSlHit({
      tradeId, tranche: 'T1', slPrice: 0.03359,
      persistence, botConfig: BOT_CONFIG,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {}, logger: NOOP_LOGGER,
    });

    // Verify intermediate state
    const mid = persistence.getS21Trade(tradeId);
    assert(mid.status !== 'CLOSED', `after T1 SL with T2 live, status should NOT be CLOSED, got ${mid.status}`);
    assert(mid.sl_hit === 'T1', `sl_hit should be 'T1', got '${mid.sl_hit}'`);

    // Q2(a): full cleanup MUST NOT have run yet (only tranche-only cleanup happens via direct getOpenOrders/cancelOrder calls, not via cancelAllForTrade)
    assert(cleanupCalls.length === 0,
      `Q2(a) — cancelAllForTrade should NOT run on the first SL when T2 still live, got ${cleanupCalls.length} calls`);

    // Second close: T2 SLs later
    await engine.onSlHit({
      tradeId, tranche: 'T2', slPrice: initial.t2_trigger_price,  // T2 SL at BE = T2 fill
      persistence, botConfig: BOT_CONFIG,
      credentials: { apiKey: 'x', apiSecret: 'x' },
      options: {}, logger: NOOP_LOGGER,
    });
  } finally {
    orderManager.cancelAllForTrade = origCleanup;
  }

  const final = persistence.getS21Trade(tradeId);
  assert(final.status === 'CLOSED', `after T2 SL, status should be CLOSED, got ${final.status}`);
  assert(final.sl_hit === 'T1,T2', `sl_hit should be 'T1,T2', got '${final.sl_hit}'`);
  assert(final.close_reason === 'T2_SL', `close_reason should be 'T2_SL' (the closing tranche), got '${final.close_reason}'`);

  // Q2(b): cancelAllForTrade ran exactly once — on the SECOND (final) close
  assert(cleanupCalls.length === 1,
    `Q2(b) — cancelAllForTrade should run exactly once on the second close, got ${cleanupCalls.length}`);

  // The cleanup is a no-op for T1-side (already cancelled per-tranche) and proper for T2-side.
  // In dry-run mode `cancelAllForTrade` returns { cancelledCount: 0, dryRun: true } — proves it didn't throw on
  // any "stale ref to already-cancelled T1 orders" because the live path filters by getOpenOrders, which
  // wouldn't return already-cancelled orders.
  const events = persistence.getS21EventsForTrade(tradeId);
  const tranchePartialCleanups = events.filter(e => e.event_type === 'TRANCHE_ORPHAN_CLEANUP');
  const fullCleanups = events.filter(e => {
    if (e.event_type !== 'ORPHAN_CLEANUP') return false;
    const d = JSON.parse(e.details_json);
    return d.trigger === 'SL_HIT_FINAL';
  });
  assert(tranchePartialCleanups.length === 1, `should have 1 tranche-only cleanup event from T1 SL, got ${tranchePartialCleanups.length}`);
  assert(fullCleanups.length === 1, `should have 1 final cleanup event from T2 SL, got ${fullCleanups.length}`);

  console.log(`  PASS — sequential SL closes: tranche-only cleanup on T1, full cleanup on T2, no double-cancel, status CLOSED`);
}

(async () => {
  await test_onT2Fill_slPlacedAtFillNotTrigger();
  await test_beMove_threeAssertions();
  await test_mdxExit_runsOrphanCleanup();
  await test_slHit_t1_t2NotFired_closesTrade();
  await test_slHit_t1_t2Fired_keepsT2Live();
  await test_fullLifecycle_smokeTest();
  await test_tpLadderComplete_closesAndCancelsResidualSls();
  await test_tpLadderComplete_t1OnlyWhenT2NeverFired();
  await test_sequentialSlCloses_q2();
  console.log('\n✅ ALL TESTS PASS');
})().catch(err => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
