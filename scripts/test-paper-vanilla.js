#!/usr/bin/env node
'use strict';
/**
 * scripts/test-paper-vanilla.js — tests for src/execution/paperVanillaExecutor.js
 *
 * Convention: plain node + assert, prints ok/FAIL per case, exit 1 on any failure.
 *
 * Uses a throwaway temp SQLite DB (never the live DB). Reads live Bybit public
 * market data only (mark price + 1h klines) — identical, read-only API surface
 * to scripts/replay-filter-test.js. Touches NO filter state.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { executePaperVanilla } = require('../src/execution/paperVanillaExecutor');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');

const DB_PATH = `/tmp/test-vanilla-${process.pid}.sqlite`;
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true });

// Quiet logger that still surfaces real errors.
const logs = [];
const logger = {
  info: (...a) => logs.push(['info', ...a]),
  warn: (...a) => logs.push(['warn', ...a]),
  error: (...a) => { logs.push(['error', ...a]); },
};

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures.push({ name, error: e.message }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const HOUR = 3.6e6;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const sig = (signal, botId, ms) => ({ signal, botId, receivedAt: iso(ms) });

function persistence() {
  const db = createDatabase(DB_PATH);
  initSchema(db);
  return buildPersistence(db);
}

(async () => {
  console.log('-- paperVanillaExecutor (live twin) --');

  // 1. ENTER opens a vanilla paper position (Bot1 = DEEPUSDT).
  let entryRow;
  await check('ENTER_LONG records a paper_vanilla open position', async () => {
    const r = await executePaperVanilla(sig('ENTER_LONG', 'Bot1', now - 6 * 24 * HOUR), { dbPath: DB_PATH, logger });
    assert.strictEqual(r.ok, true, `result not ok: ${JSON.stringify(r)}`);
    assert.strictEqual(r.action, 'entry_recorded', `action=${r.action}`);
    const p = persistence();
    const open = p.getOpenVanillaPaperPosition('Bot1');
    assert.ok(open, 'no open vanilla position found');
    entryRow = open;
    assert.strictEqual(open.mode, 'paper_vanilla');
    assert.strictEqual(open.paper_bot_id, 'vanilla_Bot1');
    assert.strictEqual(open.live_bot_id, 'Bot1');
    assert.strictEqual(open.side, 'Buy');
    assert.strictEqual(open.status, 'open');
    assert.ok(open.entry_price > 0, `entry_price=${open.entry_price}`);
    assert.ok(open.qty > 0, `qty=${open.qty}`);
    assert.ok(Math.abs(open.notional_usd - 100) < 1e-9, `notional should compound from 100, got ${open.notional_usd}`);
    assert.strictEqual(open.filter_state_snapshot, null, 'vanilla must never carry filter state');
  });

  // 2. Same-direction ENTER while open is a no-op (no duplicate).
  await check('duplicate same-dir ENTER → already_open, no duplicate row', async () => {
    const r = await executePaperVanilla(sig('ENTER_LONG', 'Bot1', now - 5 * 24 * HOUR), { dbPath: DB_PATH, logger });
    assert.strictEqual(r.action, 'already_open', `action=${r.action}`);
    const all = persistence().getVanillaPaperPositions().filter(x => x.live_bot_id === 'Bot1');
    assert.strictEqual(all.length, 1, `expected 1 Bot1 vanilla row, got ${all.length}`);
  });

  // 3. EXIT closes the open position with fees + funding both > 0.
  let realized = 0;
  await check('EXIT_LONG closes position; fees & funding > 0; pnl finite', async () => {
    const r = await executePaperVanilla(sig('EXIT_LONG', 'Bot1', now - 1 * 24 * HOUR), { dbPath: DB_PATH, logger });
    assert.strictEqual(r.ok, true);
    const p = persistence();
    assert.strictEqual(p.getOpenVanillaPaperPosition('Bot1'), null, 'position should be closed');
    const closed = p.getVanillaPaperPositions().find(x => x.id === entryRow.id);
    assert.ok(closed, 'closed row missing');
    assert.strictEqual(closed.status, 'closed');
    assert.ok(Number.isFinite(closed.exit_pnl_usd), `exit_pnl_usd not finite: ${closed.exit_pnl_usd}`);
    assert.ok(Number.isFinite(closed.exit_pnl_pct), `exit_pnl_pct not finite: ${closed.exit_pnl_pct}`);
    assert.ok(closed.exit_price > 0, `exit_price=${closed.exit_price}`);
    assert.ok(typeof closed.exit_reason === 'string' && closed.exit_reason.length > 0, `exit_reason=${closed.exit_reason}`);
    assert.ok(closed.paper_fees_usd > 0, `fees should be > 0 (entry taker), got ${closed.paper_fees_usd}`);
    assert.ok(closed.paper_funding_usd > 0, `funding should be > 0 over a ~5d hold, got ${closed.paper_funding_usd}`);
    realized = Number(closed.exit_pnl_usd);
  });

  // 4. Compounding: next entry's notional = 100 + realized P&L so far.
  await check('next ENTER compounds notional from realized P&L', async () => {
    const r = await executePaperVanilla(sig('ENTER_SHORT', 'Bot1', now - 12 * HOUR), { dbPath: DB_PATH, logger });
    assert.strictEqual(r.action, 'entry_recorded', `action=${r.action}`);
    const open = persistence().getOpenVanillaPaperPosition('Bot1');
    assert.strictEqual(open.side, 'Sell');
    assert.ok(Math.abs(open.notional_usd - (100 + realized)) < 1e-6,
      `expected notional ${100 + realized}, got ${open.notional_usd}`);
  });

  // 5. Mode-isolation: a P1-style row (paper_bot_id != vanilla_*) must NOT be
  //    picked up by the vanilla queries, despite mode column defaulting to
  //    'paper_vanilla' (Phase 1 schema quirk). Guards the compounding balance.
  await check('P1/P2/QPool rows are excluded from vanilla queries', async () => {
    const p = persistence();
    p.insertPaperPosition({
      created_at: iso(now - 3 * 24 * HOUR), paper_bot_id: 'paper_Bot2', live_bot_id: 'Bot2',
      symbol: 'NEARUSDT', side: 'Buy', signal: 'ENTER_LONG', entry_price: 1.23, qty: 10, notional_usd: 100,
    });
    const vanilla = p.getVanillaPaperPositions();
    assert.ok(!vanilla.some(x => x.paper_bot_id === 'paper_Bot2'),
      'P1 row leaked into getVanillaPaperPositions() — mode-default bug not contained');
    assert.strictEqual(p.getOpenVanillaPaperPosition('Bot2'), null,
      'P1 row leaked into getOpenVanillaPaperPosition()');
  });

  // 6. Non-actionable / EXIT with nothing open is a safe no-op.
  await check('EXIT with no open position → exit_processed, creates nothing', async () => {
    const r = await executePaperVanilla(sig('EXIT_SHORT', 'Bot3', now - 2 * HOUR), { dbPath: DB_PATH, logger });
    assert.strictEqual(r.ok, true);
    const rows = persistence().getVanillaPaperPositions().filter(x => x.live_bot_id === 'Bot3');
    assert.strictEqual(rows.length, 0, `Bot3 should have no vanilla rows, got ${rows.length}`);
  });

  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true });

  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    const errLogs = logs.filter(l => l[0] === 'error');
    if (errLogs.length) console.log('error logs:', JSON.stringify(errLogs.slice(0, 5)));
    process.exit(1);
  }
  console.log('\nALL PASS');
  process.exit(0);
})().catch((e) => { console.error('test harness error:', e && e.stack || e); process.exit(2); });
