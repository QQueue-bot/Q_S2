'use strict';
/**
 * src/execution/mdxSimulator.js
 *
 * Single source of truth for MDX Balanced execution simulation.
 * Used by BOTH scripts/replay-filter-test.js (offline, PASSED) and
 * src/execution/paperVanillaExecutor.js (live paper twin) so the live
 * vanilla twin produces results equivalent to the validated replay.
 *
 * Pure functions only — no DB, no live state.
 */
const https = require('https');

const SL_PCT = 6.0;
const TP_LADDER = [3.37, 4.76, 12.40, 14.67, 22.40, 30.06];
const ALLOC = [0.13, 0.18, 0.22, 0.22, 0.17, 0.08];
const TAKER = 0.055;       // % per side (entry + non-TP exits)
const MAKER = 0.020;       // % per side (TP fills rest as limit)
const FUND_RATE = 0.0001;  // funding per 8h interval
const START_BAL = 100;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// 60-min candles, paginate newest-first, ascending result.
async function fetchKlines(symbol, startMs, endMs) {
  const rows = [];
  let cursorEnd = endMs;
  for (let i = 0; i < 6 && cursorEnd > startMs; i++) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=1000&end=${cursorEnd}`;
    const j = await getJSON(url);
    const list = (j && j.result && j.result.list) || [];
    if (!list.length) break;
    for (const k of list) rows.push({ t: Number(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] });
    const oldest = Number(list[list.length - 1][0]);
    if (oldest <= startMs) break;
    cursorEnd = oldest - 1;
    await new Promise((r) => setTimeout(r, 120));
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

/**
 * Simulate one MDX trade from a signal time.
 * @param {Array} klines  ascending [{t(ms),o,h,l,c}]
 * @param {number} sigMs   signal time (ms)
 * @param {'LONG'|'SHORT'} dir
 * @param {number|null} closeByMs  force-close (FLIP) at/after this time, else null
 * @returns {{grossPct,netPct,exitReason,holdHours,entryPrice,entryT,exitT}|null}
 */
function simulateTrade(klines, sigMs, dir, closeByMs) {
  let ei = klines.findIndex((k) => k.t > sigMs);
  if (ei < 0 || ei >= klines.length) return null;
  const entry = klines[ei].o;
  if (!(entry > 0)) return null;
  const long = dir === 'LONG';
  const sgn = long ? 1 : -1;
  const tpPrice = TP_LADDER.map((p) => entry * (1 + sgn * p / 100));
  const slPrice = entry * (1 - sgn * SL_PCT / 100);
  const tpHit = [false, false, false, false, false, false];
  let beArmed = false;
  let filledMovePct = 0;
  let filledAlloc = 0;
  let feePct = TAKER; // entry taker on full notional
  let exitReason = 'OPEN';
  let termMovePct = 0;
  let exitT = klines[klines.length - 1].t;

  for (let j = ei; j < klines.length; j++) {
    const bar = klines[j];
    if (closeByMs && bar.t >= closeByMs) {
      termMovePct = sgn * (bar.o / entry - 1) * 100;
      exitReason = 'FLIP'; exitT = bar.t;
      feePct += (1 - filledAlloc) * TAKER;
      break;
    }
    const slLevel = beArmed ? entry : slPrice;
    const slBreached = long ? bar.l <= slLevel : bar.h >= slLevel;
    if (slBreached) {
      termMovePct = sgn * (slLevel / entry - 1) * 100;
      exitReason = beArmed ? 'BE' : 'SL'; exitT = bar.t;
      feePct += (1 - filledAlloc) * TAKER;
      break;
    }
    for (let ti = 0; ti < 6; ti++) {
      if (tpHit[ti]) continue;
      const reached = long ? bar.h >= tpPrice[ti] : bar.l <= tpPrice[ti];
      if (!reached) break; // sequential ladder
      tpHit[ti] = true;
      filledMovePct += ALLOC[ti] * sgn * (tpPrice[ti] / entry - 1) * 100;
      filledAlloc += ALLOC[ti];
      feePct += ALLOC[ti] * MAKER;
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
  return {
    grossPct, netPct, exitReason, holdHours,
    entryPrice: entry, entryT: klines[ei].t, exitT,
    feePct, fundingPct,
  };
}

function maxDD(curve) {
  let peak = curve[0] || START_BAL;
  let mdd = 0;
  for (const v of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, (v - peak) / peak * 100); }
  return mdd;
}

module.exports = {
  SL_PCT, TP_LADDER, ALLOC, TAKER, MAKER, FUND_RATE, START_BAL,
  getJSON, fetchKlines, simulateTrade, maxDD,
};
