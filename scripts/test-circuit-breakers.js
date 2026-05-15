#!/usr/bin/env node
'use strict';
/**
 * scripts/test-circuit-breakers.js — unit tests for src/filters/circuitBreakers.js
 * Convention: plain node + assert, prints ok/FAIL per case, exit 1 on any failure.
 */
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const {
  SkipWednesdayRule, SkipAfterNLossesRule, FilterGate, buildDefaultGate,
} = require('../src/filters/circuitBreakers');

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures.push({ name, error: e.message }); console.log(`  FAIL ${name}: ${e.message}`); }
}

// UTC dates: 2026-05-13 is a Wednesday; 2026-05-14 Thursday; 2026-05-11 Monday.
const WED   = new Date('2026-05-13T12:00:00Z');
const THU   = new Date('2026-05-14T12:00:00Z');
const MON   = new Date('2026-05-11T12:00:00Z');

console.log('-- SkipWednesdayRule --');
check('rejects Wednesday', () => {
  const [allow, reason] = new SkipWednesdayRule().evaluate(WED, {});
  assert.strictEqual(allow, false);
  assert.strictEqual(reason, 'skip_wednesday');
});
check('allows non-Wednesday (Thu)', () => {
  const [allow, reason] = new SkipWednesdayRule().evaluate(THU, {});
  assert.strictEqual(allow, true);
  assert.strictEqual(reason, null);
});

console.log('-- SkipAfterNLossesRule(2) --');
check('allows with 0 / 1 consecutive losses', () => {
  const r = new SkipAfterNLossesRule(2);
  assert.deepStrictEqual(r.evaluate(MON, {}), [true, null]);
  assert.deepStrictEqual(r.evaluate(MON, { consecutive_losses: 1 }), [true, null]);
});
check('rejects at 2 consecutive losses', () => {
  const r = new SkipAfterNLossesRule(2);
  const [allow, reason] = r.evaluate(MON, { consecutive_losses: 2 });
  assert.strictEqual(allow, false);
  assert.strictEqual(reason, 'skip_after_2L');
});
check('onOutcome: loss increments, win resets', () => {
  const r = new SkipAfterNLossesRule(2);
  let s = {};
  s = r.onOutcome(-3.0, s); assert.strictEqual(s.consecutive_losses, 1);
  s = r.onOutcome(-1.0, s); assert.strictEqual(s.consecutive_losses, 2);
  s = r.onOutcome(+5.0, s); assert.strictEqual(s.consecutive_losses, 0);
});

console.log('-- FilterGate ordering + reset + persistence --');
function freshDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ftgate-'));
  return d;
}

check('2 losses then next signal rejected, counter consumed (resets to 0)', () => {
  const dir = freshDir();
  const g = buildDefaultGate('BotT', dir);
  // Two losing live outcomes
  g.recordOutcome(-2.0);
  g.recordOutcome(-1.5);
  assert.strictEqual(g.state.consecutive_losses, 2);
  // Next non-Wednesday signal: skip_after_2L, and counter consumed → 0
  const [allow, reason] = g.shouldTake(THU);
  assert.strictEqual(allow, false);
  assert.strictEqual(reason, 'skip_after_2L');
  assert.strictEqual(g.state.consecutive_losses, 0, 'counter must reset after consuming the skip');
  // Following signal now allowed
  assert.deepStrictEqual(g.shouldTake(THU), [true, null]);
});

check('first reject wins: Wednesday short-circuits before loss rule', () => {
  const dir = freshDir();
  const g = buildDefaultGate('BotT', dir);
  g.recordOutcome(-1); g.recordOutcome(-1);          // 2 losses staged
  const [allow, reason] = g.shouldTake(WED);          // Wednesday evaluated first
  assert.strictEqual(allow, false);
  assert.strictEqual(reason, 'skip_wednesday');
  // Loss counter NOT consumed because skip_wednesday fired first
  assert.strictEqual(g.state.consecutive_losses, 2);
});

check('state persists across reload', () => {
  const dir = freshDir();
  const g1 = buildDefaultGate('BotP', dir);
  g1.recordOutcome(-4.0);
  assert.strictEqual(g1.state.consecutive_losses, 1);
  // New instance reading the same JSON
  const g2 = buildDefaultGate('BotP', dir);
  assert.strictEqual(g2.state.consecutive_losses, 1, 'state must survive reload');
});

check('corrupt state file does not crash (starts clean)', () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, 'BotC.json'), '{ not valid json');
  const g = buildDefaultGate('BotC', dir);
  assert.deepStrictEqual(g.state, {});
});

check('atomic write leaves no .tmp behind', () => {
  const dir = freshDir();
  const g = buildDefaultGate('BotA', dir);
  g.recordOutcome(-1);
  const files = fs.readdirSync(dir);
  assert.ok(files.includes('BotA.json'));
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'no leftover .tmp');
});

console.log('');
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('all circuit-breaker tests passed');
