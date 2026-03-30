#!/usr/bin/env node
const { classifyTriggerCandle, shouldBlockDcaAdd } = require('../src/execution/evaluateDcaEntry');
const { resolveDcaStrategy } = require('../src/config/resolveDcaStrategy');

const strategy = resolveDcaStrategy();

const recentCandles = [
  { high: 101, low: 99 },
  { high: 102, low: 100 },
  { high: 101.5, low: 99.5 },
  { high: 100.8, low: 99.8 },
  { high: 101.2, low: 100.2 },
  { high: 101.1, low: 100.1 },
  { high: 101.4, low: 100.4 },
  { high: 101.3, low: 100.3 },
  { high: 101.5, low: 100.5 },
  { high: 101.6, low: 100.6 }
];

const normalTrigger = classifyTriggerCandle(
  { high: 102.4, low: 100.6 },
  recentCandles,
  strategy
);

const impulseTrigger = classifyTriggerCandle(
  { high: 112, low: 100 },
  recentCandles,
  strategy
);

const blocked = shouldBlockDcaAdd({
  breakEvenArmed: true,
  takeProfitStarted: false,
  oppositeSignal: false,
  regimeInvalid: false,
});

const clear = shouldBlockDcaAdd({
  breakEvenArmed: false,
  takeProfitStarted: false,
  oppositeSignal: false,
  regimeInvalid: false,
});

console.log(JSON.stringify({
  normalTrigger,
  impulseTrigger,
  blocked,
  clear,
  delayNormal: normalTrigger.impulsive ? strategy.addTiming.maxDelayCandles : strategy.addTiming.minDelayCandles,
  delayImpulse: impulseTrigger.impulsive ? strategy.addTiming.maxDelayCandles : strategy.addTiming.minDelayCandles,
}, null, 2));

if (normalTrigger.impulsive) process.exit(1);
if (!impulseTrigger.impulsive) process.exit(1);
if (blocked.blocked !== true) process.exit(1);
if (!blocked.reasons.includes('break_even_armed')) process.exit(1);
if (clear.blocked !== false) process.exit(1);
if ((normalTrigger.impulsive ? strategy.addTiming.maxDelayCandles : strategy.addTiming.minDelayCandles) !== 1) process.exit(1);
if ((impulseTrigger.impulsive ? strategy.addTiming.maxDelayCandles : strategy.addTiming.minDelayCandles) !== 2) process.exit(1);
