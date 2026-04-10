'use strict';

// Usage: node scripts/checkS3Scores.js
// Prints the last 20 rows from s3_scores to the console.

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite';
const db = new Database(path.resolve(dbPath), { readonly: true });

const rows = db.prepare(`
  SELECT id, scored_at, bot_id, symbol, signal, score, latency_ms, data_available, components_json
  FROM s3_scores
  ORDER BY id DESC
  LIMIT 20
`).all();

if (rows.length === 0) {
  console.log('No S3 scores found. (Is s3.enabled set to true in settings.json?)');
  process.exit(0);
}

console.log(`\nLast ${rows.length} S3 scores (newest first)\n${'─'.repeat(72)}`);

for (const row of rows) {
  const components = (() => {
    try { return JSON.parse(row.components_json); } catch { return {}; }
  })();

  const factorLine = Object.entries(components)
    .map(([k, v]) => `${k}=${v.score?.toFixed(2) ?? '?'} (w=${v.weight})`)
    .join('  ');

  console.log(
    `[${row.id}] ${row.scored_at}  ${row.bot_id}  ${row.symbol}  ${row.signal}\n` +
    `      score=${row.score}/100  latency=${row.latency_ms}ms  data=${row.data_available ? 'ok' : 'partial'}\n` +
    `      ${factorLine}\n`
  );
}

db.close();
