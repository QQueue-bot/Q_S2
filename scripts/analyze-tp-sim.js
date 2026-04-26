#!/usr/bin/env node
'use strict';
/**
 * TP Simulation Analysis — Part 1
 * Retroactively checks whether each completed trade would have hit the TP sim
 * target before its actual exit. Fetches 1-min OHLCV from Bybit for each
 * trade window.
 *
 * Usage:  node scripts/analyze-tp-sim.js [--db /path/to/s2.sqlite]
 */

const axios = require('axios');
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');

// ─── Config ────────────────────────────────────────────────────────────────
const TP_SIM_PCT = 0.025; // 2.5% — adjust here to test other levels
const BYBIT_BASE = 'https://api.bybit.com';
const CANDLE_LOOKBACK_MINUTES = 480; // how far back to fetch candles per exit (8h window)
// ───────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) { out.db = args[++i]; }
  }
  return out;
}

async function fetchKlines({ symbol, startMs, endMs }) {
  const params = new URLSearchParams({
    category: 'linear',
    symbol,
    interval: '1',
    start: String(startMs),
    end: String(endMs),
    limit: '1000',
  });
  const resp = await axios.get(`${BYBIT_BASE}/v5/market/kline?${params}`, { timeout: 15000 });
  const list = resp.data?.result?.list || [];
  // API returns newest-first; reverse to chronological
  return list.slice().reverse().map(row => ({
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  }));
}

function backCalcEntry(markPrice, triggerPercent, closeSide) {
  // closeSide = side of the *closing* order
  // Sell close → original position was Long → price rose → mark = entry × (1 + pct/100)
  // Buy close  → original position was Short → price fell → mark = entry × (1 − pct/100)
  const pct = Number(triggerPercent) / 100;
  if (closeSide === 'Sell') return Number(markPrice) / (1 + pct);
  return Number(markPrice) / (1 - pct);
}

async function analyzeEvent(event) {
  const { symbol, side: closeSide, mark_price, trigger_percent, created_at, exit_reason, close_percent, bot_id } = event;

  const exitMs = new Date(created_at).getTime();
  const startMs = exitMs - CANDLE_LOOKBACK_MINUTES * 60 * 1000;

  const direction = closeSide === 'Sell' ? 'LONG' : 'SHORT';
  const entryPrice = backCalcEntry(mark_price, trigger_percent, closeSide);
  const tp25Price = direction === 'LONG'
    ? entryPrice * (1 + TP_SIM_PCT)
    : entryPrice * (1 - TP_SIM_PCT);

  const candles = await fetchKlines({ symbol, startMs, endMs: exitMs + 60_000 });

  let tp25Hit = false;
  let tp25CandleIdx = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hit = direction === 'LONG' ? c.h >= tp25Price : c.l <= tp25Price;
    if (hit) { tp25Hit = true; tp25CandleIdx = i; break; }
  }

  const actualPnlPct = direction === 'LONG'
    ? ((Number(mark_price) - entryPrice) / entryPrice) * 100
    : ((entryPrice - Number(mark_price)) / entryPrice) * 100;

  const simPnlPct = tp25Hit ? TP_SIM_PCT * 100 : actualPnlPct;

  return {
    botId: bot_id,
    symbol,
    direction,
    entryPrice,
    exitPrice: Number(mark_price),
    exitReason: exit_reason,
    triggerPercent: Number(trigger_percent),
    closePercent: Number(close_percent),
    exitTime: created_at,
    actualPnlPct,
    tp25Price,
    tp25Hit,
    tp25CandleIdx,
    simPnlPct,
    candlesChecked: candles.length,
  };
}

function pct(n, d) { return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`; }
function fmt(n, dp = 2) { return Number(n).toFixed(dp); }

async function main() {
  const args = parseArgs();
  const dbPath = args.db
    || process.env.S2_DB_PATH
    || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';

  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);
  const exitEvents = persistence.getExitEvents();

  if (!exitEvents.length) {
    console.log('No exit events found in DB at', dbPath);
    return;
  }

  console.log(`\nTP SIM ANALYSIS — ${(TP_SIM_PCT * 100).toFixed(1)}% target`);
  console.log(`DB: ${dbPath}`);
  console.log(`Events: ${exitEvents.length}\n`);
  console.log('─'.repeat(100));

  const results = [];
  for (const event of exitEvents) {
    try {
      const r = await analyzeEvent(event);
      results.push(r);

      const tpLabel = r.tp25Hit
        ? `\x1b[32mHIT c${r.tp25CandleIdx}\x1b[0m`
        : `\x1b[31mMISS\x1b[0m`;

      console.log(
        `${r.symbol.padEnd(16)} ${r.direction.padEnd(6)} ` +
        `entry~${fmt(r.entryPrice, 5)}  exit=${fmt(r.exitPrice, 5)}  ` +
        `actual=${fmt(r.actualPnlPct)}%  TP${(TP_SIM_PCT * 100).toFixed(1)}%=${tpLabel}  sim=${fmt(r.simPnlPct)}%  ` +
        `[${r.exitReason} ${r.closePercent}% @ ${r.exitTime.slice(0, 16)}]`
      );
    } catch (err) {
      console.error(`  ERROR ${event.symbol}: ${err.message}`);
    }
  }

  if (!results.length) return;

  // ── Aggregate ──────────────────────────────────────────────────────────
  const hits = results.filter(r => r.tp25Hit);
  const actualWins = results.filter(r => r.actualPnlPct > 0);
  const simWins = results.filter(r => r.simPnlPct > 0);
  const actualTotal = results.reduce((s, r) => s + r.actualPnlPct, 0);
  const simTotal = results.reduce((s, r) => s + r.simPnlPct, 0);
  const avgActual = actualTotal / results.length;
  const avgSim = simTotal / results.length;

  console.log('\n' + '─'.repeat(100));
  console.log(`\nRESULTS (${results.length} exit events)\n`);
  console.log(`                     Actual          TP${(TP_SIM_PCT * 100).toFixed(1)}% Sim`);
  console.log(`  Win rate:          ${pct(actualWins.length, results.length).padEnd(16)}${pct(hits.length, results.length)}`);
  console.log(`  Total PnL%:        ${('+' + fmt(actualTotal)).padEnd(16)}${'+' + fmt(simTotal)}`);
  console.log(`  Avg PnL% / trade:  ${('+' + fmt(avgActual)).padEnd(16)}${'+' + fmt(avgSim)}`);
  console.log(`\n  TP${(TP_SIM_PCT * 100).toFixed(1)}% hit: ${hits.length}/${results.length} exit events`);

  if (hits.length) {
    console.log('\n  HIT details:');
    hits.forEach(r => {
      console.log(`    ${r.symbol} ${r.direction}: hit at candle ${r.tp25CandleIdx} (~${r.tp25CandleIdx}min from window start)`);
    });
  }

  const misses = results.filter(r => !r.tp25Hit);
  if (misses.length) {
    console.log('\n  MISS details:');
    misses.forEach(r => {
      const gap = ((r.tp25Price - r.exitPrice) / r.entryPrice * 100).toFixed(2);
      console.log(`    ${r.symbol} ${r.direction}: best exit ${fmt(r.actualPnlPct)}% — TP2.5% was ${Math.abs(gap)}% away from exit price`);
    });
  }

  console.log();
}

main().catch(err => { console.error(err.message); process.exit(1); });
