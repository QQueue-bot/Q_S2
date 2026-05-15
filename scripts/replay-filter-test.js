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
// Single source of truth — shared with src/execution/paperVanillaExecutor.js.
const {
  SL_PCT, TP_LADDER, ALLOC, TAKER, MAKER, FUND_RATE, START_BAL,
  fetchKlines, simulateTrade, maxDD,
} = require(path.join(__dirname, '..', 'src', 'execution', 'mdxSimulator'));

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
