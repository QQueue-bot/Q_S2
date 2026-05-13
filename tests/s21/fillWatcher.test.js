'use strict';

// S2.1 fill watcher tests.
//
// Covers:
//   - orderLinkId classification (every kind of order S2.1 places)
//   - dry-run "tick but skip Bybit calls" (refinement #4)
//   - re-entrancy guard (overlapping ticks don't double-dispatch)
//   - fill detection + handler dispatch via injected execution stream
//   - idempotency: same execution seen twice does NOT re-fire

// Stub bybitClient before loading anything that requires it (§4 firewall).
const path = require('path');
const stubBybitPath = path.resolve(__dirname, '../../src/s21/bybitClient.js');
require.cache[stubBybitPath] = {
  id: stubBybitPath,
  filename: stubBybitPath,
  loaded: true,
  exports: {
    getLivePrice: () => { throw new Error('§4: getLivePrice called in test'); },
    getInstrumentInfo: () => Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } }),
    getOpenOrders: () => { throw new Error('§4: getOpenOrders called in test'); },
    cancelOrder: () => { throw new Error('§4: cancelOrder called in test'); },
    placeOrder: () => { throw new Error('§4: placeOrder called in test'); },
    getLivePosition: () => { throw new Error('§4: getLivePosition called in test'); },
    fetchKlineCandles: () => { throw new Error('§4: fetchKlineCandles called in test'); },
    bybitPrivateGet: () => { throw new Error('§4: bybitPrivateGet called in test'); },
  },
};

const watcher = require('../../src/s21/fillWatcher');
const engine = require('../../src/s21/tradeEngine');

function assert(cond, msg) {
  if (!cond) { console.error('   FAIL —', msg); process.exit(1); }
}

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

// ── In-memory persistence (same shape as the real one) ────────────────────
function makePersistence() {
  const trades = new Map();
  const events = [];
  return {
    _trades: trades, _events: events,
    insertS21Trade(row) {
      const id = `s21_${row.bot_id.toLowerCase()}_${String(trades.size + 1).padStart(4, '0')}`;
      trades.set(id, { ...row, trade_id: id, trade_number: trades.size + 1, created_at: new Date().toISOString() });
      return { tradeId: id, tradeNumber: trades.size };
    },
    updateS21Trade(tradeId, fields) {
      Object.assign(trades.get(tradeId), fields);
    },
    getS21Trade(id) { return trades.get(id) || null; },
    getOpenS21Trades() { return [...trades.values()].filter(t => t.status !== 'CLOSED'); },
    getOpenS21TradesForSymbol(sym) { return [...trades.values()].filter(t => t.symbol === sym && t.status !== 'CLOSED'); },
    insertS21Event(e) {
      events.push({ ...e, occurred_at: new Date().toISOString(),
        details_json: e.details ? JSON.stringify(e.details) : null });
    },
    getS21EventsForTrade(tradeId) { return events.filter(e => e.trade_id === tradeId); },
  };
}

const BOT_CONFIG = {
  botId: 'Bot9', symbol: 'DEEPUSDT', displayName: 'DEEP', dryRun: false,
  strategy: { tpTargetsPercent: [3.37, 4.76, 12.4, 14.67, 22.4, 30.06],
              tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08],
              slPercent: 6, beAfterTpIdx: 0, leverage: 5 },
  scaledEntry: { t1Fraction: 0.5, t2Fraction: 0.5, noiseBandMult: 0.5, t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: 240 },
  paper: { t2FillDelayMs: 999999 },
};

function seedOpenTrade(persistence, { dryRun = false, tradeIdOverride } = {}) {
  const { tradeId } = persistence.insertS21Trade({
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_OPEN',
    dry_run: dryRun ? 1 : 0,
    entry_price_snapshot: 0.03573, atr_pct_at_open: 5.18, add_pct: 2.59,
    intended_notional_usd: 500, t1_intended_qty: '6996', t2_intended_qty: '6997',
    t2_trigger_price: 0.03666,
    t1_fill_price: 0.03573, t1_fill_time: new Date().toISOString(),
    t1_sl_order_id: tradeIdOverride ? `${tradeIdOverride}_t1_sl` : null,
    t2_order_id: tradeIdOverride ? `${tradeIdOverride}_t2_trigger` : null,
  });
  // Patch the actual generated ID into the order IDs
  persistence.updateS21Trade(tradeId, {
    t1_sl_order_id: `${tradeId}_t1_sl`,
    t2_order_id: `${tradeId}_t2_trigger`,
  });
  return tradeId;
}

// ── Tests ────────────────────────────────────────────────────────────────

function test_classifyOrderLinkId() {
  console.log('\n── TEST: orderLinkId classification ──');
  const tradeId = 's21_bot9_0001';
  assert(watcher._classifyOrderLinkId(`${tradeId}_t1_market`, tradeId).kind === 'T1_ENTRY', 't1_market');
  assert(watcher._classifyOrderLinkId(`${tradeId}_t1_sl`, tradeId).kind === 'T1_SL', 't1_sl');
  assert(watcher._classifyOrderLinkId(`${tradeId}_t2_trigger`, tradeId).kind === 'T2_FIRE', 't2_trigger');
  assert(watcher._classifyOrderLinkId(`${tradeId}_t2_sl`, tradeId).kind === 'T2_SL', 't2_sl');
  for (let i = 1; i <= 6; i++) {
    const c1 = watcher._classifyOrderLinkId(`${tradeId}_t1_tp${i}`, tradeId);
    assert(c1.kind === 'TP_HIT' && c1.tranche === 't1' && c1.tpIdx === i - 1, `t1_tp${i}`);
    const c2 = watcher._classifyOrderLinkId(`${tradeId}_t2_tp${i}`, tradeId);
    assert(c2.kind === 'TP_HIT' && c2.tranche === 't2' && c2.tpIdx === i - 1, `t2_tp${i}`);
  }
  // Negative cases
  assert(watcher._classifyOrderLinkId(`other_trade_t1_sl`, tradeId) === null, 'wrong trade prefix');
  assert(watcher._classifyOrderLinkId(``, tradeId) === null, 'empty');
  assert(watcher._classifyOrderLinkId(`${tradeId}_t3_tp1`, tradeId) === null, 'unknown tranche');
  assert(watcher._classifyOrderLinkId(`${tradeId}_t1_tp7`, tradeId) === null, 'tp index out of range');
  console.log('  PASS — all 14 expected linkIds classify correctly, all negatives return null');
}

async function test_dryRunTickButSkip() {
  console.log('\n── TEST: refinement #4 — paper trades tick but skip Bybit calls ──');
  const persistence = makePersistence();
  seedOpenTrade(persistence, { dryRun: true });

  let fetchCalls = 0;
  const result = await watcher.tickOnce({
    persistence,
    botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    logger: NOOP_LOGGER,
    _fetchExecutions: async () => { fetchCalls++; return []; },
  });

  assert(result.mode === 'paper_only_skipped_rest', `mode should be paper_only_skipped_rest, got ${result.mode}`);
  assert(result.openTrades === 1, `openTrades=1, got ${result.openTrades}`);
  assert(result.dispatched === 0, 'dispatched=0');
  assert(fetchCalls === 0, `§4 firewall: fetchExecutions must NOT be called for paper trades, got ${fetchCalls}`);
  console.log('  PASS — paper-only tick exercises orchestration without burning API budget');
}

async function test_liveTickDispatchesT2Fill() {
  console.log('\n── TEST: live trade with T2 fire execution → onT2Fill called ──');
  const persistence = makePersistence();
  const tradeId = seedOpenTrade(persistence, { dryRun: false });

  // Stub engine to capture the dispatch call
  const calls = [];
  const stubEngine = {
    onT2Fill: async (args) => { calls.push({ method: 'onT2Fill', args }); },
    onTpHit: async (args) => { calls.push({ method: 'onTpHit', args }); },
    onSlHit: async (args) => { calls.push({ method: 'onSlHit', args }); },
  };

  const result = await watcher.tickOnce({
    persistence,
    botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    logger: NOOP_LOGGER,
    _engine: stubEngine,
    _fetchExecutions: async () => [
      { execId: 'e1', orderLinkId: `${tradeId}_t2_trigger`, execPrice: '0.0367', execQty: '6997', execType: 'Trade' },
    ],
  });

  assert(result.mode === 'live', `mode=${result.mode}`);
  assert(result.dispatched === 1, `dispatched=1, got ${result.dispatched}`);
  assert(calls.length === 1 && calls[0].method === 'onT2Fill', `should dispatch onT2Fill, got ${calls.map(c => c.method).join(',')}`);
  assert(calls[0].args.fillPrice === 0.0367, `fillPrice=${calls[0].args.fillPrice}`);
  console.log('  PASS — T2_trigger fill dispatched to onT2Fill with correct fillPrice');
}

async function test_idempotency_sameExecutionTwice() {
  console.log('\n── TEST: idempotency — same execution seen twice does NOT re-dispatch ──');
  const persistence = makePersistence();
  const tradeId = seedOpenTrade(persistence, { dryRun: false });

  const calls = [];
  const stubEngine = {
    onT2Fill: async () => { calls.push('onT2Fill'); },
    onTpHit: async () => {}, onSlHit: async () => {},
  };

  const exec = { execId: 'e1', orderLinkId: `${tradeId}_t2_trigger`, execPrice: '0.0367', execQty: '6997', execType: 'Trade' };

  await watcher.tickOnce({
    persistence, botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    logger: NOOP_LOGGER, _engine: stubEngine,
    _fetchExecutions: async () => [exec],
  });
  await watcher.tickOnce({
    persistence, botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    logger: NOOP_LOGGER, _engine: stubEngine,
    _fetchExecutions: async () => [exec],
  });

  assert(calls.length === 1, `onT2Fill must fire exactly once across two ticks of the same execution, got ${calls.length}`);
  console.log('  PASS — duplicate execution recognized and skipped on second tick');
}

async function test_idleTickReturnsEarly() {
  console.log('\n── TEST: no open trades → tick returns idle without API calls ──');
  const persistence = makePersistence();
  let fetchCalls = 0;
  const result = await watcher.tickOnce({
    persistence, botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    logger: NOOP_LOGGER,
    _fetchExecutions: async () => { fetchCalls++; return []; },
  });
  assert(result.mode === 'idle', `mode=${result.mode}`);
  assert(result.openTrades === 0);
  assert(fetchCalls === 0);
  console.log('  PASS — idle tick is free');
}

async function test_reentrancyGuard() {
  console.log('\n── TEST: re-entrancy guard — overlapping ticks do not stack ──');
  const persistence = makePersistence();
  const tradeId = seedOpenTrade(persistence, { dryRun: false });

  // A fetch that takes 100ms — long enough for a second tick attempt to overlap.
  let activeFetches = 0;
  let maxConcurrent = 0;
  let totalTicks = 0;
  const slowFetch = async () => {
    activeFetches++;
    maxConcurrent = Math.max(maxConcurrent, activeFetches);
    await new Promise(r => setTimeout(r, 100));
    activeFetches--;
    return [];
  };

  const warnLogs = [];
  const logger = { info: () => {}, warn: (m) => warnLogs.push(m), error: () => {} };

  const handle = watcher.startWatcher({
    persistence, botConfigs: [BOT_CONFIG],
    credentialsResolver: () => ({ apiKey: 'x', apiSecret: 'x' }),
    intervalMs: 25,  // fire faster than the slowFetch takes
    logger,
    _fetchExecutions: slowFetch,
    _engine: { onT2Fill: async () => {}, onTpHit: async () => {}, onSlHit: async () => {} },
  });

  // Let several intervals fire
  await new Promise(r => setTimeout(r, 250));
  handle.stop();

  assert(maxConcurrent === 1, `max concurrent fetches should be 1 (re-entrancy guard), got ${maxConcurrent}`);
  assert(warnLogs.some(m => /previous tick still running/.test(m)),
    `should log re-entrancy skip, warnLogs=${JSON.stringify(warnLogs).slice(0, 200)}`);
  console.log(`  PASS — re-entrancy guard held (max concurrent = ${maxConcurrent}), skip warning emitted`);
}

(async () => {
  test_classifyOrderLinkId();
  await test_dryRunTickButSkip();
  await test_liveTickDispatchesT2Fill();
  await test_idempotency_sameExecutionTwice();
  await test_idleTickReturnsEarly();
  await test_reentrancyGuard();
  console.log('\n✅ ALL WATCHER TESTS PASS');
})().catch(err => { console.error('TEST RUNNER FAILED:', err); process.exit(1); });
