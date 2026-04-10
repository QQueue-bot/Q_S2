'use strict';

// S3 Shadow Scoring Engine — log-only, no execution changes.
//
// LATENCY NOTE: Each call fetches two Bybit kline series concurrently over HTTP
// (base interval + HTF interval). On testnet this typically adds 200–800 ms to
// the webhook handler. The caller should run this asynchronously and never block
// execution on the result. If either fetch fails the engine falls back to neutral
// scores for affected factors and sets dataAvailable = false in the result.

const axios = require('axios');

const NEUTRAL_SCORE = 0.5;

// ---------------------------------------------------------------------------
// Bybit public kline fetch (no auth required)
// Returns candles newest-first: [startTime, open, high, low, close, volume, turnover]
// ---------------------------------------------------------------------------
async function fetchKlines(symbol, interval, limit, baseUrl) {
  const url = `${baseUrl}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await axios.get(url, { timeout: 5000, validateStatus: () => true });
  return response.data?.result?.list || [];
}

// ---------------------------------------------------------------------------
// RSI-14
// ---------------------------------------------------------------------------
function computeRsi(closesOldFirst) {
  if (closesOldFirst.length < 15) return null;
  const sample = closesOldFirst.slice(-15);
  let gains = 0, losses = 0;
  for (let i = 1; i < sample.length; i++) {
    const delta = sample[i] - sample[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function scoreRsi(rsi, signal) {
  if (rsi === null) return { score: NEUTRAL_SCORE, value: null, note: 'insufficient_data' };
  const isLong = signal === 'ENTER_LONG';
  let score;
  if (isLong) {
    if (rsi < 25)       score = 0.35; // extreme oversold — potential for further downside
    else if (rsi < 40)  score = 0.65; // oversold recovering — favorable entry
    else if (rsi < 60)  score = 0.80; // neutral momentum — clean setup
    else if (rsi < 70)  score = 0.55; // getting hot
    else                score = 0.20; // overbought — risky long entry
  } else {
    // ENTER_SHORT: mirror
    if (rsi > 75)       score = 0.35;
    else if (rsi > 60)  score = 0.65;
    else if (rsi > 40)  score = 0.80;
    else if (rsi > 30)  score = 0.55;
    else                score = 0.20;
  }
  return { score, value: Math.round(rsi * 10) / 10, note: null };
}

// ---------------------------------------------------------------------------
// VWAP (rolling over all provided candles)
// ---------------------------------------------------------------------------
function computeVwap(candlesOldFirst) {
  let cumTpV = 0, cumVol = 0;
  for (const c of candlesOldFirst) {
    const high = Number(c[2]);
    const low  = Number(c[3]);
    const close = Number(c[4]);
    const vol  = Number(c[5]);
    cumTpV += ((high + low + close) / 3) * vol;
    cumVol += vol;
  }
  return cumVol === 0 ? null : cumTpV / cumVol;
}

function scoreVwap(vwap, currentPrice, signal) {
  if (!vwap || !currentPrice) return { score: NEUTRAL_SCORE, value: null, note: 'insufficient_data' };
  const distancePct = ((currentPrice - vwap) / vwap) * 100;
  const isLong = signal === 'ENTER_LONG';
  // Long: buying below VWAP = value. Short: selling above VWAP = value.
  let score;
  if (isLong) {
    if (distancePct < -2)       score = 0.90;
    else if (distancePct < -0.5) score = 0.75;
    else if (distancePct < 0.5)  score = 0.55; // at VWAP
    else if (distancePct < 2)    score = 0.35;
    else                         score = 0.20;
  } else {
    if (distancePct > 2)        score = 0.90;
    else if (distancePct > 0.5)  score = 0.75;
    else if (distancePct > -0.5) score = 0.55;
    else if (distancePct > -2)   score = 0.35;
    else                         score = 0.20;
  }
  return { score, value: Math.round(distancePct * 100) / 100, note: null };
}

// ---------------------------------------------------------------------------
// Volume spike — last candle vs. average of prior 5
// ---------------------------------------------------------------------------
function scoreVolumeSpike(candlesOldFirst) {
  if (candlesOldFirst.length < 6) return { score: NEUTRAL_SCORE, value: null, note: 'insufficient_data' };
  const lastVol = Number(candlesOldFirst[candlesOldFirst.length - 1][5]);
  const priorVols = candlesOldFirst.slice(-6, -1).map(c => Number(c[5]));
  const avgPrior = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
  if (avgPrior === 0) return { score: NEUTRAL_SCORE, value: null, note: 'zero_volume' };
  const ratio = lastVol / avgPrior;
  let score;
  if (ratio >= 2.5)       score = 1.00;
  else if (ratio >= 1.75)  score = 0.85;
  else if (ratio >= 1.25)  score = 0.65;
  else if (ratio >= 0.75)  score = 0.45;
  else                     score = 0.25; // volume drying up
  return { score, value: Math.round(ratio * 100) / 100, note: null };
}

// ---------------------------------------------------------------------------
// HTF trend — SMA of HTF closes vs. current price
// ---------------------------------------------------------------------------
function scoreHtfTrend(htfCandlesOldFirst, currentPrice, signal) {
  if (htfCandlesOldFirst.length < 2 || !currentPrice) {
    return { score: NEUTRAL_SCORE, value: null, note: 'insufficient_data' };
  }
  const closes = htfCandlesOldFirst.map(c => Number(c[4]));
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const aboveSma = currentPrice > sma;
  const distancePct = ((currentPrice - sma) / sma) * 100;
  // Long: above HTF SMA = uptrend aligned. Short: below = downtrend aligned.
  const isLong = signal === 'ENTER_LONG';
  const score = (isLong ? aboveSma : !aboveSma) ? 0.80 : 0.30;
  return { score, value: Math.round(distancePct * 100) / 100, note: aboveSma ? 'above_htf_sma' : 'below_htf_sma' };
}

// ---------------------------------------------------------------------------
// Win/loss streak — from recent exit_events for this bot (newest first)
// ---------------------------------------------------------------------------
function scoreWinLossStreak(recentExits) {
  if (!recentExits || recentExits.length === 0) {
    return { score: NEUTRAL_SCORE, value: null, note: 'no_history' };
  }
  const isWin = exit => exit.exit_reason && (
    exit.exit_reason.startsWith('TP') || exit.exit_reason === 'BREAK_EVEN'
  );
  const firstIsWin = isWin(recentExits[0]);
  let streak = 0;
  for (const exit of recentExits) {
    if (isWin(exit) === firstIsWin) streak++;
    else break;
  }
  let score;
  if (firstIsWin) {
    if (streak >= 5)      score = 0.85;
    else if (streak >= 3) score = 0.75;
    else if (streak >= 2) score = 0.65;
    else                  score = 0.55;
  } else {
    if (streak >= 5)      score = 0.20;
    else if (streak >= 3) score = 0.30;
    else if (streak >= 2) score = 0.40;
    else                  score = 0.45;
  }
  return {
    score,
    value: streak * (firstIsWin ? 1 : -1),
    note: firstIsWin ? 'win_streak' : 'loss_streak',
  };
}

// ---------------------------------------------------------------------------
// Support/resistance — v1 stub (neutral weight 0 in config)
// ---------------------------------------------------------------------------
function scoreSupResStub() {
  return { score: NEUTRAL_SCORE, value: null, note: 'stub_v1' };
}

// ---------------------------------------------------------------------------
// Main entry point
//
// Params:
//   signal      — 'ENTER_LONG' | 'ENTER_SHORT'
//   botId       — e.g. 'Bot1'
//   symbol      — e.g. 'STXUSDT'
//   db          — persistence object from buildPersistence()
//   s3Config    — settings.s3
//   bybitBaseUrl — base URL for Bybit API (from getBybitBaseUrl or env)
//
// Returns: { botId, symbol, signal, score, components, latencyMs, scoredAt, dataAvailable }
// ---------------------------------------------------------------------------
async function computeS3Score({ signal, botId, symbol, db, s3Config, bybitBaseUrl }) {
  const startMs = Date.now();
  const scoredAt = new Date().toISOString();
  const { weights, klineInterval, klineLookback, htfInterval, htfLookback, winLossStreakLookback } = s3Config;

  let dataAvailable = true;
  let rawKlines = [];
  let rawHtfKlines = [];

  // Fetch kline series concurrently — both are public endpoints, no auth needed.
  // LATENCY: adds ~200–800 ms depending on network and Bybit testnet latency.
  try {
    [rawKlines, rawHtfKlines] = await Promise.all([
      fetchKlines(symbol, klineInterval, klineLookback + 1, bybitBaseUrl),
      fetchKlines(symbol, htfInterval, htfLookback, bybitBaseUrl),
    ]);
  } catch (_err) {
    dataAvailable = false;
  }

  // Bybit returns newest-first; reverse to oldest-first for sequential calculations.
  const candles    = [...rawKlines].reverse();
  const htfCandles = [...rawHtfKlines].reverse();
  const currentPrice = candles.length > 0 ? Number(candles[candles.length - 1][4]) : null;

  // RSI
  const closes = candles.map(c => Number(c[4]));
  const rsi = computeRsi(closes);
  const rsiResult = scoreRsi(rsi, signal);

  // VWAP
  const vwap = computeVwap(candles);
  const vwapResult = scoreVwap(vwap, currentPrice, signal);

  // Volume spike
  const volResult = scoreVolumeSpike(candles);

  // HTF trend
  const htfResult = scoreHtfTrend(htfCandles, currentPrice, signal);

  // Win/loss streak
  let recentExits = [];
  try {
    recentExits = db.getRecentExitEventsForBot({ bot_id: botId, limit: winLossStreakLookback });
  } catch (_err) {
    // DB failure: fall back to neutral
  }
  const streakResult = scoreWinLossStreak(recentExits);

  // Support/resistance stub
  const supResResult = scoreSupResStub();

  const components = {
    rsi:               { weight: weights.rsi,               ...rsiResult },
    vwap:              { weight: weights.vwap,              ...vwapResult },
    volumeSpike:       { weight: weights.volumeSpike,       ...volResult },
    htfTrend:          { weight: weights.htfTrend,          ...htfResult },
    winLossStreak:     { weight: weights.winLossStreak,     ...streakResult },
    supportResistance: { weight: weights.supportResistance, ...supResResult },
  };

  // Weighted score 0–100. Factors with weight 0 contribute nothing.
  const totalWeight  = Object.values(components).reduce((sum, c) => sum + c.weight, 0);
  const weightedSum  = Object.values(components).reduce((sum, c) => sum + c.score * c.weight, 0);
  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 50;

  return {
    botId,
    symbol,
    signal,
    score,
    components,
    latencyMs: Date.now() - startMs,
    scoredAt,
    dataAvailable,
  };
}

module.exports = { computeS3Score };
