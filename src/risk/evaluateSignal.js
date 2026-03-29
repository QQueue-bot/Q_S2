const path = require('path');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { resolveBotContext } = require('../config/resolveBotContext');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');

function isEntrySignal(signal) {
  return signal === 'ENTER_LONG' || signal === 'ENTER_SHORT';
}

function isExitSignal(signal) {
  return signal === 'EXIT_LONG' || signal === 'EXIT_SHORT';
}

function hasActivePlaceholderValues(settings) {
  const tpLevels = settings.takeProfit?.levels || [];
  const activeTpHasZero = tpLevels.some(level => level.enabled && (level.triggerPercent === 0 || level.closePercent === 0));
  const slPlaceholder = settings.stopLoss?.enabled && settings.stopLoss?.triggerPercent === 0;
  const bePlaceholder = settings.breakEven?.enabled && settings.breakEven?.triggerPercent === 0;
  return activeTpHasZero || slPlaceholder || bePlaceholder;
}

function createRiskEngine(options = {}) {
  const botContext = options.botContext || resolveBotContext('Bot1');
  const settingsPath = options.settingsPath || botContext.settingsPath || path.join(__dirname, '..', '..', 'config', 'settings.json');
  const { settings, validation } = loadAndValidateSettings(settingsPath);
  const dbPath = path.resolve(path.dirname(settingsPath), '..', settings.storage.databasePath.replace(/^\.\//, ''));
  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  function evaluate(parsedSignal) {
    const reasons = [];
    const warnings = [];

    if (!settings.trading.allowedSymbols.includes(settings.trading.defaultSymbol)) {
      reasons.push('Configured symbol is not in allowedSymbols');
    }

    if (!botContext.allowedBots.includes(parsedSignal.botId)) {
      reasons.push(`Bot is not allowed: ${parsedSignal.botId}`);
    }

    if (parsedSignal.botId !== botContext.botId) {
      reasons.push(`Resolved bot context mismatch: expected ${botContext.botId}, got ${parsedSignal.botId}`);
    }

    if (settings.positionSizing.accountPercent > settings.riskControls.maxAccountPercent) {
      reasons.push('Configured accountPercent exceeds maxAccountPercent');
    }

    if (settings.positionSizing.leverage > settings.riskControls.maxLeverage) {
      reasons.push('Configured leverage exceeds maxLeverage');
    }

    if (settings.riskControls.killSwitch && isEntrySignal(parsedSignal.signal)) {
      reasons.push('Kill switch is enabled for entry signals');
    }

    if (settings.riskControls.killSwitch && isExitSignal(parsedSignal.signal) && !settings.riskControls.allowExitSignalsAsSafety) {
      reasons.push('Kill switch blocks exit signals because allowExitSignalsAsSafety is false');
    }

    if (!settings.trading.enabled && isEntrySignal(parsedSignal.signal)) {
      reasons.push('Trading is disabled');
    }

    if (hasActivePlaceholderValues(settings) && isEntrySignal(parsedSignal.signal)) {
      reasons.push('Active TP/SL/BE placeholders still exist');
    }

    const duplicateWindow = settings.riskControls.duplicateSignalWindowSeconds;
    if (duplicateWindow > 0) {
      const duplicate = persistence.findRecentNormalizedSignal?.({
        signal: parsedSignal.signal,
        bot_id: parsedSignal.botId,
        window_seconds: duplicateWindow,
      });
      if (duplicate) {
        reasons.push('Duplicate signal inside duplicateSignalWindowSeconds');
      }
    } else {
      warnings.push('Duplicate signal enforcement is configured but inactive until duplicateSignalWindowSeconds > 0');
    }

    if (settings.riskControls.staleSignalThresholdSeconds > 0) {
      warnings.push('Stale signal enforcement not active yet because alerts currently use server receive time');
    }

    return {
      allowed: reasons.length === 0,
      actionable: reasons.length === 0 && isEntrySignal(parsedSignal.signal),
      signal: parsedSignal.signal,
      botId: parsedSignal.botId,
      reasons,
      warnings,
      configValidation: validation,
    };
  }

  return {
    evaluate,
    settings,
  };
}

module.exports = {
  createRiskEngine,
};
