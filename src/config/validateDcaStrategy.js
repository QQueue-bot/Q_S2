function validateDcaStrategy(strategy) {
  const errors = [];
  const warnings = [];

  if (!strategy || typeof strategy !== 'object') {
    errors.push('DCA strategy must be an object');
    return { ok: false, errors, warnings };
  }

  if (strategy.mode !== 'impulse_aware_confirmation') {
    errors.push('Only impulse_aware_confirmation mode is supported in E2');
  }

  const initial = strategy.entries?.initialEntryPercent;
  const add = strategy.entries?.addEntryPercent;
  if (typeof initial !== 'number' || typeof add !== 'number') {
    errors.push('Initial and add entry percents must be numeric');
  } else if (Math.abs((initial + add) - 100) > 0.000001) {
    errors.push('Initial and add entry percents must total exactly 100');
  }

  if (strategy.entries?.maxAdds !== 1) {
    errors.push('Candidate A currently supports maxAdds = 1 only');
  }

  if (!strategy.impulseDetection?.enabled) {
    warnings.push('Impulse detection is disabled; Candidate A assumes it is enabled');
  }

  if (typeof strategy.impulseDetection?.lookbackCandles !== 'number' || strategy.impulseDetection.lookbackCandles <= 0) {
    errors.push('impulseDetection.lookbackCandles must be numeric and > 0');
  }

  if (typeof strategy.impulseDetection?.rangeMultiplier !== 'number' || strategy.impulseDetection.rangeMultiplier <= 0) {
    errors.push('impulseDetection.rangeMultiplier must be numeric and > 0');
  }

  if (typeof strategy.addTiming?.minDelayCandles !== 'number' || typeof strategy.addTiming?.maxDelayCandles !== 'number') {
    errors.push('addTiming delays must be numeric');
  } else if (strategy.addTiming.minDelayCandles > strategy.addTiming.maxDelayCandles) {
    errors.push('addTiming.minDelayCandles must be <= addTiming.maxDelayCandles');
  }

  const guards = strategy.guards || {};
  ['blockIfBreakEvenArmed', 'blockIfTakeProfitStarted', 'blockIfOppositeSignal', 'blockIfRegimeInvalid'].forEach((key) => {
    if (typeof guards[key] !== 'boolean') {
      errors.push(`guards.${key} must be boolean`);
    }
  });

  if (strategy.stopBehavior?.alterStopOnAdd !== false) {
    errors.push('Candidate A requires alterStopOnAdd = false');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateDcaStrategy,
};
