'use strict';

// Pure sizing math for S2.1.
//
// Two rules from the spec (Part 1, "Critical correctness requirements" §4):
//   - T1 is EXACTLY half of the intended size (floor-rounded to qty step).
//   - T2 absorbs the rounding delta: T2 = intended - T1.
//     So T1 + T2 always equals the rounded intended total.
//   - Both T1 and T2 must clear minOrderQty independently.

function decimalPlaces(value) {
  const text = String(value);
  if (!text.includes('.')) return 0;
  return text.split('.')[1].length;
}

function floorToStep(value, step) {
  const precision = decimalPlaces(step);
  const floored = Math.floor(value / step) * step;
  return Number(floored.toFixed(precision));
}

function formatQty(value, step) {
  return Number(value).toFixed(decimalPlaces(step));
}

// Given a target notional and current price, return the rounded intended qty.
function computeIntendedQty({ notionalUsd, referencePrice, qtyStep, minOrderQty, minNotionalValue }) {
  const raw = notionalUsd / referencePrice;
  const qty = floorToStep(raw, qtyStep);
  if (qty < minOrderQty) {
    throw new Error(`Intended qty ${qty} is below minOrderQty ${minOrderQty} for notional $${notionalUsd}`);
  }
  const finalNotional = qty * referencePrice;
  if (finalNotional < minNotionalValue) {
    throw new Error(`Intended notional ${finalNotional} is below minNotionalValue ${minNotionalValue}`);
  }
  return qty;
}

// Split into T1 and T2. T1 is exactly half of `intendedQty` (floor to step).
// T2 = intendedQty - T1 — absorbs all rounding so the sum equals the intended.
function splitT1T2({ intendedQty, t1Fraction, qtyStep, minOrderQty }) {
  if (!(t1Fraction > 0 && t1Fraction < 1)) {
    throw new Error(`t1Fraction must be in (0, 1), got ${t1Fraction}`);
  }
  const t1Raw = intendedQty * t1Fraction;
  const t1Qty = floorToStep(t1Raw, qtyStep);
  const t2Qty = Number((intendedQty - t1Qty).toFixed(decimalPlaces(qtyStep)));

  if (t1Qty < minOrderQty) {
    throw new Error(`T1 qty ${t1Qty} below minOrderQty ${minOrderQty}`);
  }
  if (t2Qty < minOrderQty) {
    throw new Error(`T2 qty ${t2Qty} below minOrderQty ${minOrderQty}`);
  }

  // Invariant: t1 + t2 == intendedQty (within step precision)
  const sumCheck = Number((t1Qty + t2Qty).toFixed(decimalPlaces(qtyStep)));
  if (Math.abs(sumCheck - intendedQty) > qtyStep * 0.5) {
    throw new Error(`Sizing invariant broken: T1(${t1Qty}) + T2(${t2Qty}) != intended(${intendedQty})`);
  }

  return { t1Qty, t2Qty };
}

// Distribute a tranche's size across the 6 TP allocations. Each TP qty is
// floor-rounded to step. Last (deepest) TP absorbs any rounding delta so the
// sum equals the tranche size — guarantees no residual position dust.
function tpLadderQuantities({ trancheQty, allocations, qtyStep, minOrderQty }) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error('allocations must be a non-empty array');
  }
  const allocSum = allocations.reduce((a, b) => a + b, 0);
  if (Math.abs(allocSum - 1.0) > 0.001) {
    throw new Error(`allocations must sum to 1.0, got ${allocSum}`);
  }

  const qtys = allocations.map(alloc => floorToStep(trancheQty * alloc, qtyStep));
  const placed = qtys.slice(0, -1).reduce((a, b) => a + b, 0);
  const lastQty = Number((trancheQty - placed).toFixed(decimalPlaces(qtyStep)));
  qtys[qtys.length - 1] = lastQty;

  for (let i = 0; i < qtys.length; i++) {
    if (qtys[i] < minOrderQty) {
      throw new Error(
        `TP${i + 1} qty ${qtys[i]} below minOrderQty ${minOrderQty} ` +
        `(tranche ${trancheQty}, alloc ${allocations[i]}). Increase notional.`
      );
    }
  }

  // Invariant: sum of qtys == trancheQty
  const sumCheck = Number(qtys.reduce((a, b) => a + b, 0).toFixed(decimalPlaces(qtyStep)));
  if (Math.abs(sumCheck - trancheQty) > qtyStep * 0.5) {
    throw new Error(`TP ladder invariant broken: sum(${sumCheck}) != tranche(${trancheQty})`);
  }

  return qtys;
}

// Compute T2 trigger price from snapshot atrPct and entry direction.
// Long:  trigger = entry * (1 + noiseBandMult * atrPct / 100)
// Short: trigger = entry * (1 - noiseBandMult * atrPct / 100)
function computeT2Trigger({ entryPrice, atrPct, noiseBandMult, direction }) {
  const sign = direction === 'LONG' ? 1 : (direction === 'SHORT' ? -1 : null);
  if (sign === null) throw new Error(`Invalid direction: ${direction}`);
  return entryPrice * (1 + sign * noiseBandMult * atrPct / 100);
}

// Compute the 6 TP absolute prices from entry and target percents.
// Same direction logic as the trigger.
function computeTpPrices({ entryPrice, tpTargetsPercent, direction }) {
  const sign = direction === 'LONG' ? 1 : (direction === 'SHORT' ? -1 : null);
  if (sign === null) throw new Error(`Invalid direction: ${direction}`);
  return tpTargetsPercent.map(pct => entryPrice * (1 + sign * pct / 100));
}

// SL price for a tranche based on a percentage drawdown from its entry.
// For T1, entry = T1 fill. For T2 with breakeven mode, slPercent is implicit (0).
function computeSlPrice({ entryPrice, slPercent, direction }) {
  const sign = direction === 'LONG' ? -1 : 1;  // SL is in the opposite direction
  return entryPrice * (1 + sign * slPercent / 100);
}

module.exports = {
  decimalPlaces,
  floorToStep,
  formatQty,
  computeIntendedQty,
  splitT1T2,
  tpLadderQuantities,
  computeT2Trigger,
  computeTpPrices,
  computeSlPrice,
};
