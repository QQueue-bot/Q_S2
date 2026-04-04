#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { classifyTriggerCandle } = require('../src/execution/evaluateDcaEntry');
const { resolveDcaStrategy } = require('../src/config/resolveDcaStrategy');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function isoToMs(value) {
  return new Date(value).getTime();
}

async function fetchCandles(symbol, startMs, endMs, interval = '15') {
  const response = await axios.get('https://api.bybit.com/v5/market/kline', {
    params: {
      category: 'linear',
      symbol,
      interval,
      start: startMs,
      end: endMs,
      limit: 200,
    },
    timeout: 20000,
  });
  const rows = response.data?.result?.list || [];
  return rows
    .map(row => ({
      startMs: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

function findEntryIndex(candles, tsMs, intervalMs) {
  const found = candles.findIndex(c => c.startMs <= tsMs && tsMs < c.startMs + intervalMs);
  return found >= 0 ? found : 0;
}

function calcPathMetrics(direction, entryPrice, candles) {
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  if (direction === 'long') {
    return {
      mfePct: Math.max(...highs.map(h => ((h - entryPrice) / entryPrice) * 100)),
      maePct: Math.min(...lows.map(l => ((l - entryPrice) / entryPrice) * 100)),
    };
  }
  return {
    mfePct: Math.max(...lows.map(l => ((entryPrice - l) / entryPrice) * 100)),
    maePct: Math.min(...highs.map(h => ((entryPrice - h) / entryPrice) * 100)),
  };
}

function decideWinner(nonDca, dca) {
  if (dca.mfePct > nonDca.mfePct + 0.05 && dca.maePct >= nonDca.maePct - 0.10) return 'dca';
  if (nonDca.mfePct > dca.mfePct + 0.05 && nonDca.maePct >= dca.maePct - 0.10) return 'non_dca';
  return 'neutral';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || '/tmp/f3f-signals.json');
  const outPath = path.resolve(args.out || '/tmp/f3f-implemented-analysis.json');
  const interval = args.interval || '15';
  const intervalMs = Number(interval) * 60 * 1000;
  const strategy = resolveDcaStrategy();

  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const entrySignals = payload.signals.filter(s => s.eventType === 'entry');
  const results = [];

  for (const signal of entrySignals) {
    const tsMs = isoToMs(signal.received_at);
    const startMs = tsMs - (strategy.impulseDetection.lookbackCandles + 2) * intervalMs;
    const endMs = tsMs + 8 * intervalMs;
    const candles = await fetchCandles(signal.symbol, startMs, endMs, interval);
    if (candles.length < strategy.impulseDetection.lookbackCandles + 3) {
      results.push({ signal, error: 'insufficient_candles' });
      continue;
    }

    const entryIndex = findEntryIndex(candles, tsMs, intervalMs);
    const triggerCandle = candles[entryIndex];
    const lookbackStart = Math.max(0, entryIndex - strategy.impulseDetection.lookbackCandles);
    const recentCandles = candles.slice(lookbackStart, entryIndex);
    const impulse = classifyTriggerCandle(triggerCandle, recentCandles, strategy);
    const delayCandles = impulse.impulsive ? strategy.addTiming.maxDelayCandles : strategy.addTiming.minDelayCandles;
    const addIndex = Math.min(entryIndex + delayCandles, candles.length - 1);
    const addCandle = candles[addIndex];
    const postCandles = candles.slice(entryIndex, Math.min(entryIndex + 5, candles.length));

    const nonDcaEntry = triggerCandle.close;
    const dcaAverageEntry = (triggerCandle.close * 0.5) + (addCandle.close * 0.5);

    const nonDcaMetrics = calcPathMetrics(signal.direction, nonDcaEntry, postCandles);
    const dcaMetrics = calcPathMetrics(signal.direction, dcaAverageEntry, postCandles);

    results.push({
      signal,
      interval,
      triggerCandle: { startMs: triggerCandle.startMs, open: triggerCandle.open, high: triggerCandle.high, low: triggerCandle.low, close: triggerCandle.close },
      impulse,
      delayCandles,
      nonDcaEntry,
      dcaAddEntry: addCandle.close,
      dcaAverageEntry,
      nonDca: nonDcaMetrics,
      dca: dcaMetrics,
      winner: decideWinner(nonDcaMetrics, dcaMetrics),
    });
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  const summary = { total: results.length, dca: 0, non_dca: 0, neutral: 0, errors: 0 };
  for (const row of results) {
    if (row.error) summary.errors += 1;
    else summary[row.winner] += 1;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
