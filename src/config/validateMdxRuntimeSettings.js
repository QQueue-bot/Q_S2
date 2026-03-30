function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function validateStrictlyIncreasing(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] > values[index - 1])) {
      return false;
    }
  }
  return true;
}

function validateMdxRuntimeSettings(resolved) {
  const errors = [];
  const warnings = [...(resolved.warnings || [])];
  const runtimeSettings = resolved.runtimeSettings || {};

  const tpLevels = runtimeSettings.takeProfit?.levels;
  if (!Array.isArray(tpLevels) || tpLevels.length !== 6) {
    errors.push('takeProfit.levels must contain exactly 6 levels');
  } else {
    const triggerPercents = tpLevels.map(level => level.triggerPercent);
    const closePercents = tpLevels.map(level => level.closePercent);

    if (triggerPercents.some(value => typeof value !== 'number' || Number.isNaN(value) || value <= 0)) {
      errors.push('All TP triggerPercent values must be numeric and greater than 0');
    }

    if (closePercents.some(value => typeof value !== 'number' || Number.isNaN(value) || value <= 0)) {
      errors.push('All TP closePercent values must be numeric and greater than 0');
    }

    if (!validateStrictlyIncreasing(triggerPercents)) {
      errors.push('TP triggerPercent values must be strictly increasing');
    }

    const totalAllocation = sum(closePercents);
    if (Math.abs(totalAllocation - 100) > 0.000001) {
      errors.push(`TP closePercent values must total exactly 100; got ${totalAllocation}`);
    }
  }

  const stopLoss = runtimeSettings.stopLoss;
  if (!stopLoss?.enabled || typeof stopLoss.triggerPercent !== 'number' || Number.isNaN(stopLoss.triggerPercent) || stopLoss.triggerPercent <= 0) {
    errors.push('stopLoss.triggerPercent must be numeric and greater than 0');
  }

  const breakEven = runtimeSettings.breakEven;
  if (!breakEven?.enabled || typeof breakEven.triggerPercent !== 'number' || Number.isNaN(breakEven.triggerPercent) || breakEven.triggerPercent <= 0) {
    errors.push('breakEven.triggerPercent must be numeric and greater than 0');
  }

  if (!breakEven?.sourceRule || !/(TP1|TP2|TP3)/.test(String(breakEven.sourceRule))) {
    errors.push('Only SL to BE = TP1, TP2, or TP3 is supported currently');
  }

  const leverage = runtimeSettings.positionSizing?.leverage;
  if (typeof leverage !== 'number' || Number.isNaN(leverage) || leverage <= 0) {
    errors.push('positionSizing.leverage must be numeric and greater than 0');
  }
  if (typeof leverage === 'number' && leverage > 10) {
    warnings.push(`Leverage ${leverage} is unusually high for current S2 policy`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = {
  validateMdxRuntimeSettings,
};
