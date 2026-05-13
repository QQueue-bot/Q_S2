'use strict';

// Order placement / cancellation for S2.1.
//
// Every order placed by this module carries an `orderLinkId` prefixed with the
// trade_id (e.g. "s21_bot9_0001_t2_trigger"). This is the forensic anchor for
// orphan-cleanup: when we want to cancel "all orders for this trade", we fetch
// open orders for the symbol and filter by prefix. That way the engine never
// touches orders it didn't place — important during the transition window
// where Bot1 may still hold DEEPUSDT legacy orders on a different sub-account.
//
// Two modes:
//   - live:    real Bybit calls via bybitClient
//   - dry-run: no network calls. Returns a synthetic response shape that
//              matches Bybit's so the engine can't tell which mode it's in.

// bybitClient is loaded lazily so dry-run paths don't pull axios. The require
// only resolves when a live network call is actually made.
function _client() { return require('./bybitClient'); }

// Build the conventional link id for a trade-scoped order.
function linkId(tradeId, purpose) {
  return `${tradeId}_${purpose}`;
}

function _sideForExit(direction) {
  return direction === 'LONG' ? 'Sell' : 'Buy';
}

function _sideForEntry(direction) {
  return direction === 'LONG' ? 'Buy' : 'Sell';
}

// Bybit triggerDirection: 1 = price rises THROUGH trigger, 2 = price falls THROUGH trigger.
function _triggerDirForStopEntry(direction) {
  // Long entry trigger fires when price rises through trigger; short when it falls.
  return direction === 'LONG' ? 1 : 2;
}

function _triggerDirForStopLoss(direction) {
  // Long SL fires when price falls through SL; short SL when it rises.
  return direction === 'LONG' ? 2 : 1;
}

// Synthetic response that mimics Bybit's shape for dry-run.
function _dryRunResponse(orderLinkId, extra = {}) {
  return {
    ok: true,
    dryRun: true,
    json: {
      retCode: 0,
      retMsg: 'OK (dry-run)',
      result: {
        orderId: `dry_${orderLinkId}_${Date.now()}`,
        orderLinkId,
        ...extra,
      },
    },
  };
}

async function placeT1Market({ tradeId, symbol, direction, qty, credentials, dryRun, options }) {
  const orderLinkId = linkId(tradeId, 't1_market');
  if (dryRun) {
    return _dryRunResponse(orderLinkId);
  }
  return _client().placeOrder({
    category: 'linear',
    symbol,
    side: _sideForEntry(direction),
    orderType: 'Market',
    qty: String(qty),
    positionIdx: 0,
    orderLinkId,
  }, credentials, options);
}

async function placeT1StopLoss({ tradeId, symbol, direction, qty, slPrice, credentials, dryRun, options }) {
  const orderLinkId = linkId(tradeId, 't1_sl');
  if (dryRun) return _dryRunResponse(orderLinkId);
  return _client().placeOrder({
    category: 'linear',
    symbol,
    side: _sideForExit(direction),
    orderType: 'Market',
    qty: String(qty),
    triggerPrice: String(slPrice),
    triggerDirection: _triggerDirForStopLoss(direction),
    triggerBy: 'LastPrice',
    reduceOnly: true,
    positionIdx: 0,
    orderLinkId,
  }, credentials, options);
}

async function placeT2Trigger({ tradeId, symbol, direction, qty, triggerPrice, credentials, dryRun, options }) {
  const orderLinkId = linkId(tradeId, 't2_trigger');
  if (dryRun) return _dryRunResponse(orderLinkId, { triggerPrice });
  return _client().placeOrder({
    category: 'linear',
    symbol,
    side: _sideForEntry(direction),
    orderType: 'Market',
    qty: String(qty),
    triggerPrice: String(triggerPrice),
    triggerDirection: _triggerDirForStopEntry(direction),
    triggerBy: 'LastPrice',
    positionIdx: 0,
    orderLinkId,
  }, credentials, options);
}

async function placeT2StopLoss({ tradeId, symbol, direction, qty, slPrice, credentials, dryRun, options }) {
  const orderLinkId = linkId(tradeId, 't2_sl');
  if (dryRun) return _dryRunResponse(orderLinkId);
  return _client().placeOrder({
    category: 'linear',
    symbol,
    side: _sideForExit(direction),
    orderType: 'Market',
    qty: String(qty),
    triggerPrice: String(slPrice),
    triggerDirection: _triggerDirForStopLoss(direction),
    triggerBy: 'LastPrice',
    reduceOnly: true,
    positionIdx: 0,
    orderLinkId,
  }, credentials, options);
}

// Place all six TP limits for a tranche. Returns array of responses.
async function placeTpLadder({ tradeId, symbol, direction, tranche, tpPrices, tpQtys, credentials, dryRun, options }) {
  if (tpPrices.length !== tpQtys.length) {
    throw new Error('tpPrices and tpQtys length mismatch');
  }
  const responses = [];
  for (let i = 0; i < tpPrices.length; i++) {
    const orderLinkId = linkId(tradeId, `${tranche}_tp${i + 1}`);
    if (dryRun) {
      responses.push(_dryRunResponse(orderLinkId, { tpIdx: i, price: tpPrices[i] }));
      continue;
    }
    const resp = await _client().placeOrder({
      category: 'linear',
      symbol,
      side: _sideForExit(direction),
      orderType: 'Limit',
      qty: String(tpQtys[i]),
      price: String(tpPrices[i]),
      reduceOnly: true,
      positionIdx: 0,
      orderLinkId,
    }, credentials, options);
    responses.push(resp);
  }
  return responses;
}

// THE ORPHAN-CLEANUP FUNCTION. Cancels every order for this symbol whose
// orderLinkId starts with the given tradeId prefix. Runs on every close path —
// SL hits, MDX EXIT, full TP ladder, lifecycle errors.
//
// Returns { cancelledCount, attemptedCount, errors } so callers can log
// and detect partial failures.
async function cancelAllForTrade({ tradeId, symbol, credentials, dryRun, options }) {
  if (dryRun) {
    return { cancelledCount: 0, attemptedCount: 0, errors: [], dryRun: true };
  }
  const openOrders = await _client().getOpenOrders({ symbol }, credentials, options);
  const ours = openOrders.filter(o => String(o.orderLinkId || '').startsWith(tradeId));
  let cancelled = 0;
  const errors = [];
  for (const order of ours) {
    try {
      const resp = await _client().cancelOrder(
        { symbol, orderId: order.orderId },
        credentials,
        options
      );
      if (resp.ok && resp.json?.retCode === 0) {
        cancelled++;
      } else {
        errors.push({ orderId: order.orderId, retCode: resp.json?.retCode, retMsg: resp.json?.retMsg });
      }
    } catch (err) {
      errors.push({ orderId: order.orderId, error: err.message });
    }
  }
  return { cancelledCount: cancelled, attemptedCount: ours.length, errors, dryRun: false };
}

// Market-close any residual position. Used by MDX EXIT path after orphan
// cleanup. Returns the close-order response.
async function marketClosePosition({ tradeId, symbol, direction, credentials, dryRun, options }) {
  const orderLinkId = linkId(tradeId, 'mdx_exit_close');
  if (dryRun) return _dryRunResponse(orderLinkId);
  const position = await _client().getLivePosition(symbol, credentials, options);
  if (!position || Number(position.size || 0) === 0) {
    return { ok: true, json: { retCode: 0, retMsg: 'No position to close', result: null } };
  }
  return _client().placeOrder({
    category: 'linear',
    symbol,
    side: _sideForExit(direction),
    orderType: 'Market',
    qty: String(position.size),
    reduceOnly: true,
    positionIdx: 0,
    orderLinkId,
  }, credentials, options);
}

module.exports = {
  linkId,
  placeT1Market,
  placeT1StopLoss,
  placeT2Trigger,
  placeT2StopLoss,
  placeTpLadder,
  cancelAllForTrade,
  marketClosePosition,
  // exposed for unit testing
  _sideForEntry,
  _sideForExit,
  _triggerDirForStopEntry,
  _triggerDirForStopLoss,
};
