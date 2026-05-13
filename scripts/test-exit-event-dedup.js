#!/usr/bin/env node
const assert = require('assert');
const { isClosedPnlDuplicate, filterUnreconciled, DEFAULT_TOLERANCES, __test__ } = require('../src/reconciliation/exitEventDedup');

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

const bot1BeStop = {
  symbol: 'DEEPUSDT',
  closingSide: 'Buy',
  qty: 25720,
  avgExitPrice: 0.03783471,
  updatedTimeMs: Date.parse('2026-05-12T17:17:28.713Z'),
};

const bot1ExitEvent = {
  bot_id: 'Bot1',
  symbol: 'DEEPUSDT',
  exit_reason: 'native_be_stop',
  side: 'Buy',
  qty: '25720',
  mark_price: 0.03783471,
  created_at: '2026-05-12T17:17:28.713Z',
};

console.log('-- relDiff --');
check('zero diff for identical values', () => {
  assert.strictEqual(__test__.relDiff(100, 100), 0);
});
check('handles zero-vs-zero without NaN', () => {
  assert.strictEqual(__test__.relDiff(0, 0), 0);
});
check('symmetric ~1% diff', () => {
  const d = __test__.relDiff(100, 101);
  assert.ok(d > 0.0098 && d < 0.0102);
});

console.log('-- isClosedPnlDuplicate (positive matches) --');
check('exact match returns true', () => {
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [bot1ExitEvent]), true);
});

check('match with 0.1% qty drift returns true', () => {
  const drifted = { ...bot1ExitEvent, qty: '25746' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [drifted]), true);
});

check('match with 0.1% price drift returns true', () => {
  const drifted = { ...bot1ExitEvent, mark_price: 0.03787 };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [drifted]), true);
});

check('match with 4-minute timestamp drift returns true', () => {
  const t = Date.parse(bot1ExitEvent.created_at) + 4 * 60 * 1000;
  const drifted = { ...bot1ExitEvent, created_at: new Date(t).toISOString() };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [drifted]), true);
});

console.log('-- isClosedPnlDuplicate (negative matches) --');
check('different symbol returns false', () => {
  const other = { ...bot1ExitEvent, symbol: 'XLMUSDT' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [other]), false);
});

check('different closing side returns false', () => {
  const other = { ...bot1ExitEvent, side: 'Sell' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [other]), false);
});

check('qty drift beyond 0.5% returns false', () => {
  const other = { ...bot1ExitEvent, qty: '26000' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [other]), false);
});

check('price drift beyond 0.5% returns false', () => {
  const other = { ...bot1ExitEvent, mark_price: 0.0385 };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [other]), false);
});

check('timestamp drift beyond 5min returns false', () => {
  const t = Date.parse(bot1ExitEvent.created_at) + 6 * 60 * 1000;
  const other = { ...bot1ExitEvent, created_at: new Date(t).toISOString() };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [other]), false);
});

check('empty event list returns false', () => {
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, []), false);
});

check('non-array event list returns false', () => {
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, null), false);
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, undefined), false);
});

check('null closedPnl record returns false', () => {
  assert.strictEqual(isClosedPnlDuplicate(null, [bot1ExitEvent]), false);
});

check('closedPnl record with non-finite qty returns false', () => {
  const bad = { ...bot1BeStop, qty: NaN };
  assert.strictEqual(isClosedPnlDuplicate(bad, [bot1ExitEvent]), false);
});

check('exit event with unparseable timestamp is skipped', () => {
  const broken = { ...bot1ExitEvent, created_at: 'not-a-date' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [broken]), false);
});

console.log('-- isClosedPnlDuplicate (custom tolerances) --');
check('tighter qty tolerance can reject a previously-matching event', () => {
  const drifted = { ...bot1ExitEvent, qty: '25746' };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [drifted], { qtyRelTol: 0.0001 }), false);
});

check('looser time tolerance accepts wider drift', () => {
  const t = Date.parse(bot1ExitEvent.created_at) + 30 * 60 * 1000;
  const drifted = { ...bot1ExitEvent, created_at: new Date(t).toISOString() };
  assert.strictEqual(isClosedPnlDuplicate(bot1BeStop, [drifted], { timeMs: 60 * 60 * 1000 }), true);
});

console.log('-- filterUnreconciled --');
check('keeps records with no matching event', () => {
  const novel = { ...bot1BeStop, symbol: 'XLMUSDT', avgExitPrice: 0.345 };
  const out = filterUnreconciled([bot1BeStop, novel], [bot1ExitEvent]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].symbol, 'XLMUSDT');
});

check('returns empty array for non-array input', () => {
  assert.deepStrictEqual(filterUnreconciled(null, [bot1ExitEvent]), []);
});

console.log('-- exposed defaults --');
check('DEFAULT_TOLERANCES is frozen and exposes expected keys', () => {
  assert.strictEqual(Object.isFrozen(DEFAULT_TOLERANCES), true);
  assert.strictEqual(typeof DEFAULT_TOLERANCES.qtyRelTol, 'number');
  assert.strictEqual(typeof DEFAULT_TOLERANCES.priceRelTol, 'number');
  assert.strictEqual(typeof DEFAULT_TOLERANCES.timeMs, 'number');
});

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('all exit-event dedup tests passed');
