'use strict';

// S2.1 webhook dispatch — exhaustive path coverage.
//
//   - parser: ENTER_LONG, ENTER_SHORT, EXIT (no direction), EXIT_LONG, EXIT_SHORT, malformed
//   - dispatch happy path: ENTER → engine.openScaledTrade called, signal acted=true
//   - parse error: row kept with reject_reason=PARSE_ERROR, handled=false
//   - legacy fall-through (known legacy bot): row deleted, INFO log
//   - unknown bot: row kept with reject_reason=UNKNOWN_BOT, WARN log
//   - bot disabled: rejected without engine call
//   - hybrid in-position — DB-only (no live trade): proceeds, no Bybit call made
//   - hybrid in-position — Bybit confirms open: rejected IN_POSITION
//   - hybrid in-position — Bybit says flat: ZOMBIE_RECONCILE, stale trade marked closed, new signal proceeds
//   - EXIT signal: finds open trade, calls onExitSignal
//   - EXIT_BotN (direction-less): same handling

const path = require('path');

// Stub bybitClient before anything loads it.
const stubBybitPath = path.resolve(__dirname, '../../src/s21/bybitClient.js');
require.cache[stubBybitPath] = {
  id: stubBybitPath, filename: stubBybitPath, loaded: true,
  exports: {
    getLivePosition: () => { throw new Error('§4 default-throw: getLivePosition must be injected in tests'); },
    getLivePrice: () => { throw new Error('§4: getLivePrice'); },
    getInstrumentInfo: () => Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } }),
    getOpenOrders: () => { throw new Error('§4: getOpenOrders'); },
    cancelOrder: () => { throw new Error('§4: cancelOrder'); },
    placeOrder: () => { throw new Error('§4: placeOrder'); },
    fetchKlineCandles: () => { throw new Error('§4: fetchKlineCandles'); },
    bybitPrivateGet: () => { throw new Error('§4: bybitPrivateGet'); },
  },
};

const { parseS21Signal } = require('../../src/s21/signalParser');
const { tryDispatchS21 } = require('../../src/s21/webhookHandler');

function assert(cond, msg) {
  if (!cond) { console.error('   FAIL —', msg); process.exit(1); }
}

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function makePersistence() {
  const trades = new Map();
  const events = [];
  const signals = new Map();
  let signalCounter = 0;
  return {
    _trades: trades, _events: events, _signals: signals,
    insertS21Signal(row) {
      signalCounter++;
      signals.set(signalCounter, { ...row, id: signalCounter });
      return { signalId: signalCounter };
    },
    updateS21Signal(id, fields) {
      const s = signals.get(id);
      if (!s) throw new Error(`signal ${id} not found`);
      const norm = { ...fields };
      if ('acted' in norm) norm.acted = norm.acted == null ? null : (norm.acted ? 1 : 0);
      Object.assign(s, norm);
    },
    deleteS21Signal(id) { signals.delete(id); },
    insertS21Trade(row) {
      const tradeId = `s21_${row.bot_id.toLowerCase()}_${String(trades.size + 1).padStart(4, '0')}`;
      trades.set(tradeId, { ...row, trade_id: tradeId, trade_number: trades.size + 1 });
      return { tradeId, tradeNumber: trades.size };
    },
    updateS21Trade(tradeId, fields) { Object.assign(trades.get(tradeId), fields); },
    getS21Trade(id) { return trades.get(id) || null; },
    getOpenS21Trades() { return [...trades.values()].filter(t => t.status !== 'CLOSED'); },
    getOpenS21TradesForSymbol(sym) { return [...trades.values()].filter(t => t.symbol === sym && t.status !== 'CLOSED'); },
    insertS21Event(e) {
      events.push({ id: events.length + 1, ...e,
        details_json: e.details ? JSON.stringify(e.details) : null });
    },
    getS21EventsForTrade(tradeId) { return events.filter(e => e.trade_id === tradeId); },
  };
}

const BOT_CONFIG = {
  botId: 'Bot9', enabled: true, dryRun: true,
  symbol: 'DEEPUSDT', displayName: 'DEEP', notionalUsd: 500,
  credentialRef: { apiKeyEnv: 'X', apiSecretEnv: 'X' },
  strategy: {
    leverage: 5,
    tpTargetsPercent: [3.37, 4.76, 12.40, 14.67, 22.40, 30.06],
    tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08],
    slPercent: 6.0, beAfterTpIdx: 0,
  },
  scaledEntry: {
    t1Fraction: 0.5, t2Fraction: 0.5, noiseBandMult: 0.5,
    t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: 240,
  },
  paper: { t2FillDelayMs: 999999 },
};

const STUB_CREDS = { apiKey: 'paper', apiSecret: 'paper' };

// ── Parser tests ─────────────────────────────────────────────────────────

function test_parser_acceptedShapes() {
  console.log('\n── TEST: parser — all 5 accepted shapes ──');
  const cases = [
    ['ENTER_LONG_Bot9',  { action: 'ENTER', direction: 'LONG',  botId: 'Bot9' }],
    ['ENTER_SHORT_Bot9', { action: 'ENTER', direction: 'SHORT', botId: 'Bot9' }],
    ['EXIT_Bot9',        { action: 'EXIT',  direction: null,    botId: 'Bot9' }],
    ['EXIT_LONG_Bot9',   { action: 'EXIT',  direction: 'LONG',  botId: 'Bot9' }],
    ['EXIT_SHORT_Bot9',  { action: 'EXIT',  direction: 'SHORT', botId: 'Bot9' }],
  ];
  for (const [raw, expect] of cases) {
    const r = parseS21Signal(raw);
    assert(r.action === expect.action && r.direction === expect.direction && r.botId === expect.botId,
      `parse(${raw}) → ${JSON.stringify(r)}, expected ${JSON.stringify(expect)}`);
  }
  console.log('  PASS — 5 accepted formats parse correctly');
}

function test_parser_rejects() {
  console.log('\n── TEST: parser — malformed inputs throw ──');
  const bad = ['', 'BUY_DEEP', 'ENTER_LONG', 'ENTER_LONG_DEEPUSDT', 'Bot9', 'ENTER_LONG_X9', null, undefined, 42];
  for (const b of bad) {
    let threw = false;
    try { parseS21Signal(b); } catch { threw = true; }
    assert(threw, `parse(${JSON.stringify(b)}) should have thrown`);
  }
  console.log(`  PASS — ${bad.length} malformed inputs all rejected`);
}

// ── Dispatch tests ───────────────────────────────────────────────────────

async function test_dispatch_enterHappyPath() {
  console.log('\n── TEST: ENTER happy path → engine.openScaledTrade called, signal acted=true ──');
  const persistence = makePersistence();
  const engineCalls = [];
  const stubEngine = {
    openScaledTrade: async (args) => {
      engineCalls.push({ method: 'openScaledTrade', args });
      return { tradeId: 's21_bot9_synth' };
    },
  };
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set(['Bot1', 'Bot2']),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectEngine: stubEngine,
  });
  assert(result.handled === true && result.ok === true, `handled+ok, got ${JSON.stringify(result)}`);
  assert(result.tradeId === 's21_bot9_synth');
  assert(engineCalls.length === 1 && engineCalls[0].method === 'openScaledTrade', 'engine called once');
  assert(engineCalls[0].args.signal === 'ENTER_LONG', 'signal forwarded');
  assert(engineCalls[0].args.notionalUsd === 500, 'notionalUsd from botConfig');
  const sig = persistence._signals.get(result.signalId);
  assert(sig.acted === 1, `signal acted should be 1, got ${sig.acted}`);
  assert(sig.bot_id === 'Bot9' && sig.symbol === 'DEEPUSDT' && sig.direction === 'LONG');
  assert(!sig.reject_reason);
  console.log('  PASS — engine dispatched, signal row updated acted=1');
}

async function test_dispatch_parseError() {
  console.log('\n── TEST: parse error → row kept with reject_reason=PARSE_ERROR, handled=false ──');
  const persistence = makePersistence();
  const result = await tryDispatchS21({
    rawSignal: 'GARBAGE_INPUT_42',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set(['Bot1']),
  });
  assert(result.handled === false, `handled should be false (legacy gets to try), got ${result.handled}`);
  const sig = persistence._signals.get(result.signalId);
  assert(sig, 'signal row must still exist');
  assert(sig.reject_reason === 'PARSE_ERROR', `reject_reason=${sig.reject_reason}`);
  assert(sig.acted === 0, `acted=${sig.acted}`);
  console.log('  PASS — parse error logged forensically, handled=false');
}

async function test_dispatch_legacyFallThrough() {
  console.log('\n── TEST: parsed OK but bot is legacy → row deleted, handled=false ──');
  const persistence = makePersistence();
  const logs = [];
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot1',
    persistence, logger: { info: (m) => logs.push(['info', m]), warn: () => {}, error: () => {} },
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set(['Bot1', 'Bot2']),
  });
  assert(result.handled === false, 'handled=false for legacy');
  assert(!persistence._signals.has(result.signalId), 'signal row should be DELETED for known legacy bot');
  assert(logs.some(([_, m]) => /legacy fall-through.*Bot1/.test(m)), `expected legacy fall-through INFO log, got ${JSON.stringify(logs)}`);
  console.log('  PASS — legacy fall-through cleanly: row gone, INFO log emitted');
}

async function test_dispatch_unknownBot() {
  console.log('\n── TEST: parsed OK but bot in NEITHER registry → row kept with UNKNOWN_BOT + WARN ──');
  const persistence = makePersistence();
  const logs = [];
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot42',
    persistence, logger: { info: () => {}, warn: (m) => logs.push(['warn', m]), error: () => {} },
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set(['Bot1', 'Bot2']),
  });
  assert(result.handled === false, 'handled=false for unknown');
  const sig = persistence._signals.get(result.signalId);
  assert(sig, 'signal row should be KEPT for unknown bot (forensic)');
  assert(sig.reject_reason === 'UNKNOWN_BOT', `reject_reason=${sig.reject_reason}`);
  assert(logs.some(([_, m]) => /unknown bot_id.*Bot42/.test(m)), `expected WARN log, got ${JSON.stringify(logs)}`);
  console.log('  PASS — unknown bot kept for grep + WARN emitted');
}

async function test_dispatch_botDisabled() {
  console.log('\n── TEST: bot disabled → rejected without engine call ──');
  const persistence = makePersistence();
  const engineCalls = [];
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: { ...BOT_CONFIG, enabled: false },
    _injectCredentials: STUB_CREDS,
    _injectEngine: { openScaledTrade: async () => { engineCalls.push('called'); return {}; } },
  });
  assert(result.handled === true && result.ok === false && result.reject_reason === 'BOT_DISABLED',
    `expected BOT_DISABLED reject, got ${JSON.stringify(result)}`);
  assert(engineCalls.length === 0, 'engine MUST NOT be called for disabled bot');
  console.log('  PASS — disabled bot rejected, engine never reached');
}

async function test_dispatch_hybridCheckNoDbTrade() {
  console.log('\n── TEST: hybrid in-position — DB has no open trade → no Bybit call, proceed ──');
  const persistence = makePersistence();
  let livePosCalls = 0;
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectLivePosition: async () => { livePosCalls++; return null; },
    _injectEngine: { openScaledTrade: async () => ({ tradeId: 's21_bot9_x' }) },
  });
  assert(result.handled && result.ok, 'should proceed');
  assert(livePosCalls === 0, `Bybit getLivePosition MUST NOT be called when DB is clean, got ${livePosCalls}`);
  console.log('  PASS — hot path (accepted signal) made zero extra REST calls');
}

async function test_dispatch_hybridCheck_inPositionConfirmed() {
  console.log('\n── TEST: hybrid in-position — DB open + Bybit confirms open → IN_POSITION reject ──');
  const persistence = makePersistence();
  // Seed an open trade
  persistence.insertS21Trade({
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_OPEN',
  });
  let livePosCalls = 0;
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectLivePosition: async () => { livePosCalls++; return { size: '6996', side: 'Buy' }; },
    _injectEngine: { openScaledTrade: async () => { throw new Error('should not call engine'); } },
  });
  assert(result.handled && !result.ok && result.reject_reason === 'IN_POSITION',
    `expected IN_POSITION, got ${JSON.stringify(result)}`);
  assert(livePosCalls === 1, `should make exactly one Bybit call on reject path, got ${livePosCalls}`);
  const sig = persistence._signals.get(result.signalId);
  assert(sig.reject_reason === 'IN_POSITION');
  console.log('  PASS — genuine in-position: one Bybit call, engine never reached');
}

async function test_dispatch_zombieReconcile() {
  console.log('\n── TEST: hybrid in-position — DB open but Bybit flat → ZOMBIE_RECONCILE, proceed ──');
  const persistence = makePersistence();
  // Seed a STALE open trade — DB thinks open, Bybit will say flat
  const { tradeId } = persistence.insertS21Trade({
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_T2_OPEN',
  });
  persistence.insertS21Event({ trade_id: tradeId, event_type: 'TP_HIT', details: { tranche: 't2', tpIdx: 5 } });

  const warnLogs = [];
  const engineCalls = [];

  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence,
    logger: { info: () => {}, warn: (m, ctx) => warnLogs.push({ m, ctx }), error: () => {} },
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectLivePosition: async () => ({ size: '0' }),
    _injectEngine: { openScaledTrade: async (args) => { engineCalls.push(args); return { tradeId: 's21_bot9_new' }; } },
  });

  // The stale trade must be marked closed with ZOMBIE_RECONCILE
  const stale = persistence.getS21Trade(tradeId);
  assert(stale.status === 'CLOSED', `stale trade status should be CLOSED, got ${stale.status}`);
  assert(stale.close_reason === 'ZOMBIE_RECONCILE', `close_reason=${stale.close_reason}`);
  assert(stale.close_time, 'close_time set');

  // Event recorded with full debug detail
  const events = persistence.getS21EventsForTrade(tradeId);
  const zombieEvent = events.find(e => e.event_type === 'ZOMBIE_RECONCILE');
  assert(zombieEvent, 'ZOMBIE_RECONCILE event must exist on stale trade');
  const details = JSON.parse(zombieEvent.details_json);
  assert(details.bybit_position_size === 0);
  assert(details.db_thought_status === 'T1_T2_OPEN');
  assert(details.last_event_in_timeline === 'TP_HIT');
  assert(details.new_signal === 'ENTER_LONG_Bot9');

  // WARN log emitted with debug detail
  assert(warnLogs.some(l => /ZOMBIE_RECONCILE/.test(l.m)), `expected ZOMBIE_RECONCILE WARN, got ${JSON.stringify(warnLogs)}`);

  // New signal proceeded — engine called
  assert(engineCalls.length === 1, `engine called once after zombie reconcile, got ${engineCalls.length}`);

  // New signal row marked acted=true
  assert(result.handled && result.ok);
  console.log('  PASS — zombie reconcile: stale trade closed, WARN logged with full detail, new signal acted');
}

async function test_dispatch_exitSignal() {
  console.log('\n── TEST: EXIT_Bot9 (direction-less) → onExitSignal called for open trade ──');
  const persistence = makePersistence();
  const { tradeId } = persistence.insertS21Trade({
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_T2_OPEN',
  });

  const engineCalls = [];
  const result = await tryDispatchS21({
    rawSignal: 'EXIT_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectEngine: {
      openScaledTrade: async () => { throw new Error('exit should not call open'); },
      onExitSignal: async (args) => { engineCalls.push(args); return { ok: true }; },
    },
  });

  assert(result.handled && result.ok, `should be ok, got ${JSON.stringify(result)}`);
  assert(result.closedCount === 1, `closedCount=${result.closedCount}`);
  assert(engineCalls.length === 1 && engineCalls[0].tradeId === tradeId, 'onExitSignal called for the right trade');

  const sig = persistence._signals.get(result.signalId);
  assert(sig.direction === 'EXIT', `EXIT signals get direction='EXIT' as marker, got ${sig.direction}`);
  assert(sig.acted === 1);
  console.log('  PASS — direction-less EXIT_Bot9 dispatched to onExitSignal');
}

async function test_dispatch_exitNoOpenTrade() {
  console.log('\n── TEST: EXIT but no open trade → reject NO_OPEN_TRADE ──');
  const persistence = makePersistence();
  const result = await tryDispatchS21({
    rawSignal: 'EXIT_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectEngine: { onExitSignal: async () => { throw new Error('should not call'); } },
  });
  assert(result.handled && !result.ok && result.reject_reason === 'NO_OPEN_TRADE',
    `expected NO_OPEN_TRADE, got ${JSON.stringify(result)}`);
  console.log('  PASS — EXIT on flat state correctly rejected');
}

async function test_dispatch_engineThrows() {
  console.log('\n── TEST: engine throws → signal marked ENGINE_ERROR, handled=true ──');
  const persistence = makePersistence();
  const result = await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: STUB_CREDS,
    _injectEngine: { openScaledTrade: async () => { throw new Error('synthetic engine fail'); } },
  });
  assert(result.handled && !result.ok && result.reject_reason === 'ENGINE_ERROR',
    `expected ENGINE_ERROR, got ${JSON.stringify(result)}`);
  const sig = persistence._signals.get(result.signalId);
  assert(/ENGINE_ERROR/.test(sig.reject_reason));
  assert(sig.acted === 0);
  console.log('  PASS — engine failure logged as ENGINE_ERROR with detail');
}

(async () => {
  test_parser_acceptedShapes();
  test_parser_rejects();
  await test_dispatch_enterHappyPath();
  await test_dispatch_parseError();
  await test_dispatch_legacyFallThrough();
  await test_dispatch_unknownBot();
  await test_dispatch_botDisabled();
  await test_dispatch_hybridCheckNoDbTrade();
  await test_dispatch_hybridCheck_inPositionConfirmed();
  await test_dispatch_zombieReconcile();
  await test_dispatch_exitSignal();
  await test_dispatch_exitNoOpenTrade();
  await test_dispatch_engineThrows();
  console.log('\n✅ ALL WEBHOOK HANDLER TESTS PASS');
})().catch(err => { console.error('TEST RUNNER FAILED:', err); process.exit(1); });
