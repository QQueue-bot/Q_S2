function averageRange(candles) {
  const ranges = candles.map(c => Math.abs(Number(c.high) - Number(c.low)));
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function classifyTriggerCandle(triggerCandle, recentCandles, strategy) {
  if (!strategy.impulseDetection.enabled || !triggerCandle || !Array.isArray(recentCandles) || recentCandles.length === 0) {
    return { impulsive: false, triggerRange: null, averageRange: null };
  }

  const triggerRange = Math.abs(Number(triggerCandle.high) - Number(triggerCandle.low));
  const avg = averageRange(recentCandles);
  const threshold = avg * strategy.impulseDetection.rangeMultiplier;

  return {
    impulsive: triggerRange > threshold,
    triggerRange,
    averageRange: avg,
    threshold,
  };
}

function shouldBlockDcaAdd(guards = {}) {
  const reasons = [];
  if (guards.breakEvenArmed) reasons.push('break_even_armed');
  if (guards.takeProfitStarted) reasons.push('take_profit_started');
  if (guards.oppositeSignal) reasons.push('opposite_signal');
  if (guards.regimeInvalid) reasons.push('regime_invalid');
  return {
    blocked: reasons.length > 0,
    reasons,
  };
}

module.exports = {
  classifyTriggerCandle,
  shouldBlockDcaAdd,
};
