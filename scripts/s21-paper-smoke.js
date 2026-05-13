#!/usr/bin/env node
'use strict';

// S2.1 paper smoke run — fetches real DEEPUSDT 240m candles, computes Wilder
// RMA ATR, runs a full paper-mode trade lifecycle through the engine, exercises
// the fill watcher, and dumps the resulting trade row + event timeline.
//
// Does NOT touch SQLite (uses in-memory persistence with the real schema shape)
// and does NOT make any Bybit calls beyond the public kline fetch for ATR.

const path = require('path');

// Stub bybitClient so the engine + watcher never reach for axios or live calls.
// getInstrumentInfo returns synthetic DEEP metadata; everything else throws on call.
const stubBybitPath = path.resolve(__dirname, '../src/s21/bybitClient.js');
require.cache[stubBybitPath] = {
  id: stubBybitPath, filename: stubBybitPath, loaded: true,
  exports: {
    getLivePrice: () => { throw new Error('§4 violation: getLivePrice called in paper smoke'); },
    getInstrumentInfo: () => Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } }),
    getOpenOrders: () => { throw new Error('§4 violation: getOpenOrders called in paper smoke'); },
    cancelOrder: () => { throw new Error('§4 violation: cancelOrder called in paper smoke'); },
    placeOrder: () => { throw new Error('§4 violation: placeOrder called in paper smoke'); },
    getLivePosition: () => { throw new Error('§4 violation: getLivePosition called in paper smoke'); },
    fetchKlineCandles: () => { throw new Error('§4 violation: fetchKlineCandles called via bybitClient — should be native fetch in this script'); },
    bybitPrivateGet: () => { throw new Error('§4 violation: bybitPrivateGet called in paper smoke'); },
  },
};

const { _trueRange, _filterClosed, _computeAtrWilderRma } = require('../src/s21/atr');
const engine = require('../src/s21/tradeEngine');
const watcher = require('../src/s21/fillWatcher');

const SYMBOL = 'DEEPUSDT';
const INTERVAL_MIN = 240;
const INTERVAL_MS = INTERVAL_MIN * 60 * 1000;
const NOTIONAL_USD = 500;

const BOT_CONFIG = {
  botId: 'Bot9', symbol: SYMBOL, displayName: 'DEEP', dryRun: true,
  strategy: {
    leverage: 5,
    tpTargetsPercent: [3.37, 4.76, 12.40, 14.67, 22.40, 30.06],
    tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08],
    slPercent: 6.0, beAfterTpIdx: 0,
  },
  scaledEntry: {
    t1Fraction: 0.50, t2Fraction: 0.50, noiseBandMult: 0.5,
    t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: INTERVAL_MIN,
  },
  paper: { t2FillDelayMs: 999999 },  // don't auto-fire; we drive manually
};

const LOGGER = console;

// In-memory persistence — same shape as production SQLite-backed buildPersistence
function makePersistence() {
  const trades = new Map();
  const events = [];
  return {
    insertS21Trade(row) {
      const tradeId = `s21_${row.bot_id.toLowerCase()}_${String(trades.size + 1).padStart(4, '0')}`;
      const now = new Date().toISOString();
      trades.set(tradeId, { ...row, trade_id: tradeId, trade_number: trades.size + 1, created_at: now, updated_at: now });
      return { tradeId, tradeNumber: trades.size };
    },
    updateS21Trade(tradeId, fields) {
      Object.assign(trades.get(tradeId), fields, { updated_at: new Date().toISOString() });
    },
    getS21Trade(id) { return trades.get(id) || null; },
    getOpenS21Trades() { return [...trades.values()].filter(t => t.status !== 'CLOSED'); },
    getOpenS21TradesForSymbol(sym) { return [...trades.values()].filter(t => t.symbol === sym && t.status !== 'CLOSED'); },
    insertS21Event(e) {
      events.push({
        id: events.length + 1,
        trade_id: e.trade_id,
        event_type: e.event_type,
        occurred_at: e.occurred_at || new Date().toISOString(),
        details_json: e.details ? JSON.stringify(e.details) : null,
      });
    },
    getS21EventsForTrade(tradeId) { return events.filter(e => e.trade_id === tradeId); },
  };
}

async function pullRealAtr() {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${SYMBOL}&interval=${INTERVAL_MIN}&limit=65`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit error: ${JSON.stringify(data)}`);
  const candles = (data.result?.list || []).slice().reverse().map(r => ({
    t: Number(r[0]), o: Number(r[1]), h: Number(r[2]),
    l: Number(r[3]), c: Number(r[4]), v: Number(r[5]),
  }));
  const now = Date.now();
  const closed = _filterClosed(candles, INTERVAL_MS, now);
  const recent = closed.slice(-60);
  const trs = [];
  for (let i = 1; i < recent.length; i++) trs.push(_trueRange(recent[i], recent[i-1]));
  const atr = _computeAtrWilderRma(trs);
  const lastClose = recent[recent.length-1].c;
  return {
    symbol: SYMBOL, intervalMin: INTERVAL_MIN,
    atr, atrPct: (atr / lastClose) * 100,
    lastClose, lastCandleOpenTime: recent[recent.length-1].t,
    capturedAt: new Date(now).toISOString(),
    method: 'wilder_rma', candleCount: recent.length, trCount: trs.length,
  };
}

(async () => {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  S2.1 PAPER SMOKE RUN');
  console.log('═══════════════════════════════════════════════════════════════');

  // 1. Real ATR from live Bybit mainnet
  console.log('\n[1/8] Fetching live DEEPUSDT 240m candles from Bybit mainnet...');
  const atr = await pullRealAtr();
  console.log(`      ATR: ${atr.atr.toFixed(8)}, atrPct: ${atr.atrPct.toFixed(4)}%, lastClose: ${atr.lastClose}`);
  console.log(`      Last candle opened: ${new Date(atr.lastCandleOpenTime).toISOString()}`);

  const persistence = makePersistence();

  // 2. Open the scaled trade (paper mode)
  console.log('\n[2/8] Opening scaled trade (ENTER_LONG, $500 notional, dryRun=true)...');
  const openResult = await engine.openScaledTrade({
    signal: 'ENTER_LONG',
    botConfig: BOT_CONFIG,
    notionalUsd: NOTIONAL_USD,
    persistence,
    credentials: { apiKey: 'paper', apiSecret: 'paper' },
    options: {},
    logger: LOGGER,
    _injectAtr: atr,
    _injectReferencePrice: atr.lastClose,
    _injectInstrument: { lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } },
  });
  console.log(`      tradeId: ${openResult.tradeId}`);
  console.log(`      T1 qty: ${openResult.t1Qty}, T2 qty: ${openResult.t2Qty}`);
  console.log(`      T2 trigger price: ${openResult.t2TriggerPrice.toFixed(6)}  (entry * (1 + 0.5*atrPct/100))`);
  console.log(`      T1 SL price: ${openResult.t1SlPrice.toFixed(6)}  (entry * 0.94)`);
  console.log(`      TP prices: ${openResult.tpPrices.map(p => p.toFixed(6)).join(', ')}`);

  // 3. Tick the watcher while only a paper trade exists — should be paper_only_skipped_rest
  console.log('\n[3/8] Watcher tick #1 (paper trade open) — should skip Bybit calls...');
  let fetchExecutionsCalls = 0;
  const tick1 = await watcher.tickOnce({
    persistence,
    botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'paper', apiSecret: 'paper' }),
    logger: LOGGER,
    _fetchExecutions: async () => { fetchExecutionsCalls++; return []; },
  });
  console.log(`      mode: ${tick1.mode}, fetchExecutions calls: ${fetchExecutionsCalls} (must be 0)`);
  if (tick1.mode !== 'paper_only_skipped_rest' || fetchExecutionsCalls !== 0) {
    console.error('      FAIL — watcher did not honour §4 firewall'); process.exit(1);
  }

  // 4. Simulate T2 firing at trigger price (zero slippage in paper)
  console.log('\n[4/8] Simulating T2 fill at trigger price...');
  await engine.simulatePaperT2Fill({
    tradeId: openResult.tradeId, fillPrice: openResult.t2TriggerPrice,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'paper', apiSecret: 'paper' },
    options: {}, logger: LOGGER,
  });

  // 5. Simulate TP1 on T1 → BE move
  console.log('\n[5/8] Simulating T1 TP1 hit (must trigger BE move)...');
  await engine.simulatePaperTpHit({
    tradeId: openResult.tradeId, tranche: 't1', tpIdx: 0,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'paper', apiSecret: 'paper' },
    options: {}, logger: LOGGER,
  });

  // 6. Simulate TP2 on T2 → just a TP event, NO BE move
  console.log('\n[6/8] Simulating T2 TP1 hit (must NOT re-fire BE)...');
  await engine.simulatePaperTpHit({
    tradeId: openResult.tradeId, tranche: 't2', tpIdx: 0,
    persistence, botConfig: BOT_CONFIG,
    credentials: { apiKey: 'paper', apiSecret: 'paper' },
    options: {}, logger: LOGGER,
  });

  // 7. Watcher tick again — still paper, still skip
  console.log('\n[7/8] Watcher tick #2 (mid-trade) — must still skip REST...');
  const tick2 = await watcher.tickOnce({
    persistence,
    botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'paper', apiSecret: 'paper' }),
    logger: LOGGER,
    _fetchExecutions: async () => { fetchExecutionsCalls++; return []; },
  });
  console.log(`      mode: ${tick2.mode}, total fetchExecutions calls: ${fetchExecutionsCalls}`);
  if (tick2.mode !== 'paper_only_skipped_rest' || fetchExecutionsCalls !== 0) {
    console.error('      FAIL — watcher reached for REST mid-trade'); process.exit(1);
  }

  // 8. MDX EXIT
  console.log('\n[8/8] MDX EXIT received — must run orphan cleanup, close trade...');
  await engine.onExitSignal({
    tradeId: openResult.tradeId,
    persistence,
    credentials: { apiKey: 'paper', apiSecret: 'paper' },
    options: {}, logger: LOGGER,
  });

  // Final watcher tick — trade is closed, should be idle
  console.log('\n[bonus] Final watcher tick — trade CLOSED, should be idle...');
  const tick3 = await watcher.tickOnce({
    persistence,
    botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'paper', apiSecret: 'paper' }),
    logger: LOGGER,
    _fetchExecutions: async () => { fetchExecutionsCalls++; return []; },
  });
  console.log(`      mode: ${tick3.mode}, openTrades: ${tick3.openTrades}`);

  // ── DUMP ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  s2_1_trades row (final state)');
  console.log('═══════════════════════════════════════════════════════════════');
  const finalTrade = persistence.getS21Trade(openResult.tradeId);
  console.log(JSON.stringify(finalTrade, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  s2_1_events timeline (full)');
  console.log('═══════════════════════════════════════════════════════════════');
  const eventTimeline = persistence.getS21EventsForTrade(openResult.tradeId);
  for (const e of eventTimeline) {
    const detail = e.details_json ? ` ${e.details_json}` : '';
    console.log(`  [${String(e.id).padStart(2, ' ')}] ${e.event_type}${detail.length > 200 ? detail.slice(0, 197) + '...' : detail}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Trade status         : ${finalTrade.status}`);
  console.log(`  Close reason         : ${finalTrade.close_reason}`);
  console.log(`  T2 fired             : ${finalTrade.t2_fired ? 'yes' : 'no'}`);
  console.log(`  TPs hit              : ${finalTrade.tps_hit_json}`);
  console.log(`  Events count         : ${eventTimeline.length}`);
  console.log(`  Watcher REST calls   : ${fetchExecutionsCalls} (refinement #4: must be 0)`);
  console.log(`  BE-move count        : ${eventTimeline.filter(e => e.event_type === 'T1_SL_MOVED_TO_BE').length} (must be 1)`);
  console.log(`  Orphan cleanups      : ${eventTimeline.filter(e => e.event_type === 'ORPHAN_CLEANUP').length} (must be 1, on MDX EXIT)`);

  const expectedTypes = ['TRADE_OPENED', 'T1_FILLED', 'T1_SL_PLACED', 'T1_TP_LADDER_PLACED', 'T2_TRIGGER_PLACED',
                         'T2_FILLED', 'T2_SL_PLACED', 'T2_TP_LADDER_PLACED', 'TP_HIT', 'T1_SL_MOVED_TO_BE', 'TP_HIT',
                         'MDX_EXIT_RECEIVED', 'ORPHAN_CLEANUP', 'POSITION_CLOSED'];
  const actualTypes = eventTimeline.map(e => e.event_type);
  const matches = JSON.stringify(actualTypes) === JSON.stringify(expectedTypes);
  console.log(`  Event sequence       : ${matches ? '✓ matches spec' : '✗ DIFFERS — actual: ' + JSON.stringify(actualTypes)}`);
})().catch(e => { console.error('SMOKE RUN FAILED:', e); process.exit(1); });
