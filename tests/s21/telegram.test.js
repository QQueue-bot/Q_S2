'use strict';

// S2.1 Telegram alerts tests:
//   - missing token/chatId → enabled=false, send is no-op
//   - both present → enabled=true, send POSTs to api.telegram.org with correct payload
//   - non-2xx response is logged, not thrown
//   - network throw is swallowed, not thrown
//   - ZOMBIE_RECONCILE alert fires through webhookHandler

const path = require('path');

const stubBybitPath = path.resolve(__dirname, '../../src/s21/bybitClient.js');
require.cache[stubBybitPath] = {
  id: stubBybitPath, filename: stubBybitPath, loaded: true,
  exports: {
    getLivePosition: () => { throw new Error('§4'); },
    getLivePrice: () => { throw new Error('§4'); },
    getInstrumentInfo: () => Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } }),
    getOpenOrders: () => { throw new Error('§4'); },
    cancelOrder: () => { throw new Error('§4'); },
    placeOrder: () => { throw new Error('§4'); },
    fetchKlineCandles: () => { throw new Error('§4'); },
    bybitPrivateGet: () => { throw new Error('§4'); },
  },
};

const { createTelegramAlerts, TELEGRAM_API } = require('../../src/s21/telegram');
const { tryDispatchS21 } = require('../../src/s21/webhookHandler');

function assert(cond, msg) {
  if (!cond) { console.error('   FAIL —', msg); process.exit(1); }
}

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

function test_noOpWhenUnset() {
  console.log('\n── TEST: env vars unset → enabled=false, send is no-op ──');
  const a = createTelegramAlerts({ botToken: null, chatId: null });
  assert(a.enabled === false, 'enabled should be false');
  // Should not throw when called
  return a.send('hello').then(() => {
    console.log('  PASS — no-op alerts created, send() resolved without side effects');
  });
}

function test_noOpWhenOnlyTokenSet() {
  console.log('\n── TEST: only botToken set → still no-op (both required) ──');
  const a = createTelegramAlerts({ botToken: 'abc', chatId: undefined });
  assert(a.enabled === false, 'enabled should be false when chatId is missing');
  console.log('  PASS — partial config = no-op');
}

async function test_sendWithCorrectPayload() {
  console.log('\n── TEST: enabled alerts POST to Telegram API with correct payload ──');
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, text: async () => '' };
  };
  const a = createTelegramAlerts({
    botToken: 'TEST_TOKEN', chatId: '-1001234567890',
    logger: NOOP_LOGGER, _fetch: fakeFetch,
  });
  assert(a.enabled === true);
  await a.send('Hello from S2.1');

  assert(captured.url === `${TELEGRAM_API}/botTEST_TOKEN/sendMessage`,
    `wrong URL: ${captured.url}`);
  assert(captured.init.method === 'POST', `method=${captured.init.method}`);
  const body = JSON.parse(captured.init.body);
  assert(body.chat_id === '-1001234567890', `chat_id=${body.chat_id}`);
  assert(body.text === 'Hello from S2.1', `text=${body.text}`);
  assert(body.disable_web_page_preview === true, 'preview disabled');
  console.log('  PASS — payload correct: bot token in URL, chat_id + text in body');
}

async function test_non2xxResponseLogged() {
  console.log('\n── TEST: non-2xx response is logged, not thrown ──');
  const warnLogs = [];
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden: bot blocked by user' });
  const a = createTelegramAlerts({
    botToken: 'X', chatId: 'Y',
    logger: { info: () => {}, warn: (m, ctx) => warnLogs.push({ m, ctx }), error: () => {} },
    _fetch: fakeFetch,
  });
  let threw = false;
  try { await a.send('boom'); } catch { threw = true; }
  assert(!threw, 'send() must not throw on non-2xx');
  assert(warnLogs.length === 1, `should log once, got ${warnLogs.length}`);
  assert(warnLogs[0].ctx.status === 403);
  assert(/Forbidden/.test(warnLogs[0].ctx.body));
  console.log('  PASS — 403 logged with body, no exception bubbled');
}

async function test_networkErrorSwallowed() {
  console.log('\n── TEST: network throw is swallowed, lifecycle continues ──');
  const warnLogs = [];
  const fakeFetch = async () => { throw new Error('ENETUNREACH'); };
  const a = createTelegramAlerts({
    botToken: 'X', chatId: 'Y',
    logger: { info: () => {}, warn: (m, ctx) => warnLogs.push({ m, ctx }), error: () => {} },
    _fetch: fakeFetch,
  });
  let threw = false;
  try { await a.send('boom'); } catch { threw = true; }
  assert(!threw, 'send() must not throw on network error');
  assert(warnLogs.some(l => /send failed.*swallowed/.test(l.m)), 'should log swallowed network error');
  console.log('  PASS — network error logged + swallowed');
}

async function test_emptyStringIsNoOp() {
  console.log('\n── TEST: empty / non-string message is silent no-op ──');
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, status: 200, text: async () => '' }; };
  const a = createTelegramAlerts({ botToken: 'X', chatId: 'Y', _fetch: fakeFetch });
  await a.send('');
  await a.send(null);
  await a.send(undefined);
  await a.send('   ');
  assert(calls === 0, `fetch must not be called for empty messages, got ${calls}`);
  console.log('  PASS — empty/whitespace/null all silently dropped');
}

async function test_zombieReconcileTriggersAlert() {
  console.log('\n── TEST: ZOMBIE_RECONCILE in webhookHandler fires telegram alert ──');
  const persistence = makePersistence();
  const { tradeId } = persistence.insertS21Trade({
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_T2_OPEN',
  });
  persistence.insertS21Event({ trade_id: tradeId, event_type: 'TP_HIT', details: { tranche: 't2', tpIdx: 0 } });

  const alertsSent = [];
  const fakeAlerts = {
    enabled: true,
    send: async (msg) => { alertsSent.push(msg); },
  };

  await tryDispatchS21({
    rawSignal: 'ENTER_LONG_Bot9',
    persistence, logger: NOOP_LOGGER, alerts: fakeAlerts,
    _injectS21BotIds: new Set(['Bot9']),
    _injectLegacyBotIds: new Set([]),
    _injectBotConfig: BOT_CONFIG,
    _injectCredentials: { apiKey: 'x', apiSecret: 'x' },
    _injectLivePosition: async () => ({ size: '0' }),  // Bybit says flat
    _injectEngine: { openScaledTrade: async () => ({ tradeId: 's21_bot9_new' }) },
  });

  const zombieAlerts = alertsSent.filter(m => /ZOMBIE_RECONCILE/.test(m));
  assert(zombieAlerts.length === 1, `expected 1 ZOMBIE_RECONCILE alert, got ${zombieAlerts.length}`);
  const msg = zombieAlerts[0];
  assert(/trade s21_bot9_0001/.test(msg) || msg.includes(tradeId), `alert should reference trade id: ${msg}`);
  assert(/T1_T2_OPEN/.test(msg), `alert should include prior status: ${msg}`);
  assert(/ENTER_LONG_Bot9/.test(msg), `alert should include incoming signal: ${msg}`);
  assert(/TP_HIT/.test(msg), `alert should include last event in timeline: ${msg}`);
  console.log('  PASS — ZOMBIE_RECONCILE alert fires with trade_id, prior status, signal, and last event');
}

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
      if (!s) return;
      Object.assign(s, fields);
    },
    deleteS21Signal(id) { signals.delete(id); },
    insertS21Trade(row) {
      const tradeId = `s21_${row.bot_id.toLowerCase()}_${String(trades.size + 1).padStart(4, '0')}`;
      trades.set(tradeId, { ...row, trade_id: tradeId, trade_number: trades.size + 1 });
      return { tradeId, tradeNumber: trades.size };
    },
    updateS21Trade(id, fields) { Object.assign(trades.get(id), fields); },
    getS21Trade(id) { return trades.get(id) || null; },
    getOpenS21Trades() { return [...trades.values()].filter(t => t.status !== 'CLOSED'); },
    getOpenS21TradesForSymbol(sym) { return [...trades.values()].filter(t => t.symbol === sym && t.status !== 'CLOSED'); },
    insertS21Event(e) { events.push({ id: events.length + 1, ...e, details_json: e.details ? JSON.stringify(e.details) : null }); },
    getS21EventsForTrade(tid) { return events.filter(e => e.trade_id === tid); },
  };
}

const BOT_CONFIG = {
  botId: 'Bot9', enabled: true, dryRun: true,
  symbol: 'DEEPUSDT', displayName: 'DEEP', notionalUsd: 500,
  credentialRef: { apiKeyEnv: 'X', apiSecretEnv: 'X' },
  strategy: {
    leverage: 5, tpTargetsPercent: [3.37, 4.76, 12.40, 14.67, 22.40, 30.06],
    tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08], slPercent: 6.0, beAfterTpIdx: 0,
  },
  scaledEntry: { t1Fraction: 0.5, t2Fraction: 0.5, noiseBandMult: 0.5, t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: 240 },
};

(async () => {
  await test_noOpWhenUnset();
  test_noOpWhenOnlyTokenSet();
  await test_sendWithCorrectPayload();
  await test_non2xxResponseLogged();
  await test_networkErrorSwallowed();
  await test_emptyStringIsNoOp();
  await test_zombieReconcileTriggersAlert();
  console.log('\n✅ ALL TELEGRAM TESTS PASS');
})().catch(err => { console.error('TEST RUNNER FAILED:', err); process.exit(1); });
