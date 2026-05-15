#!/usr/bin/env node
'use strict';
/**
 * scripts/test-paper-mode.js — explicit paper_positions.mode on insert + backfill
 *
 * Convention: plain node + assert, prints ok/FAIL per case, exit 1 on failure.
 * Throwaway temp DB only.
 */
const assert = require('assert');
const fs = require('fs');

const { createDatabase, initSchema, buildPersistence, modeForPaperBotId } = require('../src/db/sqlite');

const DB = `/tmp/test-paper-mode-${process.pid}.sqlite`;
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures.push({ name, error: e.message }); console.log(`  FAIL ${name}: ${e.message}`); }
}

const base = (paper_bot_id, live_bot_id) => ({
  created_at: new Date().toISOString(), paper_bot_id, live_bot_id,
  symbol: 'XUSDT', side: 'Buy', signal: 'ENTER_LONG',
  entry_price: 1, qty: 1, notional_usd: 100,
});

console.log('-- modeForPaperBotId (pure) --');
check('prefix → mode mapping', () => {
  assert.strictEqual(modeForPaperBotId('P_Bot1'), 'paper_p1');
  assert.strictEqual(modeForPaperBotId('P2_Bot3'), 'paper_p2');
  assert.strictEqual(modeForPaperBotId('QPool_Bot5'), 'paper_qpool');
  assert.strictEqual(modeForPaperBotId('vanilla_Bot2'), 'paper_vanilla');
  assert.strictEqual(modeForPaperBotId('mystery_X'), 'paper_unknown');
  assert.strictEqual(modeForPaperBotId(null), 'paper_unknown');
});

console.log('-- insertPaperPosition sets mode explicitly --');
let db = createDatabase(DB);
initSchema(db);
let p = buildPersistence(db);

check('P1 insert → paper_p1', () => {
  const r = p.insertPaperPosition(base('P_Bot1', 'Bot1'));
  const row = db.prepare('SELECT mode FROM paper_positions WHERE id=?').get(r.lastInsertRowid);
  assert.strictEqual(row.mode, 'paper_p1');
});
check('P2 insert → paper_p2', () => {
  const r = p.insertPaperPosition(base('P2_Bot3', 'Bot3'));
  assert.strictEqual(db.prepare('SELECT mode FROM paper_positions WHERE id=?').get(r.lastInsertRowid).mode, 'paper_p2');
});
check('QPool insert → paper_qpool', () => {
  const r = p.insertPaperPosition(base('QPool_Bot5', 'Bot5'));
  assert.strictEqual(db.prepare('SELECT mode FROM paper_positions WHERE id=?').get(r.lastInsertRowid).mode, 'paper_qpool');
});
check('explicit row.mode is honoured (override)', () => {
  const r = p.insertPaperPosition({ ...base('P_Bot7', 'Bot7'), mode: 'paper_custom' });
  assert.strictEqual(db.prepare('SELECT mode FROM paper_positions WHERE id=?').get(r.lastInsertRowid).mode, 'paper_custom');
});
check('vanilla insert (separate helper) → paper_vanilla', () => {
  p.insertVanillaPaperPosition({
    created_at: new Date().toISOString(), paper_bot_id: 'vanilla_Bot2', live_bot_id: 'Bot2',
    symbol: 'XUSDT', side: 'Buy', signal: 'ENTER_LONG', entry_price: 1, qty: 1, notional_usd: 100,
  });
  const v = p.getVanillaPaperPositions();
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].mode, 'paper_vanilla');
});
db.close();

console.log('-- idempotent backfill corrects historically-mislabelled rows --');
check('rows force-set to paper_vanilla are corrected by prefix on initSchema', () => {
  const d = createDatabase(DB);
  // Simulate the historical column-DEFAULT bug: everything reads paper_vanilla.
  d.exec("UPDATE paper_positions SET mode='paper_vanilla'");
  // Re-run initSchema (what a service restart does).
  initSchema(d);
  const byId = (id) => d.prepare('SELECT paper_bot_id, mode FROM paper_positions').all();
  const rows = byId();
  for (const r of rows) {
    const expect = modeForPaperBotId(r.paper_bot_id);
    // 'paper_custom' override row had prefix P_ → backfill reclaims it to paper_p1.
    if (r.paper_bot_id === 'P_Bot7') { assert.strictEqual(r.mode, 'paper_p1'); continue; }
    assert.strictEqual(r.mode, expect, `${r.paper_bot_id} → ${r.mode} (want ${expect})`);
  }
  // Real vanilla row must remain paper_vanilla.
  const van = d.prepare("SELECT count(*) c FROM paper_positions WHERE mode='paper_vanilla'").get();
  assert.strictEqual(van.c, 1);
  d.close();
});
check('second initSchema is a no-op (idempotent)', () => {
  const d = createDatabase(DB);
  const before = d.prepare('SELECT id, mode FROM paper_positions ORDER BY id').all();
  initSchema(d);
  const after = d.prepare('SELECT id, mode FROM paper_positions ORDER BY id').all();
  assert.deepStrictEqual(after, before);
  d.close();
});
check('mode isolation: P1/P2/QPool excluded from vanilla getters', () => {
  const d = createDatabase(DB);
  const pp = buildPersistence(d);
  const v = pp.getVanillaPaperPositions();
  assert.ok(v.every(x => x.paper_bot_id.startsWith('vanilla_')), 'non-vanilla leaked');
  assert.strictEqual(pp.getOpenVanillaPaperPosition('Bot1'), null);
  d.close();
});

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('\nALL PASS');
process.exit(0);
