'use strict';
const axios = require('axios');

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';

async function fetchKlines(symbol, interval, limit, baseUrl) {
  const url = `${baseUrl}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await axios.get(url, { timeout: 6000, validateStatus: () => true });
  const list = response.data?.result?.list || [];
  return list.slice().reverse().map(row => ({
    t: Number(row[0]), o: Number(row[1]), h: Number(row[2]),
    l: Number(row[3]), c: Number(row[4]), v: Number(row[5]),
  }));
}

function sma(arr, period) {
  if (arr.length < period) return null;
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function smaArray(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    result.push(arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

// Wilder's smoothed ADX(period). Returns null if insufficient data.
function computeADX(candles, period = 14) {
  if (candles.length < period * 2 + 2) return null;

  const trs = [], dmPlus = [], dmMinus = [];
  for (let i = 1; i < candles.length; i++) {
    const { h, l } = candles[i];
    const pc = candles[i - 1].c;
    const ph = candles[i - 1].h;
    const pl = candles[i - 1].l;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph, dn = pl - l;
    dmPlus.push(up > dn && up > 0 ? up : 0);
    dmMinus.push(dn > up && dn > 0 ? dn : 0);
  }

  if (trs.length < period * 2) return null;

  let sTR  = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let sDMp = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let sDMm = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues = [];
  for (let i = period; i < trs.length; i++) {
    sTR  = sTR  - sTR  / period + trs[i];
    sDMp = sDMp - sDMp / period + dmPlus[i];
    sDMm = sDMm - sDMm / period + dmMinus[i];
    const DIP = sTR > 0 ? 100 * sDMp / sTR : 0;
    const DIM = sTR > 0 ? 100 * sDMm / sTR : 0;
    const sum = DIP + DIM;
    dxValues.push(sum > 0 ? 100 * Math.abs(DIP - DIM) / sum : 0);
  }

  if (dxValues.length < period) return null;
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }
  return adx;
}

// Composite Quality v0.1: (ADX_norm + BD_norm + Vol_norm) / 3 * 100
function computeCompositeQuality(candles) {
  if (!candles || candles.length < 70) return null;

  const adx = computeADX(candles, 14);
  if (adx === null) return null;

  // ATR(14) for last bar
  const atrSlice = candles.slice(-15);
  const atr = atrSlice.slice(1).reduce((sum, bar, i) => {
    const pc = atrSlice[i].c;
    return sum + Math.max(bar.h - bar.l, Math.abs(bar.h - pc), Math.abs(bar.l - pc));
  }, 0) / 14;

  // Baseline = SMA(SMA(close, 35), 35) — needs ≥69 bars
  const closes = candles.map(c => c.c);
  const inner = smaArray(closes, 35);
  const innerValid = inner.filter(v => v !== null);
  if (innerValid.length < 35) return null;
  const outerSma = smaArray(innerValid, 35);
  const baseline = outerSma[outerSma.length - 1];
  if (baseline === null) return null;

  const lastClose = closes[closes.length - 1];

  // Volume/SMA(20) on prior bars (not current bar)
  const volumes = candles.map(c => c.v);
  const volSma20 = sma(volumes.slice(0, -1), 20);
  const lastVol  = volumes[volumes.length - 1];
  const volRatio = volSma20 > 0 ? lastVol / volSma20 : 1;

  // Normalise 0..1
  const adxNorm = Math.min(adx / 50, 1);
  const bdRaw   = atr > 0 ? Math.min(Math.abs(lastClose - baseline) / (3 * atr), 1) : 0;
  const bdNorm  = 1 - bdRaw;  // close to baseline = high score
  const volNorm = Math.min(volRatio / 2, 1);

  const quality = ((adxNorm + bdNorm + volNorm) / 3) * 100;

  return {
    quality:    Math.round(quality  * 10) / 10,
    adx:        Math.round(adx      * 10) / 10,
    adxNorm:    Math.round(adxNorm  * 100) / 100,
    bdNorm:     Math.round(bdNorm   * 100) / 100,
    volRatio:   Math.round(volRatio * 100) / 100,
    volNorm:    Math.round(volNorm  * 100) / 100,
    atr:        Math.round(atr      * 1e5) / 1e5,
    baseline:   Math.round(baseline * 1e5) / 1e5,
  };
}

async function computeQualityMetric({ symbol, metricConfig, bybitBaseUrl }) {
  const t0 = Date.now();
  const baseUrl  = bybitBaseUrl || BYBIT_BASE_URL;
  const interval = metricConfig?.candleInterval || 60;
  const threshold = metricConfig?.threshold ?? 60;
  const metric   = metricConfig?.metric || 'composite';

  try {
    // 100 bars: enough for SMA(SMA(close,35),35) warm-up + ADX warm-up
    const candles = await fetchKlines(symbol, interval, 100, baseUrl);
    if (candles.length < 70) {
      return { metricName: metric, metricValue: null, threshold, qualityMet: false,
               error: 'insufficient_candles', latencyMs: Date.now() - t0 };
    }

    let metricValue = null;
    let components  = null;

    if (metric === 'composite') {
      const r = computeCompositeQuality(candles);
      if (!r) return { metricName: metric, metricValue: null, threshold, qualityMet: false,
                       error: 'compute_failed', latencyMs: Date.now() - t0 };
      metricValue = r.quality;
      components  = r;

    } else if (metric === 'adx') {
      const adx = computeADX(candles, 14);
      if (adx === null) return { metricName: metric, metricValue: null, threshold, qualityMet: false,
                                 error: 'compute_failed', latencyMs: Date.now() - t0 };
      metricValue = Math.round(adx * 10) / 10;

    } else if (metric === 'volume') {
      const volumes  = candles.map(c => c.v);
      const volSma   = sma(volumes.slice(0, -1), 20);
      const lastVol  = volumes[volumes.length - 1];
      metricValue = volSma > 0 ? Math.round(lastVol / volSma * 100) / 100 : 0;
    }

    const qualityMet = metricValue !== null && metricValue >= threshold;
    return { metricName: metric, metricValue, threshold, qualityMet, components, latencyMs: Date.now() - t0 };

  } catch (err) {
    return { metricName: metric, metricValue: null, threshold, qualityMet: false,
             error: err.message, latencyMs: Date.now() - t0 };
  }
}

module.exports = { computeQualityMetric };
