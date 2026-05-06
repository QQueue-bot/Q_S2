'use strict';

const POOL_BOTS = 8;
const BASE_RESERVE_PCT = 0.05;  // 5% per bot → 8 × 5% = 40% total reserved
const FREE_POOL_PCT    = 0.60;  // 60% available as dynamic pool
const MAX_POSITION_PCT = 0.30;  // 30% hard cap per single position

const SCORE_TIERS = [
  { min: 70, name: 'HIGH',  dynamicSharePct: 0.25 },
  { min: 50, name: 'MED',   dynamicSharePct: 0.15 },
  { min: 35, name: 'LOW',   dynamicSharePct: 0.05 },
  { min:  0, name: 'BLOCK', dynamicSharePct: 0.00 },
];

function getScoreTier(v2Score) {
  for (const tier of SCORE_TIERS) {
    if (v2Score >= tier.min) return tier;
  }
  return SCORE_TIERS[SCORE_TIERS.length - 1];
}

function computePoolState(totalPot, openP2Positions) {
  const reservedCapital  = POOL_BOTS * BASE_RESERVE_PCT * totalPot;
  const deployedCapital  = openP2Positions.reduce((s, p) => s + (Number(p.notional_usd) || 0), 0);
  const freePool         = FREE_POOL_PCT * totalPot;
  const availableDynamic = Math.max(0, freePool - deployedCapital);
  return { totalPot, reservedCapital, deployedCapital, freePool, availableDynamic };
}

function computeAllocation(v2Score, poolState) {
  const { totalPot, availableDynamic } = poolState;
  const tier           = getScoreTier(v2Score);
  const baseAllocation = BASE_RESERVE_PCT * totalPot;
  const maxPosition    = MAX_POSITION_PCT * totalPot;

  if (tier.name === 'BLOCK') {
    return { tier, baseAllocation, dynamicAllocation: 0, notionalAllocated: 0,
             stage1Notional: 0, blocked: true, blockReason: 'SCORE_BELOW_35' };
  }

  if (availableDynamic <= 0) {
    const notional = Math.min(baseAllocation, maxPosition);
    return { tier, baseAllocation: notional, dynamicAllocation: 0,
             notionalAllocated: notional, stage1Notional: notional * 0.5,
             blocked: false, blockReason: null, note: 'POOL_EXHAUSTED_BASE_ONLY' };
  }

  const rawDynamic       = tier.dynamicSharePct * availableDynamic;
  let notional           = baseAllocation + rawDynamic;
  notional               = Math.min(notional, maxPosition);
  const dynamicAllocation = Math.max(0, notional - baseAllocation);

  return { tier, baseAllocation, dynamicAllocation, notionalAllocated: notional,
           stage1Notional: notional * 0.5, blocked: false, blockReason: null };
}

module.exports = {
  computePoolState, computeAllocation, getScoreTier,
  POOL_BOTS, BASE_RESERVE_PCT, FREE_POOL_PCT, MAX_POSITION_PCT, SCORE_TIERS,
};
