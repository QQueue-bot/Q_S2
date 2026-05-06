'use strict';
const path = require('path');
const axios = require('axios');
const { resolveBotSettings } = require('../config/resolveBotSettings');
const { evaluateTpSl, shouldTriggerBreakEven, computePnlPercent } = require('./bybitExecution');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

const fs = require('fs');
const { computeS3Score } = require('../scoring/computeS3Score');
const { computePoolState, computeAllocation } = require('../capitalPool/capitalPool');

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';
const PAPER_REGISTRY_PATH = path.join(__dirname, '..', '..', 'config', 'paper_bots.json');

function loadPaperRegistry() {
  return require(PAPER_REGISTRY_PATH);
}

function getPaperBotForLiveBot(liveBotId) {
  const registry = loadPaperRegistry();
  return registry.bots.find(b => b.liveBotId === liveBotId) || null;
}

async function getMarkPrice(symbol) {
  const resp = await axios.get(`${BYBIT_BASE_URL}/v5/market/tickers?category=linear&symbol=${symbol}`);
  const price = Number(resp.data?.result?.list?.[0]?.lastPrice || 0);
  if (!price) throw new Error(`No mark price for ${symbol}`);
  return price;
}

function getPaperBalance(persistence) {
  const baseline = Number(process.env.PAPER_BASELINE_USDT || 0);
  const closed = persistence.getClosedPaperPositions();
  const realized = closed.reduce((sum, p) => sum + (Number(p.exit_pnl_usd) || 0), 0);
  return baseline + realized;
}

async function executePaperEntry(parsedSignal, options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const paperBot = getPaperBotForLiveBot(parsedSignal.botId);
  if (!paperBot) {
    return { ok: false, reason: 'no_paper_bot_configured' };
  }

  // Check no existing open paper position for this bot
  const openPos = persistence.getOpenPaperPosition(paperBot.paperBotId);
  if (openPos) {
    logger.info('[Paper] Entry skipped — position already open', { paperBotId: paperBot.paperBotId });
    return { ok: false, reason: 'position_already_open' };
  }

  const symbol = paperBot.symbol;
  const side = parsedSignal.signal === 'ENTER_LONG' ? 'Buy' : 'Sell';

  const entryPrice = await getMarkPrice(symbol);

  // Get MDX settings for sizing and TP/SL
  const botSettingsCtx = resolveBotSettings(parsedSignal.botId, {
    registryPath: path.join(__dirname, '..', '..', 'config', 'bots.json'),
  });
  const settings = botSettingsCtx.settings;
  const accountPercent = 12.5; // 1/8 of total paper balance per bot
  const leverage = settings.positionSizing?.leverage || 4;

  const paperBalance = getPaperBalance(persistence);
  const notionalUsd = (paperBalance * accountPercent / 100) * leverage;
  const qty = notionalUsd / entryPrice;

  persistence.insertPaperPosition({
    created_at: new Date().toISOString(),
    paper_bot_id: paperBot.paperBotId,
    live_bot_id: parsedSignal.botId,
    symbol,
    side,
    signal: parsedSignal.signal,
    entry_price: entryPrice,
    qty,
    notional_usd: notionalUsd,
  });

  logger.info('[Paper] Entry recorded', { paperBotId: paperBot.paperBotId, symbol, side, entryPrice, qty: qty.toFixed(4), notionalUsd: notionalUsd.toFixed(2) });
  return { ok: true, paperBotId: paperBot.paperBotId, symbol, side, entryPrice, qty, notionalUsd };
}

async function executePaperSignalClose(parsedSignal, options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const paperBot = getPaperBotForLiveBot(parsedSignal.botId);
  if (!paperBot) return { ok: false, reason: 'no_paper_bot_configured' };

  const openPos = persistence.getOpenPaperPosition(paperBot.paperBotId);
  if (!openPos) return { ok: true, action: 'no_position' };

  const expectedSide = parsedSignal.signal === 'EXIT_LONG' ? 'Buy' : 'Sell';
  if (openPos.side !== expectedSide) return { ok: true, action: 'direction_mismatch' };

  const exitPrice = await getMarkPrice(openPos.symbol);
  const pnlPct = computePnlPercent(openPos.side, openPos.entry_price, exitPrice);
  const remainingQty = openPos.qty * (openPos.remaining_qty_pct / 100);
  const pnlUsd = remainingQty * openPos.entry_price * (pnlPct / 100);

  persistence.closePaperPosition({
    id: openPos.id,
    exit_price: exitPrice,
    exit_reason: 'signal_exit',
    exit_pnl_pct: pnlPct,
    exit_pnl_usd: pnlUsd,
    closed_at: new Date().toISOString(),
  });

  persistence.insertPaperTpEvent({
    created_at: new Date().toISOString(),
    paper_position_id: openPos.id,
    paper_bot_id: paperBot.paperBotId,
    symbol: openPos.symbol,
    event_type: 'signal_exit',
    trigger_percent: 0,
    close_percent: 100,
    mark_price: exitPrice,
    qty_closed: remainingQty,
    pnl_pct: pnlPct,
    pnl_usd: pnlUsd,
  });

  logger.info('[Paper] Signal exit', { paperBotId: paperBot.paperBotId, symbol: openPos.symbol, exitPrice, pnlPct: pnlPct?.toFixed(2) });
  return { ok: true, action: 'signal_exit', pnlPct, pnlUsd };
}

async function managePaperPositions(options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const openPositions = persistence.getAllOpenPaperPositions();
  if (!openPositions.length) return;

  for (const pos of openPositions) {
    try {
      const markPrice = await getMarkPrice(pos.symbol);
      const botSettingsCtx = resolveBotSettings(pos.live_bot_id, {
        registryPath: path.join(__dirname, '..', '..', 'config', 'bots.json'),
      });
      const settings = botSettingsCtx.settings;

      // Build a position-like object matching what evaluateTpSl/shouldTriggerBreakEven expect
      const fakePosition = {
        side: pos.side,
        symbol: pos.symbol,
        avgPrice: String(pos.entry_price),
        markPrice: String(markPrice),
        size: String(pos.qty * pos.remaining_qty_pct / 100),
        createdTime: String(new Date(pos.created_at).getTime()),
      };

      const now = new Date().toISOString();

      // --- Live break_even mirror check ---
      // If the live bot fired a break_even exit after this paper position opened,
      // close the paper position immediately to stay in sync with live.
      const liveBeExit = db.prepare(
        "SELECT * FROM exit_events WHERE bot_id=? AND symbol=? AND exit_reason='break_even' AND created_at>? ORDER BY id LIMIT 1"
      ).get(pos.live_bot_id, pos.symbol, pos.created_at);

      if (liveBeExit) {
        const bePnlPct = (pos.side === 'Buy')
          ? (liveBeExit.mark_price - pos.entry_price) / pos.entry_price * 100
          : (pos.entry_price - liveBeExit.mark_price) / pos.entry_price * 100;
        const closedQty = pos.qty * (pos.remaining_qty_pct / 100);
        const bePnlUsd = closedQty * pos.entry_price * (bePnlPct / 100);

        persistence.insertPaperTpEvent({
          created_at: liveBeExit.created_at,
          paper_position_id: pos.id,
          paper_bot_id: pos.paper_bot_id,
          symbol: pos.symbol,
          event_type: 'be_close',
          action_key: 'live_be_mirror',
          trigger_percent: 0,
          close_percent: 100,
          mark_price: liveBeExit.mark_price,
          qty_closed: closedQty,
          pnl_pct: bePnlPct,
          pnl_usd: bePnlUsd,
        });
        persistence.closePaperPosition({
          id: pos.id,
          exit_price: liveBeExit.mark_price,
          exit_reason: 'break_even',
          exit_pnl_pct: bePnlPct,
          exit_pnl_usd: bePnlUsd,
          closed_at: liveBeExit.created_at,
        });
        logger.info('[Paper] BE close (live mirror)', {
          id: pos.id, paper_bot_id: pos.paper_bot_id,
          live_exit_at: liveBeExit.created_at, mark_price: liveBeExit.mark_price,
          pnl_usd: bePnlUsd.toFixed(4),
        });
        continue; // skip TP/SL/BE checks for this position
      }

      // --- TP/SL check ---
      const tpSlDecision = evaluateTpSl(settings, fakePosition);
      if (tpSlDecision && tpSlDecision.type !== 'none') {
        const tpActionKey = `tp:TP_${tpSlDecision.triggerPercent}_${tpSlDecision.closePercent}`;
        const alreadyHit = persistence.paperTpEventExists(pos.id, tpActionKey);

        if (!alreadyHit) {
          const closeQtyPct = tpSlDecision.closePercent;
          const isFull = tpSlDecision.type === 'stop_loss' || closeQtyPct >= 100;
          const remainingAfter = isFull ? 0 : pos.remaining_qty_pct * (1 - closeQtyPct / 100);
          const closedQty = (pos.qty * pos.remaining_qty_pct / 100) * (closeQtyPct / 100);
          const pnlPct = computePnlPercent(pos.side, pos.entry_price, markPrice);
          const pnlUsd = closedQty * pos.entry_price * (pnlPct / 100);

          persistence.insertPaperTpEvent({
            created_at: now,
            paper_position_id: pos.id,
            paper_bot_id: pos.paper_bot_id,
            symbol: pos.symbol,
            event_type: tpSlDecision.type === 'stop_loss' ? 'sl_hit' : 'tp_hit',
            action_key: tpActionKey,
            trigger_percent: tpSlDecision.triggerPercent,
            close_percent: closeQtyPct,
            mark_price: markPrice,
            qty_closed: closedQty,
            pnl_pct: pnlPct,
            pnl_usd: pnlUsd,
          });

          if (isFull || remainingAfter <= 0) {
            // Close position entirely (SL or final TP)
            // pnlUsd is already in DB via insertPaperTpEvent above — do NOT add again
            const totalPnl = persistence.getPaperPositionTotalPnl(pos.id);
            persistence.closePaperPosition({
              id: pos.id,
              exit_price: markPrice,
              exit_reason: tpSlDecision.type === 'stop_loss' ? 'stop_loss' : 'take_profit',
              exit_pnl_pct: pnlPct,
              exit_pnl_usd: totalPnl,
              closed_at: now,
            });
            logger.info('[Paper] Position closed', { id: pos.id, paper_bot_id: pos.paper_bot_id, reason: tpSlDecision.type, pnlPct: pnlPct?.toFixed(2) });
          } else {
            persistence.updatePaperPositionRemainingQty(pos.id, remainingAfter);
            logger.info('[Paper] TP hit (partial)', { id: pos.id, paper_bot_id: pos.paper_bot_id, triggerPct: tpSlDecision.triggerPercent, remaining: remainingAfter.toFixed(1) + '%' });

            // Check if this TP triggers BE
            const beSettings = settings.breakEven;
            if (beSettings?.enabled && tpSlDecision.triggerPercent >= beSettings.triggerPercent && !pos.be_armed) {
              persistence.armPaperBreakEven(pos.id);
              persistence.insertPaperTpEvent({
                created_at: now,
                paper_position_id: pos.id,
                paper_bot_id: pos.paper_bot_id,
                symbol: pos.symbol,
                event_type: 'be_armed',
                action_key: 'be_armed',
                trigger_percent: beSettings.triggerPercent,
                close_percent: 0,
                mark_price: markPrice,
                qty_closed: 0,
                pnl_pct: pnlPct,
                pnl_usd: 0,
              });
              logger.info('[Paper] BE armed', { id: pos.id, paper_bot_id: pos.paper_bot_id });
            }
          }
        }
      }

      // --- BE close check (if armed, price returned to entry) ---
      const updatedPos = persistence.getOpenPaperPosition(pos.paper_bot_id);
      if (updatedPos && updatedPos.be_armed) {
        const returnedToEntry = pos.side === 'Buy'
          ? markPrice <= pos.entry_price
          : markPrice >= pos.entry_price;

        if (returnedToEntry) {
          const closedQty = updatedPos.qty * updatedPos.remaining_qty_pct / 100;
          const pnlPct = computePnlPercent(pos.side, pos.entry_price, markPrice);
          const pnlUsd = closedQty * pos.entry_price * (pnlPct / 100);
          const totalPnl = persistence.getPaperPositionTotalPnl(pos.id) + pnlUsd;

          persistence.insertPaperTpEvent({
            created_at: now,
            paper_position_id: pos.id,
            paper_bot_id: pos.paper_bot_id,
            symbol: pos.symbol,
            event_type: 'be_close',
            action_key: 'be_close',
            trigger_percent: 0,
            close_percent: 100,
            mark_price: markPrice,
            qty_closed: closedQty,
            pnl_pct: pnlPct,
            pnl_usd: pnlUsd,
          });
          persistence.closePaperPosition({
            id: pos.id,
            exit_price: markPrice,
            exit_reason: 'break_even',
            exit_pnl_pct: pnlPct,
            exit_pnl_usd: totalPnl,
            closed_at: now,
          });
          logger.info('[Paper] BE close', { id: pos.id, paper_bot_id: pos.paper_bot_id });
        }
      }
    } catch (err) {
      logger.warn('[Paper] Error managing position', { id: pos.id, error: err.message });
    }
  }
}


function getPaperV2BotForLiveBot(liveBotId) {
  const registry = loadPaperRegistry();
  return registry.bots.find(b => b.liveBotId === liveBotId && b.system === 'v2') || null;
}

function getPaperV2Balance(persistence) {
  const baseline = Number(process.env.PAPER2_BASELINE_USDT || 0);
  const closed = persistence.getClosedPaperPositions()
    .filter(p => p.paper_bot_id && p.paper_bot_id.startsWith('P2_'));
  const realized = closed.reduce((sum, p) => sum + (Number(p.exit_pnl_usd) || 0), 0);
  return baseline + realized;
}

async function executePaperV2Entry(parsedSignal, options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const registry = loadPaperRegistry();
  const paperBot = getPaperV2BotForLiveBot(parsedSignal.botId);
  if (!paperBot) return { ok: false, reason: 'no_v2_paper_bot_configured' };

  const openPos = persistence.getOpenPaperPosition(paperBot.paperBotId);
  if (openPos) {
    logger.info('[P2] Entry skipped — position already open', { paperBotId: paperBot.paperBotId });
    return { ok: false, reason: 'position_already_open' };
  }

  const isEnterSignal = parsedSignal.signal === 'ENTER_LONG' || parsedSignal.signal === 'ENTER_SHORT';
  if (!isEnterSignal) return { ok: false, reason: 'not_enter_signal' };

  // Compute S3 score (both v1 and v2)
  const settingsPath = path.join(__dirname, '..', '..', 'config', 'settings.json');
  const settingsRaw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const s3Config = settingsRaw.s3;
  const bybitBaseUrl = process.env.BYBIT_BASE_URL || 'https://api.bybit.com';

  let s3Result;
  try {
    s3Result = await computeS3Score({
      signal: parsedSignal.signal,
      botId: parsedSignal.botId,
      symbol: paperBot.symbol,
      db: persistence,
      s3Config,
      bybitBaseUrl,
    });
  } catch (err) {
    logger.warn('[P2] S3 scoring failed — blocking entry', { error: err.message });
    return { ok: false, blocked: true, reason: 's3_error', error: err.message };
  }

  const v1Score = s3Result.score;
  const v2Score = s3Result.scoreV2 != null ? s3Result.scoreV2 : v1Score; // fall back to v1 if v2 unavailable
  const now = new Date().toISOString();

  // Capital pool state — computed from all currently open P2 positions
  const totalPot = getPaperV2Balance(persistence);
  const openP2Positions = persistence.getOpenP2Positions();
  const poolState = computePoolState(totalPot, openP2Positions);
  const allocation = computeAllocation(v2Score, poolState);

  // Log capital_pool_event regardless of outcome
  const cpEventBase = {
    created_at: now,
    bot_id: parsedSignal.botId,
    symbol: paperBot.symbol,
    v1_score: v1Score,
    v2_score: v2Score,
    score_tier: allocation.tier.name,
    total_pot: totalPot,
    reserved_capital: poolState.reservedCapital,
    deployed_capital: poolState.deployedCapital,
    available_dynamic: poolState.availableDynamic,
    base_allocation: allocation.baseAllocation,
    dynamic_allocation: allocation.dynamicAllocation,
    notional_allocated: allocation.notionalAllocated,
    stage1_notional: allocation.stage1Notional,
    block_reason: allocation.blockReason || null,
    details_json: null,
  };

  if (allocation.blocked) {
    persistence.insertCapitalPoolEvent({ ...cpEventBase, signal_type: 'BLOCKED' });
    logger.info('[P2] BLOCKED by capital pool', {
      paperBotId: paperBot.paperBotId, v2Score, tier: allocation.tier.name,
      blockReason: allocation.blockReason,
    });
    return { ok: false, blocked: true, reason: 'capital_pool_block', v2Score, tier: allocation.tier.name, blockReason: allocation.blockReason };
  }

  // Gate passed — enter paper position at stage1 notional
  const symbol = paperBot.symbol;
  const side = parsedSignal.signal === 'ENTER_LONG' ? 'Buy' : 'Sell';
  const entryPrice = await getMarkPrice(symbol);
  const notionalUsd = allocation.stage1Notional;
  const qty = notionalUsd / entryPrice;

  persistence.insertPaperPosition({
    created_at: now,
    paper_bot_id: paperBot.paperBotId,
    live_bot_id: parsedSignal.botId,
    symbol,
    side,
    signal: parsedSignal.signal,
    entry_price: entryPrice,
    qty,
    notional_usd: notionalUsd,
  });

  persistence.insertCapitalPoolEvent({ ...cpEventBase, signal_type: parsedSignal.signal });

  logger.info('[P2] Capital pool entry', {
    paperBotId: paperBot.paperBotId, symbol, side, entryPrice,
    v2Score, tier: allocation.tier.name,
    notionalAllocated: allocation.notionalAllocated.toFixed(2),
    stage1: notionalUsd.toFixed(2),
    poolAvailable: poolState.availableDynamic.toFixed(2),
  });
  return { ok: true, paperBotId: paperBot.paperBotId, symbol, side, entryPrice,
           v1Score, v2Score, tier: allocation.tier.name, notionalUsd, allocation };
}

async function executePaperV2SignalClose(parsedSignal, options = {}) {
  const { dbPath, logger = console } = options;
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const paperBot = getPaperV2BotForLiveBot(parsedSignal.botId);
  if (!paperBot) return { ok: false, reason: 'no_v2_paper_bot_configured' };

  const openPos = persistence.getOpenPaperPosition(paperBot.paperBotId);
  if (!openPos) return { ok: true, action: 'no_position' };

  const expectedSide = parsedSignal.signal === 'EXIT_LONG' ? 'Buy' : 'Sell';
  if (openPos.side !== expectedSide) return { ok: true, action: 'direction_mismatch' };

  const exitPrice = await getMarkPrice(openPos.symbol);
  const pnlPct = computePnlPercent(openPos.side, openPos.entry_price, exitPrice);
  const remainingQty = openPos.qty * (openPos.remaining_qty_pct / 100);
  const pnlUsd = remainingQty * openPos.entry_price * (pnlPct / 100);

  persistence.closePaperPosition({
    id: openPos.id,
    exit_price: exitPrice,
    exit_reason: 'signal_exit',
    exit_pnl_pct: pnlPct,
    exit_pnl_usd: pnlUsd,
    closed_at: new Date().toISOString(),
  });

  persistence.insertPaperTpEvent({
    created_at: new Date().toISOString(),
    paper_position_id: openPos.id,
    paper_bot_id: paperBot.paperBotId,
    symbol: openPos.symbol,
    event_type: 'signal_exit',
    action_key: 'signal_exit',
    trigger_percent: 0,
    close_percent: 100,
    mark_price: exitPrice,
    qty_closed: remainingQty,
    pnl_pct: pnlPct,
    pnl_usd: pnlUsd,
  });

  logger.info('[P2] Signal exit', { paperBotId: paperBot.paperBotId, symbol: openPos.symbol, exitPrice, pnlPct: pnlPct && pnlPct.toFixed(2) });
  return { ok: true, action: 'signal_exit', pnlPct, pnlUsd };
}

module.exports = {
  executePaperEntry,
  executePaperSignalClose,
  managePaperPositions,
  getPaperBotForLiveBot,
  getPaperBalance,
  executePaperV2Entry,
  executePaperV2SignalClose,
  getPaperV2Balance,
};
