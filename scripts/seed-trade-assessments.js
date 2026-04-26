#!/usr/bin/env node
'use strict';
/**
 * One-time seed: inserts the Apr 26 trade assessments into the DB.
 * Safe to re-run — skips entries already present for the same bot+entry_time.
 *
 * Usage: node scripts/seed-trade-assessments.js [--db /path/to/s2.sqlite]
 */

const { createDatabase, initSchema, buildPersistence } = require('../src/db/sqlite');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) out.db = args[++i];
  }
  return out;
}

const ASSESSMENTS = [
  {
    bot_id: 'Bot3',
    symbol: 'PAXGUSDT',
    signal: 'ENTER_LONG',
    direction: 'LONG',
    entry_time: '2026-04-26T19:30:20.126Z',
    s3_score: 45,
    s3_components_json: JSON.stringify({
      rsi: { weight: 0.25, score: 0.2, value: 75.2 },
      vwap: { weight: 0.25, score: 0.55, value: 0.18 },
      volumeSpike: { weight: 0.2, score: 0.25, value: 0.19 },
      htfTrend: { weight: 0.2, score: 0.8, value: 0.23, note: 'above_htf_sma' },
      winLossStreak: { weight: 0.1, score: 0.5, value: null, note: 'no_history' },
      supportResistance: { weight: 0, score: 0.5, value: null, note: 'stub_v1' },
    }),
    pre_trade_text: 'Weak setup. RSI 75.2 is overbought — entering a long this extended is chasing. HTF trend above SMA (bullish) is the only real positive. Volume spike very low (0.19), no breakout conviction. VWAP barely +0.18% above — near neutral. S3 score 45 feels right or slightly generous. Most concern: late entry into an already-extended leg.',
  },
  {
    bot_id: 'Bot2',
    symbol: 'NEARUSDT',
    signal: 'ENTER_SHORT',
    direction: 'SHORT',
    entry_time: '2026-04-26T17:30:00.940Z',
    s3_score: 55,
    s3_components_json: JSON.stringify({
      rsi: { weight: 0.25, score: 0.8, value: 40.7 },
      vwap: { weight: 0.25, score: 0.35, value: -0.8 },
      volumeSpike: { weight: 0.2, score: 0.25, value: 0.41 },
      htfTrend: { weight: 0.2, score: 0.8, value: -1.33, note: 'below_htf_sma' },
      winLossStreak: { weight: 0.1, score: 0.5, value: null, note: 'no_history' },
      supportResistance: { weight: 0, score: 0.5, value: null, note: 'stub_v1' },
    }),
    pre_trade_text: 'Decent setup. RSI 40.7 heading toward bearish territory without being oversold — appropriate timing for a short entry. HTF trend -1.33% below SMA, bearish alignment confirmed. Weakness: VWAP already -0.8% below (some move already in) and volume still low (0.41). Best of the two new entries today alongside FLOKI.',
  },
  {
    bot_id: 'Bot1',
    symbol: 'DEEPUSDT',
    signal: 'ENTER_SHORT',
    direction: 'SHORT',
    entry_time: '2026-04-26T01:35:15.114Z',
    s3_score: 39,
    s3_components_json: JSON.stringify({
      rsi: { weight: 0.25, score: 0.2, value: 25 },
      vwap: { weight: 0.25, score: 0.35, value: -1.56 },
      volumeSpike: { weight: 0.2, score: 0.25, value: 0.36 },
      htfTrend: { weight: 0.2, score: 0.8, value: -1.41, note: 'below_htf_sma' },
      winLossStreak: { weight: 0.1, score: 0.4, value: -2, note: 'loss_streak' },
      supportResistance: { weight: 0, score: 0.5, value: null, note: 'stub_v1' },
    }),
    pre_trade_text: 'Lowest-scored trade, most concerning. RSI 25 at entry — extremely oversold, high risk of mean-reversion bounce. Shorting at RSI 25 fights the likely bounce setup. HTF trend below SMA is the only argument for the trade. Price already -1.56% below VWAP (extended). Bot on a -2 loss streak. Lowest quality entry of the four reviewed.',
  },
  {
    bot_id: 'Bot7',
    symbol: '1000FLOKIUSDT',
    signal: 'ENTER_SHORT',
    direction: 'SHORT',
    entry_time: '2026-04-25T14:35:14.755Z',
    s3_score: 55,
    s3_components_json: JSON.stringify({
      rsi: { weight: 0.25, score: 0.8, value: 40.6 },
      vwap: { weight: 0.25, score: 0.35, value: -1 },
      volumeSpike: { weight: 0.2, score: 0.25, value: 0.39 },
      htfTrend: { weight: 0.2, score: 0.8, value: -1.3, note: 'below_htf_sma' },
      winLossStreak: { weight: 0.1, score: 0.5, value: null, note: 'no_history' },
      supportResistance: { weight: 0, score: 0.5, value: null, note: 'stub_v1' },
    }),
    pre_trade_text: 'Solid setup alongside NEAR as the better-constructed entry of the four. RSI 40.6 — not overextended, appropriate for a short. HTF trend -1.3% below SMA, bearish confirmed. Volume still low. Already at +1.17% profit confirming direction. Cleanest entry of the Apr 26 review session.',
  },
];

async function main() {
  const args = parseArgs();
  const dbPath = args.db
    || process.env.S2_DB_PATH
    || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';

  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const existing = db.prepare('SELECT bot_id, entry_time FROM trade_assessments').all();
  const existingKeys = new Set(existing.map(r => `${r.bot_id}::${r.entry_time}`));

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const a of ASSESSMENTS) {
    const key = `${a.bot_id}::${a.entry_time}`;
    if (existingKeys.has(key)) {
      console.log(`  SKIP  ${a.bot_id} ${a.symbol} ${a.direction} (already exists)`);
      skipped++;
      continue;
    }
    persistence.insertTradeAssessment({ ...a, created_at: now });
    console.log(`  INSERT ${a.bot_id} ${a.symbol} ${a.direction} S3=${a.s3_score}`);
    inserted++;
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
