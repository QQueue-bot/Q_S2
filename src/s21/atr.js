'use strict';

// ATR(14) on closed candles for S2.1 signal-time snapshot.
//
// The snapshot is captured once at MDX webhook receipt and persisted. It is
// NEVER recomputed during the lifetime of the trade. The T2 trigger price is
// derived from this snapshot's atrPct.
//
// Method: Wilder's RMA (Recursive Moving Average) — matches TradingView Pine
// `ta.atr(14)`. Seeded with the SMA of the first 14 TR values, then for each
// subsequent TR:  ATR_n = ((ATR_{n-1} * 13) + TR_n) / 14
//
// Warmup: Wilder's RMA needs ~3–4× the period before it stabilises. We fetch
// 60 closed candles → 59 TR values → 45 smoothing iterations after the
// 14-period SMA seed. That sits comfortably in the 42–56 range and matches
// what TradingView is doing on a 4H chart loaded with enough history.
//
// SMA-based ATR is preserved as `_computeAtrSma` (unexported) for parity
// checks during verification — DO NOT delete; it's the only way to spot a
// drift between methods if the live numbers ever diverge from TradingView.

const STALENESS_GRACE_MS = 5 * 60 * 1000;
const ATR_PERIOD = 14;
const MIN_CLOSED_CANDLES = 60;

function _trueRange(candle, prevCandle) {
  const hl = candle.h - candle.l;
  const hc = Math.abs(candle.h - prevCandle.c);
  const lc = Math.abs(candle.l - prevCandle.c);
  return Math.max(hl, hc, lc);
}

function _filterClosed(candles, intervalMs, now) {
  return candles.filter(c => c.t + intervalMs <= now);
}

function _assertFresh(latestClosedCandle, intervalMs, now) {
  const latestCloseTime = latestClosedCandle.t + intervalMs;
  const staleness = now - latestCloseTime;
  if (staleness > intervalMs + STALENESS_GRACE_MS) {
    const minutesStale = Math.round(staleness / 60000);
    throw new Error(
      `ATR snapshot rejected — most recent closed candle is ${minutesStale} min old ` +
      `(grace = ${(intervalMs + STALENESS_GRACE_MS) / 60000} min). Bybit API may be lagging or returning cached data.`
    );
  }
}

function _computeAtrSma(trs) {
  if (trs.length < ATR_PERIOD) {
    throw new Error(`SMA ATR needs at least ${ATR_PERIOD} TR values, got ${trs.length}`);
  }
  const sample = trs.slice(-ATR_PERIOD);
  return sample.reduce((a, b) => a + b, 0) / ATR_PERIOD;
}

function _computeAtrWilderRma(trs) {
  if (trs.length < ATR_PERIOD) {
    throw new Error(`Wilder's RMA ATR needs at least ${ATR_PERIOD} TR values, got ${trs.length}`);
  }
  // Seed with SMA of first 14 TRs.
  const seedSum = trs.slice(0, ATR_PERIOD).reduce((a, b) => a + b, 0);
  let atr = seedSum / ATR_PERIOD;
  // Apply the recursion for every TR after the seed window.
  for (let i = ATR_PERIOD; i < trs.length; i++) {
    atr = (atr * (ATR_PERIOD - 1) + trs[i]) / ATR_PERIOD;
  }
  return atr;
}

async function computeAtr14({ symbol, intervalMin = 240, options = {}, _now = Date.now(), _fetchKlineCandles }) {
  if (intervalMin <= 0) throw new Error('intervalMin must be positive');
  const intervalMs = intervalMin * 60 * 1000;
  const fetchFn = _fetchKlineCandles || require('./bybitClient').fetchKlineCandles;

  // Pull more than the minimum so the in-progress candle and any boundary
  // weirdness can be trimmed safely.
  const raw = await fetchFn({ symbol, intervalMin, limit: MIN_CLOSED_CANDLES + 5 }, options);
  if (raw.length < MIN_CLOSED_CANDLES) {
    throw new Error(
      `Bybit returned only ${raw.length} candles for ${symbol} @ ${intervalMin}m — need at least ${MIN_CLOSED_CANDLES}`
    );
  }

  const closed = _filterClosed(raw, intervalMs, _now);
  if (closed.length < MIN_CLOSED_CANDLES) {
    throw new Error(
      `Only ${closed.length} CLOSED candles available for ${symbol} @ ${intervalMin}m — need at least ${MIN_CLOSED_CANDLES}`
    );
  }

  const recent = closed.slice(-MIN_CLOSED_CANDLES);
  const latestClosed = recent[recent.length - 1];
  _assertFresh(latestClosed, intervalMs, _now);

  // 59 TR values from 60 closed candles. (TR for candle[0] would need
  // candle[-1] which we don't have, so we skip it.)
  const trs = [];
  for (let i = 1; i < recent.length; i++) {
    trs.push(_trueRange(recent[i], recent[i - 1]));
  }

  const atr = _computeAtrWilderRma(trs);
  const lastClose = latestClosed.c;
  const atrPct = (atr / lastClose) * 100;

  return {
    symbol,
    intervalMin,
    atr,
    atrPct,
    lastClose,
    lastCandleOpenTime: latestClosed.t,
    capturedAt: new Date(_now).toISOString(),
    method: 'wilder_rma',
    candleCount: recent.length,
    trCount: trs.length,
  };
}

module.exports = {
  computeAtr14,
  // exported for unit-testing the math without network calls
  _trueRange,
  _filterClosed,
  _assertFresh,
  _computeAtrSma,
  _computeAtrWilderRma,
  STALENESS_GRACE_MS,
  ATR_PERIOD,
  MIN_CLOSED_CANDLES,
};
