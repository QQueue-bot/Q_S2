#!/usr/bin/env node
// Synthetic Bot5 end-to-end test for the reconciler.
//
// Default mode: DRY RUN. Prints the planned actions. Exits 0 without touching Bybit or DB.
// With --confirm: places ~$5 market BUY on Bot5/XLMUSDT, closes via reduceOnly market SELL,
//                 then runs reconciler against the live DB and asserts a reconciled exit_event
//                 was written matching the close.
//
// Safety belts:
//   * hard-pinned to Bot5 / XLMUSDT
//   * refuses to run if Bot5 already has an open position
//   * refuses to run if Bot5 wallet < $50
//   * 30s total timeout; if exceeded, emits a reduceOnly market close best-effort

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { loadBotRegistry } = require('../src/config/botRegistry');
const { resolveBotCredentials } = require('../src/config/resolveBotCredentials');
const { createDatabase, initSchema } = require('../src/db/sqlite');
const { reconcileAll } = require('../src/reconciliation/positionReconciler');

const BOT_ID = 'Bot5';
const SYMBOL = 'XLMUSDT';
const TARGET_NOTIONAL_USD = 6.0;
const MIN_NOTIONAL_FLOOR_USD = 5.5;
const MIN_WALLET_USD = 50.0;
const HARD_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  const args = { confirm: false, dbPath: null, registryPath: null, envPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') args.confirm = true;
    else if (a === '--db') args.dbPath = argv[++i];
    else if (a === '--registry') args.registryPath = argv[++i];
    else if (a === '--env') args.envPath = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: test-reconciler-bot5-synthetic.js [--confirm] [--db PATH] [--registry PATH] [--env PATH]');
      console.log('Without --confirm: dry-run only. With --confirm: places ~$5 real order.');
      process.exit(0);
    }
  }
  return args;
}

function sign(apiKey, apiSecret, timestamp, recvWindow, payload) {
  return crypto.createHmac('sha256', apiSecret).update(timestamp + apiKey + recvWindow + payload).digest('hex');
}

async function bybitGet(pathname, query, credentials) {
  const ts = Date.now().toString();
  const recv = '5000';
  const sig = sign(credentials.apiKey, credentials.apiSecret, ts, recv, query);
  const resp = await axios.get(`https://api.bybit.com${pathname}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': recv,
      'X-BAPI-SIGN': sig,
    },
    timeout: 10000,
    validateStatus: () => true,
  });
  return resp.data;
}

async function bybitPost(pathname, bodyObj, credentials) {
  const ts = Date.now().toString();
  const recv = '5000';
  const body = JSON.stringify(bodyObj);
  const sig = sign(credentials.apiKey, credentials.apiSecret, ts, recv, body);
  const resp = await axios.post(`https://api.bybit.com${pathname}`, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': recv,
      'X-BAPI-SIGN': sig,
    },
    timeout: 10000,
    validateStatus: () => true,
  });
  return resp.data;
}

async function getPosition(creds) {
  const r = await bybitGet('/v5/position/list', `category=linear&symbol=${SYMBOL}`, creds);
  return (r && r.result && r.result.list && r.result.list[0]) || null;
}

async function getWalletUsd(creds) {
  const r = await bybitGet('/v5/account/wallet-balance', 'accountType=UNIFIED', creds);
  const list = r && r.result && r.result.list;
  if (!list || !list[0]) return null;
  return Number(list[0].totalEquity || 0);
}

async function getTickerPrice(creds) {
  const r = await bybitGet('/v5/market/tickers', `category=linear&symbol=${SYMBOL}`, creds);
  const t = r && r.result && r.result.list && r.result.list[0];
  return t ? Number(t.lastPrice) : null;
}

async function placeMarketBuy(creds, qty) {
  return bybitPost('/v5/order/create', {
    category: 'linear',
    symbol: SYMBOL,
    side: 'Buy',
    orderType: 'Market',
    qty: String(qty),
    timeInForce: 'IOC',
  }, creds);
}

async function placeReduceOnlySell(creds, qty) {
  return bybitPost('/v5/order/create', {
    category: 'linear',
    symbol: SYMBOL,
    side: 'Sell',
    orderType: 'Market',
    qty: String(qty),
    reduceOnly: true,
    timeInForce: 'IOC',
  }, creds);
}

async function waitForSize(creds, predicate, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const p = await getPosition(creds);
    const size = p ? Number(p.size || 0) : 0;
    if (predicate(size, p)) return p;
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

function quantizeQty(qty, qtyStep) {
  const step = Number(qtyStep) || 1;
  return Math.floor(Number(qty) / step) * step;
}

async function getInstrument(creds) {
  const r = await bybitGet('/v5/market/instruments-info', `category=linear&symbol=${SYMBOL}`, creds);
  return r && r.result && r.result.list && r.result.list[0];
}

(async () => {
  const args = parseArgs(process.argv);
  const dbPath = args.dbPath || process.env.S2_DB_PATH || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
  const registryPath = args.registryPath || path.join(__dirname, '..', 'config', 'bots.json');
  const envPath = args.envPath || '/home/ubuntu/.openclaw/.env';

  const registry = loadBotRegistry(registryPath);
  const bot = registry.bots.find((b) => b.botId === BOT_ID);
  if (!bot) {
    console.error(`${BOT_ID} not in registry`);
    process.exit(2);
  }
  if (bot.symbol !== SYMBOL) {
    console.error(`Hard-pinned to ${SYMBOL} but ${BOT_ID} symbol is ${bot.symbol}`);
    process.exit(2);
  }

  const creds = (() => {
    const r = resolveBotCredentials(BOT_ID, { registryPath, envPath });
    return { apiKey: r.apiKey, apiSecret: r.apiSecret };
  })();

  console.log(`Bot5 synthetic reconciliation test`);
  console.log(`  symbol:   ${SYMBOL}`);
  console.log(`  notional: ~$${TARGET_NOTIONAL_USD}`);
  console.log(`  mode:     ${args.confirm ? 'CONFIRMED — will place real order' : 'DRY RUN — no order will be placed'}`);

  console.log('');
  console.log('Preflight checks:');
  const wallet = await getWalletUsd(creds);
  console.log(`  wallet:   $${wallet === null ? 'unknown' : wallet.toFixed(2)}`);
  if (wallet === null || wallet < MIN_WALLET_USD) {
    console.error(`  FAIL: wallet below $${MIN_WALLET_USD} floor`);
    process.exit(3);
  }
  const existing = await getPosition(creds);
  const existingSize = existing ? Number(existing.size || 0) : 0;
  console.log(`  position: ${existingSize > 0 ? `OPEN (size=${existingSize})` : 'flat'}`);
  if (existingSize > 0) {
    console.error('  FAIL: Bot5 already has an open position; refusing to run');
    process.exit(3);
  }
  const instrument = await getInstrument(creds);
  const qtyStep = instrument && instrument.lotSizeFilter && instrument.lotSizeFilter.qtyStep;
  const minQty = instrument && instrument.lotSizeFilter && instrument.lotSizeFilter.minOrderQty;
  console.log(`  instrument: qtyStep=${qtyStep} minQty=${minQty}`);
  const price = await getTickerPrice(creds);
  console.log(`  price:    ${price}`);
  const step = Number(qtyStep) || 1;
  let plannedQty = quantizeQty(TARGET_NOTIONAL_USD / price, step);
  if (plannedQty < Number(minQty || 1)) plannedQty = Number(minQty || 1);
  while (plannedQty * price < MIN_NOTIONAL_FLOOR_USD) plannedQty += step;
  console.log(`  qty:      ${plannedQty} (notional ~$${(plannedQty * price).toFixed(2)})`);

  if (!args.confirm) {
    console.log('');
    console.log('Dry run complete. Re-run with --confirm to execute the live test.');
    process.exit(0);
  }

  console.log('');
  console.log('Inserting synthetic order_attempts row before placing order...');
  const syntheticOrderAttempt = {
    created_at: new Date().toISOString(),
    signal: 'ENTER_LONG',
    bot_id: BOT_ID,
    symbol: SYMBOL,
    side: 'Buy',
    order_type: 'Market',
    qty: String(plannedQty),
    notional_usd: plannedQty * price,
    status: 'submitted',
    response_json: JSON.stringify({ source: `synthetic_reconciler_test_${Date.now()}` }),
  };
  const db = createDatabase(dbPath);
  initSchema(db);
  const insOA = db.prepare(`
    INSERT INTO order_attempts (created_at, signal, bot_id, symbol, side, order_type, qty, notional_usd, status, response_json)
    VALUES (@created_at, @signal, @bot_id, @symbol, @side, @order_type, @qty, @notional_usd, @status, @response_json)
  `).run(syntheticOrderAttempt);
  console.log(`  synthetic order_attempts inserted: id=${insOA.lastInsertRowid} at ${syntheticOrderAttempt.created_at}`);

  console.log('');
  console.log('Executing live test...');
  const deadline = Date.now() + HARD_TIMEOUT_MS;
  let positionOpened = false;
  try {
    const openResp = await placeMarketBuy(creds, plannedQty);
    console.log(`  open order resp: retCode=${openResp.retCode} orderId=${openResp.result && openResp.result.orderId}`);
    if (openResp.retCode !== 0) throw new Error(`open failed: ${openResp.retMsg}`);

    const filled = await waitForSize(creds, (size) => size > 0, Math.min(10000, deadline - Date.now()));
    if (!filled) throw new Error('timed out waiting for fill');
    positionOpened = true;
    console.log(`  filled: size=${filled.size} avgPrice=${filled.avgPrice}`);

    const closeResp = await placeReduceOnlySell(creds, filled.size);
    console.log(`  close order resp: retCode=${closeResp.retCode} orderId=${closeResp.result && closeResp.result.orderId}`);
    if (closeResp.retCode !== 0) throw new Error(`close failed: ${closeResp.retMsg}`);

    const flat = await waitForSize(creds, (size) => size === 0, Math.min(10000, deadline - Date.now()));
    if (!flat) throw new Error('timed out waiting for flat');
    console.log('  position closed; account is flat');
    positionOpened = false;
  } catch (err) {
    console.error(`  trade-leg error: ${err.message}`);
    if (positionOpened) {
      console.error('  attempting safety close...');
      try {
        const pos = await getPosition(creds);
        if (pos && Number(pos.size || 0) > 0) {
          await placeReduceOnlySell(creds, pos.size);
        }
      } catch (e2) {
        console.error(`  safety close failed: ${e2.message}`);
      }
    }
    process.exit(4);
  }

  console.log('');
  console.log('Running reconciler...');
  const reports = await reconcileAll({
    db,
    bots: [bot],
    credentialsResolver: () => creds,
    options: { dryRun: false, minQuietSecondsAfterEnter: 0, perBotStaggerMs: 0 },
    logger: { info: (m, x) => console.log('[info]', m, x || ''), warn: (m, x) => console.log('[warn]', m, x || '') },
  });

  const report = reports[0];
  const failures = [];
  if (!report || !report.inserted || report.inserted.length === 0) {
    failures.push('reconciler did not insert any exit_event');
  } else {
    const row = report.inserted[0];
    if (row.bot_id !== BOT_ID) failures.push(`bot_id ${row.bot_id} != ${BOT_ID}`);
    if (row.symbol !== SYMBOL) failures.push(`symbol ${row.symbol} != ${SYMBOL}`);
    if (row.side !== 'Sell') failures.push(`side ${row.side} != Sell`);
    if (!row.exit_reason.startsWith('reconciled_')) failures.push(`exit_reason ${row.exit_reason} not reconciled_*`);
    const qtyDiff = Math.abs(Number(row.qty) - plannedQty) / Math.max(plannedQty, Number(row.qty));
    if (qtyDiff > 0.01) failures.push(`qty ${row.qty} vs ${plannedQty} drift ${qtyDiff}`);
    console.log(`  inserted: ${row.exit_reason} ${row.side} qty=${row.qty} @ ${row.mark_price} at ${row.created_at} (id #${row.id})`);
  }

  console.log('');
  console.log('Cleanup:');
  const delOA = db.prepare(`DELETE FROM order_attempts WHERE id = ?`).run(insOA.lastInsertRowid);
  console.log(`  deleted synthetic order_attempts: rows=${delOA.changes}`);
  if (report && report.inserted && report.inserted[0] && report.inserted[0].id) {
    const delEE = db.prepare(`DELETE FROM exit_events WHERE id = ?`).run(report.inserted[0].id);
    console.log(`  deleted reconciled exit_event: rows=${delEE.changes}`);
  }

  console.log('');
  if (failures.length > 0) {
    console.log(`SYNTHETIC TEST FAILED: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('SYNTHETIC TEST PASSED — reconciler caught the live divergence and wrote the correct exit_event');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
