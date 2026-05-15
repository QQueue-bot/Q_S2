'use strict';
/**
 * src/execution/paperVanillaExecutor.js
 *
 * Live vanilla paper twin. Consumes EVERY signal regardless of the FilterGate
 * (it runs BEFORE the gate in createServer.js and never reads/writes filter
 * state). Writes paper_positions rows with mode='paper_vanilla'.
 *
 * P&L is computed with the SAME shared simulator the replay test PASSED with
 * (src/execution/mdxSimulator.js) so the live twin == the validated replay.
 *
 * Sizing: each bot compounds from $100 (unleveraged), mirroring the replay's
 * equity convention; the dashboard recomputes curves from net pnl % anyway.
 *
 * Gated by PAPER_VANILLA_ENABLED (default false). Failures must never affect
 * the live path — caller wraps in try/catch.
 */
const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
const { resolveBotContext } = require('../config/resolveBotContext');
const { fetchKlines, simulateTrade, START_BAL } = require('./mdxSimulator');

function paperBotId(botId) { return `vanilla_${botId}`; }

function vanillaBalance(persistence, botId) {
  const all = persistence.getVanillaPaperPositions()
    .filter(p => p.live_bot_id === botId && p.status === 'closed');
  const realized = all.reduce((s, p) => s + (Number(p.exit_pnl_usd) || 0), 0);
  return START_BAL + realized;
}

function dirOf(signal) {
  if (signal === 'ENTER_LONG') return 'LONG';
  if (signal === 'ENTER_SHORT') return 'SHORT';
  return null;
}

async function getMarkPrice(symbol) {
  const { getJSON } = require('./mdxSimulator');
  const j = await getJSON(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
  return Number(j && j.result && j.result.list && j.result.list[0] && j.result.list[0].lastPrice) || 0;
}

async function closeOpenVanilla(persistence, pos, closeSignalMs, logger) {
  const entryMs = Date.parse(pos.created_at);
  const dir = pos.side === 'Buy' ? 'LONG' : 'SHORT';
  const startMs = entryMs - 2 * 3.6e6;
  const endMs = (closeSignalMs || Date.now()) + 2 * 3.6e6;
  let kl;
  try {
    kl = await fetchKlines(pos.symbol, startMs, Math.min(endMs, Date.now()));
  } catch (e) {
    logger.error('[paper_vanilla] kline fetch failed on close', { symbol: pos.symbol, err: e.message });
    return;
  }
  const sim = simulateTrade(kl, entryMs, dir, closeSignalMs || null);
  if (!sim) {
    logger.error('[paper_vanilla] simulate returned null on close', { id: pos.id, symbol: pos.symbol });
    return;
  }
  const notional = Number(pos.notional_usd) || START_BAL;
  const exitPnlUsd = notional * sim.netPct / 100;
  const feesUsd = notional * (sim.feePct || 0) / 100;
  const fundingUsd = notional * (sim.fundingPct || 0) / 100;
  const sgn = dir === 'LONG' ? 1 : -1;
  const effExitPrice = sim.entryPrice * (1 + sgn * sim.grossPct / 100);
  persistence.closeVanillaPaperPosition({
    id: pos.id,
    exit_price: effExitPrice,
    exit_reason: sim.exitReason,
    exit_pnl_pct: sim.netPct,
    exit_pnl_usd: exitPnlUsd,
    closed_at: new Date().toISOString(),
    paper_fees_usd: feesUsd,
    paper_funding_usd: fundingUsd,
  });
  logger.info('[paper_vanilla] closed', {
    botId: pos.live_bot_id, symbol: pos.symbol, reason: sim.exitReason,
    netPct: sim.netPct.toFixed(2), pnlUsd: exitPnlUsd.toFixed(2),
    feesUsd: feesUsd.toFixed(4), fundingUsd: fundingUsd.toFixed(4),
  });
}

/**
 * @param {{signal:string, botId:string, receivedAt?:string}} parsedSignal
 * @param {{dbPath:string, logger?:Console}} options
 */
async function executePaperVanilla(parsedSignal, options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const botId = parsedSignal.botId;
  const sigMs = parsedSignal.receivedAt ? Date.parse(parsedSignal.receivedAt) : Date.now();
  let ctx;
  try { ctx = resolveBotContext(botId); }
  catch (e) { return { ok: false, reason: `no_bot_context:${e.message}` }; }
  const symbol = ctx.symbol;

  const open = persistence.getOpenVanillaPaperPosition(botId);
  const enterDir = dirOf(parsedSignal.signal);
  const isExit = parsedSignal.signal === 'EXIT_LONG' || parsedSignal.signal === 'EXIT_SHORT';

  // EXIT or opposite-direction ENTER closes any open vanilla position (FLIP/exit).
  if (open && (isExit || (enterDir && (open.side === 'Buy' ? 'LONG' : 'SHORT') !== enterDir))) {
    await closeOpenVanilla(persistence, open, sigMs, logger);
  }

  if (isExit) return { ok: true, action: 'exit_processed', botId };
  if (!enterDir) return { ok: true, action: 'noop_non_actionable', botId };

  // After a possible close, re-check; if still/again open same dir, skip duplicate.
  const stillOpen = persistence.getOpenVanillaPaperPosition(botId);
  if (stillOpen && (stillOpen.side === 'Buy' ? 'LONG' : 'SHORT') === enterDir) {
    return { ok: true, action: 'already_open', botId };
  }

  const mark = await getMarkPrice(symbol);
  if (!(mark > 0)) return { ok: false, reason: 'no_mark_price', botId };
  const notional = vanillaBalance(persistence, botId); // compound from $100
  const qty = notional / mark;
  persistence.insertVanillaPaperPosition({
    created_at: new Date(sigMs).toISOString(),
    paper_bot_id: paperBotId(botId),
    live_bot_id: botId,
    symbol,
    side: enterDir === 'LONG' ? 'Buy' : 'Sell',
    signal: parsedSignal.signal,
    entry_price: mark,
    qty,
    notional_usd: notional,
  });
  logger.info('[paper_vanilla] entry recorded', {
    botId, symbol, side: enterDir, entry: mark, notionalUsd: notional.toFixed(2),
  });
  return { ok: true, action: 'entry_recorded', botId, symbol, notionalUsd: notional };
}

module.exports = { executePaperVanilla };
