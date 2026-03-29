const fs = require('fs');
const path = require('path');

function loadMdxSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`MDX source file not found: ${sourcePath}`);
  }

  return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
}

function validatePercentArray(name, value) {
  if (!Array.isArray(value) || value.length !== 6 || value.some(item => typeof item !== 'number' || Number.isNaN(item))) {
    throw new Error(`${name} must be an array of 6 numeric values`);
  }
}

function resolveBreakEvenTrigger(slToBeTrigger, strategy) {
  if (slToBeTrigger === 'TP1') {
    return strategy.tpTargetsPercent[0];
  }
  throw new Error(`Unsupported SL to BE trigger: ${slToBeTrigger}`);
}

function resolveMdxSettings(options = {}) {
  const sourcePath = options.sourcePath || path.join(__dirname, '..', '..', 'mdx', 'Bot1.source.json');
  const source = loadMdxSource(sourcePath);
  const selectedProfile = options.profile || source.defaultProfile || 'balanced';
  const profile = source.profiles?.[selectedProfile];

  if (!profile) {
    throw new Error(`MDX profile not found: ${selectedProfile}`);
  }

  const strategy = profile.strategy;
  if (!strategy || typeof strategy !== 'object') {
    throw new Error(`MDX strategy block missing for profile: ${selectedProfile}`);
  }

  validatePercentArray('tpTargetsPercent', strategy.tpTargetsPercent);
  validatePercentArray('tpAllocationsPercent', strategy.tpAllocationsPercent);

  if (typeof strategy.stopLossPercent !== 'number' || Number.isNaN(strategy.stopLossPercent)) {
    throw new Error(`stopLossPercent must be numeric for profile: ${selectedProfile}`);
  }

  if (typeof strategy.leverage !== 'number' || Number.isNaN(strategy.leverage)) {
    throw new Error(`leverage must be numeric for profile: ${selectedProfile}`);
  }

  const warnings = [];
  if (source.signalBotSourceMeta?.slType) {
    warnings.push(`slType is metadata-only in D3 and not runtime-mapped: ${source.signalBotSourceMeta.slType}`);
  }
  if (typeof source.signalBotSourceMeta?.slValue !== 'undefined') {
    warnings.push('slValue is metadata-only in D3 and not runtime-mapped');
  }

  const runtimeSettings = {
    positionSizing: {
      leverage: strategy.leverage,
    },
    takeProfit: {
      enabled: true,
      levels: strategy.tpTargetsPercent.map((triggerPercent, index) => ({
        index: index + 1,
        triggerPercent,
        closePercent: strategy.tpAllocationsPercent[index],
        enabled: triggerPercent > 0 && strategy.tpAllocationsPercent[index] > 0,
      })),
    },
    stopLoss: {
      enabled: strategy.stopLossPercent > 0,
      triggerPercent: strategy.stopLossPercent,
    },
    breakEven: {
      enabled: true,
      triggerPercent: resolveBreakEvenTrigger(strategy.slToBeTrigger, strategy),
      sourceRule: `slToBeTrigger=${strategy.slToBeTrigger}`,
    },
  };

  return {
    botMeta: source.botMeta,
    selectedProfile,
    runtimeSettings,
    metadata: {
      signalBotSourceMeta: source.signalBotSourceMeta,
      sourcePerformanceMeta: source.sourcePerformanceMeta,
      profilePerformanceMeta: profile.performanceMeta || {},
    },
    warnings,
  };
}

module.exports = {
  loadMdxSource,
  resolveMdxSettings,
};
