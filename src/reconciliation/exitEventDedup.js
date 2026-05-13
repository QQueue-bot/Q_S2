const DEFAULT_TOLERANCES = Object.freeze({
  qtyRelTol: 0.005,
  priceRelTol: 0.005,
  timeMs: 5 * 60 * 1000,
});

function relDiff(a, b) {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return 0;
  return Math.abs(a - b) / denom;
}

function parseIsoMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function isClosedPnlDuplicate(closedPnlRecord, existingExitEvents, tolerances = {}) {
  if (!closedPnlRecord) return false;
  if (!Array.isArray(existingExitEvents) || existingExitEvents.length === 0) return false;
  const tol = { ...DEFAULT_TOLERANCES, ...tolerances };
  const targetQty = Number(closedPnlRecord.qty);
  const targetPrice = Number(closedPnlRecord.avgExitPrice);
  const targetTimeMs = closedPnlRecord.updatedTimeMs;
  if (!Number.isFinite(targetQty) || !Number.isFinite(targetPrice) || !Number.isFinite(targetTimeMs)) {
    return false;
  }
  for (const ev of existingExitEvents) {
    if (!ev) continue;
    if (closedPnlRecord.symbol && ev.symbol && ev.symbol !== closedPnlRecord.symbol) continue;
    if (closedPnlRecord.closingSide && ev.side && ev.side !== closedPnlRecord.closingSide) continue;
    const evQty = Number(ev.qty);
    const evPrice = Number(ev.mark_price);
    const evTimeMs = parseIsoMs(ev.created_at);
    if (!Number.isFinite(evQty) || !Number.isFinite(evPrice) || evTimeMs === null) continue;
    if (relDiff(evQty, targetQty) > tol.qtyRelTol) continue;
    if (relDiff(evPrice, targetPrice) > tol.priceRelTol) continue;
    if (Math.abs(evTimeMs - targetTimeMs) > tol.timeMs) continue;
    return true;
  }
  return false;
}

function filterUnreconciled(closedPnlRecords, existingExitEvents, tolerances = {}) {
  if (!Array.isArray(closedPnlRecords)) return [];
  return closedPnlRecords.filter((rec) => !isClosedPnlDuplicate(rec, existingExitEvents, tolerances));
}

module.exports = {
  DEFAULT_TOLERANCES,
  isClosedPnlDuplicate,
  filterUnreconciled,
  __test__: { relDiff, parseIsoMs },
};
