#!/usr/bin/env node
'use strict';
/**
 * scripts/replay-filter-test.js
 *
 * Internal-consistency replay: same signal history, two paths.
 *   vanilla : take every ENTER, MDX sim, fees+funding
 *   filter  : ENTER through a FRESH FilterGate (own /tmp state — never touches
 *             Q_S2/state/filters/), gate decides take/skip; taken → MDX sim.
 *
 * PASS  : filter has fewer trades AND smaller portfolio maxDD% AND netPnL >= vanilla
 * FAIL  : filter has more trades, OR deeper DD, OR nonsensical PnL — stop & report
 *
 * No live state touched. Read-only on the live DB. OHLC from Bybit public API.
 * Writes scripts/replay-results.md, prints VERDICT.
 */
const path = require('path');
const https = require('https');
const Database = require('better-sqlite3');
const fs = require('fs');
const { buildDefaultGate } = require(path.join(__dirname, '..', 'src', 'filters', 'circuitBreakers'));

const DB_PATH = process.env.S2_DB_PATH || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
const STATE_DIR = '/tmp/replay-filter-state';
const OUT_MD = path.join(__dirname, 'replay-results.md');

const BOTS = [
  ['Bot1', 'DEEPUSDT'], ['Bot2', 'NEARUSDT'], ['Bot3', 'PAXGUSDT'], ['Bot4', 'ZECUSDT'],
  ['Bot5', 'XLMUSDT'], ['Bot6', 'JUPUSDT'], ['Bot7', 'BERAUSDT'], ['Bot8', 'PUMPFUNUSDT'],
];
const SL_PCT = 6.0;
const TP_LADDER = [3.37, 4.76, 12.40, 14.67, 22.40, 30.06];
const ALLOC = [0.13, 0.18, 0.22, 0.22, 0.17, 0.08];
const TAKER = 0.055, MAKER = 0.020, FUND_RATE = 0.0001; // per side %, funding per 8h
const START_BAL = 100;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchKlines(symbol, startMs, endMs) {
  // 60-min candles, paginate newest-first
  const rows = [];
  let cursorEnd = endMs;
  for (let i = 0; i < 6 && cursorEnd > startMs; i++) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=1000&end=${cursorEnd}`;
    const j = await getJSON(url);
    const list = j?.result?.list || [];
    if (!list.length) break;
    for (const k of list) rows.push({ t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    const oldest = Number(list[list.length - 1][0]);
    if (oldest <= startMs) break;
    cursorEnd = oldest - 1;
    await new Promise(r => setTimeout(r, 120));
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

// Simulate one MDX trade from signal time. Returns {grossPct, netPct, exitReason, holdHours} or null.
function simulateTrade(klines, sigMs, dir, closeByMs) {
  // entry = open of first bar strictly after signal time
  let ei = klines.findIndex(k => k.t > sigMs);
  if (ei < 0 || ei >= klines.length) return null;
  const entry = klines[ei].o;
  if (!(entry > 0)) return null;
  const long = dir === 'LONG';
  const sgn = long ? 1 : -1;
  const tpPrice = TP_LADDER.map(p => entry * (1 + sgn * p / 100));
  let slPrice = entry * (1 - sgn * SL_PCT / 100);
  const tpHit = [false, false, false, false, false, false];
  let beArmed = false;
  let filledMovePct = 0;       // Σ alloc_i * move_i for filled TPs
  let filledAlloc = 0;
  let feePct = TAKER;          // entry taker on full notional
  let exitReason = 'OPEN', termMovePct = 0, exitT = klines[klines.length - 1].t;

  for (let j = ei; j < klines.length; j++) {
    const bar = klines[j];
    if (closeByMs && bar.t >= closeByMs) {
      termMovePct = sgn * (bar.o / entry - 1) * 100;
      exitReason = 'FLIP'; exitT = bar.t;
      feePct += (1 - filledAlloc) * TAKER;
      break;
    }
    // SL/BE check first (conservative)
    const slLevel = beArmed ? entry : slPrice;
    const slBreached = long ? bar.l <= slLevel : bar.h >= slLevel;
    if (slBreached) {
      termMovePct = sgn * (slLevel / entry - 1) * 100;
      exitReason = beArmed ? 'BE' : 'SL'; exitT = bar.t;
      feePct += (1 - filledAlloc) * TAKER;
      break;
    }
    // TP ladder in sequence
    for (let ti = 0; ti < 6; ti++) {
      if (tpHit[ti]) continue;
      const reached = long ? bar.h >= tpPrice[ti] : bar.l <= tpPrice[ti];
      if (!reached) break; // sequential — stop at first unreached
      tpHit[ti] = true;
      filledMovePct += ALLOC[ti] * sgn * (tpPrice[ti] / entry - 1) * 100;
      filledAlloc += ALLOC[ti];
      feePct += ALLOC[ti] * MAKER; // TP fills rest as maker
      if (ti === 0) beArmed = true;
    }
    if (tpHit[5]) { exitReason = 'TP6'; exitT = bar.t; break; }
  }
  if (exitReason === 'OPEN') {
    const last = klines[klines.length - 1];
    termMovePct = sgn * (last.c / entry - 1) * 100;
    feePct += (1 - filledAlloc) * TAKER;
    exitT = last.t;
  }
  const remainingAlloc = 1 - filledAlloc;
  const grossPct = filledMovePct + remainingAlloc * termMovePct;
  const holdHours = Math.max(0, (exitT - klines[ei].t) / 3.6e6);
  const fundingPct = (holdHours / 8) * FUND_RATE * 100;
  const netPct = grossPct - feePct - fundingPct;
  return { grossPct, netPct, exitReason, holdHours };
}

function maxDD(curve) {
  let peak = curve[0] || START_BAL, mdd = 0;
  for (const v of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, (v - peak) / peak * 100); }
  return mdd;
}

async function main() {
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  const db = new Database(DB_PATH, { readonly: true });
  const sigsAll = db.prepare(
    "SELECT received_at, signal, bot_id FROM normalized_signals WHERE received_at >= '2026-03-01' ORDER BY received_at"
  ).all();
  db.close();
  const winStart = sigsAll[0]?.received_at, winEnd = sigsAll[sigsAll.length - 1]?.received_at;
  const startMs = Date.parse(winStart) - 3 * 24 * 3.6e6;
  const endMs = Date.parse(winEnd) + 30 * 24 * 3.6e6;

  const perBot = {};
  for (const [botId, symbol] of BOTS) {
    const sigs = sigsAll.filter(s => s.bot_id === botId);
    if (!sigs.length) { perBot[botId] = null; continue; }
    const kl = await fetchKlines(symbol, startMs, Math.min(endMs, Date.now()));
    if (kl.length < 10) { perBot[botId] = { error: 'no_klines' }; continue; }

    const gate = buildDefaultGate(`replay_${botId}`, STATE_DIR);
    const run = (mode) => {
      let bal = START_BAL; const curve = [START_BAL];
      let openDir = null, openIdx = -1;
      let n = 0, wins = 0; const skips = {};
      for (let i = 0; i < sigs.length; i++) {
        const s = sigs[i];
        const ms = Date.parse(s.received_at);
        const isEnter = s.signal === 'ENTER_LONG' || s.signal === 'ENTER_SHORT';
        if (!isEnter) { openDir = null; continue; } // EXIT closes any open notion
        const dir = s.signal === 'ENTER_LONG' ? 'LONG' : 'SHORT';
        if (openDir === dir) continue; // already in same direction
        if (mode === 'filter') {
          const [allow, reason] = gate.shouldTake(new Date(ms));
          if (!allow) { skips[reason] = (skips[reason] || 0) + 1; continue; }
        }
        // close-by = next signal time for this bot (FLIP)
        const next = sigs.slice(i + 1).find(x => Date.parse(x.received_at) > ms);
        const closeBy = next ? Date.parse(next.received_at) : null;
        const t = simulateTrade(kl, ms, dir, closeBy);
        if (!t) continue;
        n++; if (t.netPct > 0) wins++;
        bal *= (1 + t.netPct / 100);
        curve.push(bal);
        openDir = dir;
        if (mode === 'filter') gate.recordOutcome(t.netPct);
      }
      return { n, wins, finalBal: bal, sumPnlUsd: bal - START_BAL, maxDDpct: maxDD(curve), skips, curve };
    };
    const vanilla = run('vanilla');
    // reset gate state for filter run (fresh)
    fs.rmSync(path.join(STATE_DIR, `replay_${botId}.json`), { force: true });
    const filter = run('filter');
    perBot[botId] = { symbol, nSignals: sigs.length, vanilla, filter };
  }

  // Portfolio aggregate (sum of per-bot curves by trade order is non-trivial;
  // use sum of final balances and worst per-bot DD as conservative portfolio proxies,
  // plus summed equity for portfolio DD via concatenated time-ordered closes).
  const agg = (key) => {
    let trades = 0, wins = 0, finalBal = 0, baseline = 0;
    const skips = {};
    for (const [botId] of BOTS) {
      const pb = perBot[botId]; if (!pb || pb.error) continue;
      const r = pb[key];
      trades += r.n; wins += r.wins; finalBal += r.finalBal; baseline += START_BAL;
      for (const k in r.skips) skips[k] = (skips[k] || 0) + r.skips[k];
    }
    return { trades, wins, finalBal, profit: finalBal - baseline, baseline, skips };
  };
  const vAgg = agg('vanilla'), fAgg = agg('filter');
  // Portfolio DD: take the mean of per-bot maxDD weighted by bot (proxy)
  const portDD = (key) => {
    const vals = BOTS.map(([b]) => perBot[b] && !perBot[b].error ? perBot[b][key].maxDDpct : 0);
    return Math.min(...vals); // worst single-bot DD as portfolio-risk proxy
  };
  const vDD = portDD('vanilla'), fDD = portDD('filter');

  // Verdict
  const fewerTrades = fAgg.trades < vAgg.trades;
  const smallerDD = fDD >= vDD; // less negative
  const pnlGE = fAgg.profit >= vAgg.profit;
  const nonsense = [vAgg, fAgg].some(a => a.baseline > 0 && (a.profit / a.baseline > 10 || a.profit / a.baseline < -0.95));
  const PASS = fewerTrades && smallerDD && pnlGE && !nonsense;

  const L = [];
  L.push('# Filter-Twin Replay — Internal Consistency', '');
  L.push(`**Window used:** ${winStart} → ${winEnd}  (signal history starts 2026-03-29; spec said 2026-03-01 or earliest available)`);
  L.push(`**Bots:** 8  ·  **Total signals:** ${sigsAll.length}  ·  **Sim:** 1h OHLC, MDX Balanced (SL 6%, TP ${TP_LADDER.join('/')} %, alloc ${ALLOC.join('/')}, BE after TP1), fees taker ${TAKER}%/maker ${MAKER}% + funding ${FUND_RATE} /8h`, '');
  L.push('## Per-bot', '');
  L.push('| bot | sym | signals | V trades | V wins | V P&L $ | V maxDD% | F trades | F wins | F P&L $ | F maxDD% | F skips |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [botId] of BOTS) {
    const pb = perBot[botId];
    if (!pb) { L.push(`| ${botId} | - | 0 | - | - | - | - | - | - | - | - | - |`); continue; }
    if (pb.error) { L.push(`| ${botId} | ${pb.error} |`); continue; }
    const v = pb.vanilla, f = pb.filter;
    const sk = Object.entries(f.skips).map(([k, n]) => `${k}:${n}`).join(' ') || '-';
    L.push(`| ${botId} | ${pb.symbol} | ${pb.nSignals} | ${v.n} | ${v.wins} | ${v.sumPnlUsd.toFixed(2)} | ${v.maxDDpct.toFixed(1)} | ${f.n} | ${f.wins} | ${f.sumPnlUsd.toFixed(2)} | ${f.maxDDpct.toFixed(1)} | ${sk} |`);
  }
  L.push('', '## Portfolio aggregate ($100/bot → $800 baseline)', '');
  L.push('| path | trades | wins | final $ | profit $ | worst-bot maxDD% | skips |');
  L.push('|---|---|---|---|---|---|---|');
  L.push(`| vanilla | ${vAgg.trades} | ${vAgg.wins} | ${vAgg.finalBal.toFixed(2)} | ${vAgg.profit >= 0 ? '+' : ''}${vAgg.profit.toFixed(2)} | ${vDD.toFixed(1)} | - |`);
  L.push(`| filter  | ${fAgg.trades} | ${fAgg.wins} | ${fAgg.finalBal.toFixed(2)} | ${fAgg.profit >= 0 ? '+' : ''}${fAgg.profit.toFixed(2)} | ${fDD.toFixed(1)} | ${Object.entries(fAgg.skips).map(([k, n]) => `${k}:${n}`).join(' ') || '-'} |`);
  L.push('', '## Verdict', '');
  L.push(`- Filter fewer trades than vanilla: ${fewerTrades ? 'YES' : 'NO'} (${fAgg.trades} vs ${vAgg.trades})`);
  L.push(`- Filter smaller (less negative) portfolio maxDD: ${smallerDD ? 'YES' : 'NO'} (${fDD.toFixed(1)}% vs ${vDD.toFixed(1)}%)`);
  L.push(`- Filter net P&L ≥ vanilla: ${pnlGE ? 'YES' : 'NO'} (${fAgg.profit.toFixed(2)} vs ${vAgg.profit.toFixed(2)})`);
  L.push(`- No nonsensical P&L: ${!nonsense ? 'YES' : 'NO'}`);
  L.push('', `## ${PASS ? '✅ PASS' : '❌ FAIL'}`, '');
  if (!PASS) L.push('FAIL → per spec, stop and report rather than proceeding. Likely causes: small sample (~7 weeks), or rules cutting good trades disproportionately on this window.');
  fs.writeFileSync(OUT_MD, L.join('\n'));
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  console.log(L.join('\n'));
  console.log(`\nVERDICT: ${PASS ? 'PASS' : 'FAIL'}`);
  process.exit(0);
}

main().catch(e => { console.error('replay error:', e.message); process.exit(2); });
