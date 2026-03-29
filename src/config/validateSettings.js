const fs = require('fs');
const path = require('path');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues, severity, path, message) {
  issues.push({ severity, path, message });
}

function checkUnknownKeys(obj, allowed, objPath, issues) {
  if (!isPlainObject(obj)) return;
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      addIssue(issues, 'error', `${objPath}.${key}`, 'Unknown key');
    }
  }
}

function checkType(value, expected, objPath, issues) {
  const actual = Array.isArray(value) ? 'array' : typeof value;
  if (expected === 'array') {
    if (!Array.isArray(value)) addIssue(issues, 'error', objPath, `Expected array, got ${actual}`);
    return;
  }
  if (expected === 'object') {
    if (!isPlainObject(value)) addIssue(issues, 'error', objPath, `Expected object, got ${actual}`);
    return;
  }
  if (typeof value !== expected) addIssue(issues, 'error', objPath, `Expected ${expected}, got ${actual}`);
}

function validateSettingsObject(settings) {
  const issues = [];

  const topAllowed = ['configVersion', 'environment', 'trading', 'positionSizing', 'riskControls', 'takeProfit', 'stopLoss', 'breakEven', 'dca', 'storage', 'logging', 'priceMonitoring'];
  checkType(settings, 'object', 'settings', issues);
  if (!isPlainObject(settings)) {
    return finalize(settings, issues);
  }
  checkUnknownKeys(settings, topAllowed, 'settings', issues);

  const requiredTop = topAllowed;
  for (const key of requiredTop) {
    if (!(key in settings)) addIssue(issues, 'error', `settings.${key}`, 'Missing required key');
  }

  if (typeof settings.configVersion !== 'string' || !settings.configVersion.trim()) {
    addIssue(issues, 'error', 'settings.configVersion', 'configVersion must be a non-empty string');
  }

  const env = settings.environment;
  checkType(env, 'object', 'settings.environment', issues);
  if (isPlainObject(env)) {
    checkUnknownKeys(env, ['mode', 'exchange', 'marketType'], 'settings.environment', issues);
    if (!['testnet', 'mainnet'].includes(env.mode)) addIssue(issues, 'error', 'settings.environment.mode', 'Must be testnet or mainnet');
    if (env.exchange !== 'bybit') addIssue(issues, 'error', 'settings.environment.exchange', 'Must be bybit');
    if (env.marketType !== 'usdt_perpetual') addIssue(issues, 'error', 'settings.environment.marketType', 'Must be usdt_perpetual');
  }

  const trading = settings.trading;
  checkType(trading, 'object', 'settings.trading', issues);
  if (isPlainObject(trading)) {
    checkUnknownKeys(trading, ['enabled', 'defaultSymbol', 'allowedSymbols', 'supportedSignals', 'notes'], 'settings.trading', issues);
    if (typeof trading.enabled !== 'boolean') addIssue(issues, 'error', 'settings.trading.enabled', 'Must be boolean');
    if (typeof trading.defaultSymbol !== 'string' || !trading.defaultSymbol.endsWith('USDT')) addIssue(issues, 'error', 'settings.trading.defaultSymbol', 'Must be a USDT symbol string');
    if (!Array.isArray(trading.allowedSymbols) || trading.allowedSymbols.length < 1) {
      addIssue(issues, 'error', 'settings.trading.allowedSymbols', 'Must contain at least one symbol');
    }
    if (!Array.isArray(trading.supportedSignals) || trading.supportedSignals.length !== 4) {
      addIssue(issues, 'error', 'settings.trading.supportedSignals', 'Must contain the four supported signal types');
    }
  }

  const sizing = settings.positionSizing;
  checkType(sizing, 'object', 'settings.positionSizing', issues);
  if (isPlainObject(sizing)) {
    checkUnknownKeys(sizing, ['mode', 'accountPercent', 'leverage', 'notes'], 'settings.positionSizing', issues);
    if (sizing.mode !== 'account_percent') addIssue(issues, 'error', 'settings.positionSizing.mode', 'Must be account_percent');
    if (typeof sizing.accountPercent !== 'number' || sizing.accountPercent <= 0 || sizing.accountPercent > 100) addIssue(issues, 'error', 'settings.positionSizing.accountPercent', 'Must be > 0 and <= 100');
    if (typeof sizing.leverage !== 'number' || sizing.leverage <= 0) addIssue(issues, 'error', 'settings.positionSizing.leverage', 'Must be > 0');
  }

  const risk = settings.riskControls;
  checkType(risk, 'object', 'settings.riskControls', issues);
  if (isPlainObject(risk)) {
    checkUnknownKeys(risk, ['maxAccountPercent', 'maxLeverage', 'allowExitSignalsAsSafety', 'killSwitch', 'duplicateSignalWindowSeconds', 'staleSignalThresholdSeconds', 'notes'], 'settings.riskControls', issues);
    if (typeof risk.maxAccountPercent !== 'number' || risk.maxAccountPercent <= 0 || risk.maxAccountPercent > 100) addIssue(issues, 'error', 'settings.riskControls.maxAccountPercent', 'Must be > 0 and <= 100');
    if (typeof risk.maxLeverage !== 'number' || risk.maxLeverage <= 0) addIssue(issues, 'error', 'settings.riskControls.maxLeverage', 'Must be > 0');
    if (typeof risk.allowExitSignalsAsSafety !== 'boolean') addIssue(issues, 'error', 'settings.riskControls.allowExitSignalsAsSafety', 'Must be boolean');
    if (typeof risk.killSwitch !== 'boolean') addIssue(issues, 'error', 'settings.riskControls.killSwitch', 'Must be boolean');
    for (const field of ['duplicateSignalWindowSeconds', 'staleSignalThresholdSeconds']) {
      if (typeof risk[field] !== 'number' || risk[field] < 0) addIssue(issues, 'error', `settings.riskControls.${field}`, 'Must be >= 0');
    }
    if (isPlainObject(sizing) && sizing.accountPercent > risk.maxAccountPercent) addIssue(issues, 'error', 'settings.positionSizing.accountPercent', 'Exceeds riskControls.maxAccountPercent');
    if (isPlainObject(sizing) && sizing.leverage > risk.maxLeverage) addIssue(issues, 'error', 'settings.positionSizing.leverage', 'Exceeds riskControls.maxLeverage');
  }

  const tp = settings.takeProfit;
  checkType(tp, 'object', 'settings.takeProfit', issues);
  if (isPlainObject(tp)) {
    checkUnknownKeys(tp, ['enabled', 'levels', 'notes'], 'settings.takeProfit', issues);
    if (typeof tp.enabled !== 'boolean') addIssue(issues, 'error', 'settings.takeProfit.enabled', 'Must be boolean');
    if (!Array.isArray(tp.levels) || tp.levels.length !== 6) {
      addIssue(issues, 'error', 'settings.takeProfit.levels', 'Must contain exactly 6 take-profit levels');
    } else {
      tp.levels.forEach((level, index) => {
        checkType(level, 'object', `settings.takeProfit.levels[${index}]`, issues);
        if (!isPlainObject(level)) return;
        checkUnknownKeys(level, ['index', 'triggerPercent', 'closePercent', 'enabled'], `settings.takeProfit.levels[${index}]`, issues);
        if (level.index !== index + 1) addIssue(issues, 'error', `settings.takeProfit.levels[${index}].index`, 'Index must match position 1-6');
        if (typeof level.triggerPercent !== 'number' || level.triggerPercent < 0) addIssue(issues, 'error', `settings.takeProfit.levels[${index}].triggerPercent`, 'Must be >= 0');
        if (typeof level.closePercent !== 'number' || level.closePercent < 0 || level.closePercent > 100) addIssue(issues, 'error', `settings.takeProfit.levels[${index}].closePercent`, 'Must be between 0 and 100');
        if (typeof level.enabled !== 'boolean') addIssue(issues, 'error', `settings.takeProfit.levels[${index}].enabled`, 'Must be boolean');
      });
    }
  }

  const sl = settings.stopLoss;
  checkType(sl, 'object', 'settings.stopLoss', issues);
  if (isPlainObject(sl)) {
    checkUnknownKeys(sl, ['enabled', 'triggerPercent', 'notes'], 'settings.stopLoss', issues);
    if (typeof sl.enabled !== 'boolean') addIssue(issues, 'error', 'settings.stopLoss.enabled', 'Must be boolean');
    if (typeof sl.triggerPercent !== 'number' || sl.triggerPercent < 0) addIssue(issues, 'error', 'settings.stopLoss.triggerPercent', 'Must be >= 0');
  }

  const be = settings.breakEven;
  checkType(be, 'object', 'settings.breakEven', issues);
  if (isPlainObject(be)) {
    checkUnknownKeys(be, ['enabled', 'triggerPercent', 'notes'], 'settings.breakEven', issues);
    if (typeof be.enabled !== 'boolean') addIssue(issues, 'error', 'settings.breakEven.enabled', 'Must be boolean');
    if (typeof be.triggerPercent !== 'number' || be.triggerPercent < 0) addIssue(issues, 'error', 'settings.breakEven.triggerPercent', 'Must be >= 0');
  }

  const dca = settings.dca;
  checkType(dca, 'object', 'settings.dca', issues);
  if (isPlainObject(dca)) {
    checkUnknownKeys(dca, ['enabled', 'mode', 'maxAdds', 'levels', 'notes'], 'settings.dca', issues);
    if (typeof dca.enabled !== 'boolean') addIssue(issues, 'error', 'settings.dca.enabled', 'Must be boolean');
    if (dca.mode !== 'levels') addIssue(issues, 'error', 'settings.dca.mode', 'Must be levels');
    if (typeof dca.maxAdds !== 'number' || dca.maxAdds < 0) addIssue(issues, 'error', 'settings.dca.maxAdds', 'Must be >= 0');
    if (!Array.isArray(dca.levels)) addIssue(issues, 'error', 'settings.dca.levels', 'Must be an array');
  }

  const storage = settings.storage;
  checkType(storage, 'object', 'settings.storage', issues);
  if (isPlainObject(storage)) {
    checkUnknownKeys(storage, ['databasePath'], 'settings.storage', issues);
    if (typeof storage.databasePath !== 'string' || !storage.databasePath.trim()) addIssue(issues, 'error', 'settings.storage.databasePath', 'Must be a non-empty string');
  }

  const priceMonitoring = settings.priceMonitoring;
  checkType(priceMonitoring, 'object', 'settings.priceMonitoring', issues);
  if (isPlainObject(priceMonitoring)) {
    checkUnknownKeys(priceMonitoring, ['enabled', 'logEveryTick', 'samplingIntervalMs', 'notes'], 'settings.priceMonitoring', issues);
    if (typeof priceMonitoring.enabled !== 'boolean') addIssue(issues, 'error', 'settings.priceMonitoring.enabled', 'Must be boolean');
    if (typeof priceMonitoring.logEveryTick !== 'boolean') addIssue(issues, 'error', 'settings.priceMonitoring.logEveryTick', 'Must be boolean');
    if (typeof priceMonitoring.samplingIntervalMs !== 'number' || priceMonitoring.samplingIntervalMs < 0) addIssue(issues, 'error', 'settings.priceMonitoring.samplingIntervalMs', 'Must be >= 0');
  }

  const logging = settings.logging;
  checkType(logging, 'object', 'settings.logging', issues);
  if (isPlainObject(logging)) {
    checkUnknownKeys(logging, ['level'], 'settings.logging', issues);
    if (!['debug', 'info', 'warn', 'error'].includes(logging.level)) addIssue(issues, 'error', 'settings.logging.level', 'Must be debug, info, warn, or error');
  }

  const zeroPlaceholdersPresent = (
    isPlainObject(tp) && Array.isArray(tp.levels) && tp.levels.some(level => level.enabled && (level.triggerPercent === 0 || level.closePercent === 0))
  ) || (isPlainObject(sl) && sl.enabled && sl.triggerPercent === 0)
    || (isPlainObject(be) && be.enabled && be.triggerPercent === 0);

  if (isPlainObject(trading) && trading.enabled && zeroPlaceholdersPresent) {
    addIssue(issues, 'error', 'settings.trading.enabled', 'Trading cannot be enabled while TP/SL/BE placeholder zero values exist');
  }

  return finalize(settings, issues);
}

function finalize(settings, issues) {
  const errors = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');
  const safeMode = errors.length > 0 || (settings && settings.trading && settings.trading.enabled === false);
  return {
    ok: errors.length === 0,
    safeMode,
    errors,
    warnings,
    issues,
  };
}

function loadAndValidateSettings(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const settings = JSON.parse(raw);
  return {
    settings,
    validation: validateSettingsObject(settings),
  };
}

module.exports = {
  validateSettingsObject,
  loadAndValidateSettings,
};
