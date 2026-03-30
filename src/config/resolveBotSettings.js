const fs = require('fs');
const path = require('path');
const { getBotById } = require('./botRegistry');
const { loadAndValidateSettings } = require('./validateSettings');
const { resolveMdxSettings } = require('./resolveMdxSettings');
const { validateMdxRuntimeSettings } = require('./validateMdxRuntimeSettings');

function resolveBotSettings(botId, options = {}) {
  const registryPath = options.registryPath || path.join(__dirname, '..', '..', 'config', 'bots.json');
  const registryDir = path.dirname(registryPath);
  const bot = getBotById(botId, registryPath);

  if (!bot) {
    throw new Error(`Unknown botId: ${botId}`);
  }

  const settingsRef = bot.settingsRef;
  if (!settingsRef || typeof settingsRef !== 'string') {
    throw new Error(`Bot ${botId} is missing settingsRef`);
  }

  const settingsPath = path.resolve(registryDir, settingsRef);
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Settings file not found for ${botId}: ${settingsPath}`);
  }

  const validated = loadAndValidateSettings(settingsPath);

  if (bot.mdxSourceRef) {
    const sourcePath = path.resolve(registryDir, bot.mdxSourceRef);
    const mdxResolved = resolveMdxSettings({
      sourcePath,
      profile: bot.mdxProfile || 'balanced',
    });
    const mdxValidation = validateMdxRuntimeSettings(mdxResolved);
    if (!mdxValidation.ok) {
      throw new Error(`MDX-derived runtime settings invalid for ${botId}: ${mdxValidation.errors.join('; ')}`);
    }

    const mergedSettings = JSON.parse(JSON.stringify(validated.settings));
    mergedSettings.positionSizing = {
      ...mergedSettings.positionSizing,
      accountPercent: 10,
      notes: 'Cautious live validation baseline: use 10% of account until all bots are proven operationally.',
      ...mdxResolved.runtimeSettings.positionSizing,
    };
    mergedSettings.takeProfit = {
      ...mergedSettings.takeProfit,
      notes: `MDX-derived ${mdxResolved.selectedProfile} profile take-profit ladder is the runtime source of truth for ${botId}.`,
      ...mdxResolved.runtimeSettings.takeProfit,
    };
    mergedSettings.stopLoss = {
      ...mergedSettings.stopLoss,
      notes: `MDX-derived ${mdxResolved.selectedProfile} profile stop-loss is the runtime source of truth for ${botId}.`,
      ...mdxResolved.runtimeSettings.stopLoss,
    };
    mergedSettings.breakEven = {
      ...mergedSettings.breakEven,
      notes: `MDX-derived ${mdxResolved.selectedProfile} profile break-even trigger is the runtime source of truth for ${botId}.`,
      ...mdxResolved.runtimeSettings.breakEven,
    };

    return {
      bot,
      symbol: bot.symbol,
      settingsPath,
      settings: mergedSettings,
      validation: validated.validation,
      mdx: {
        enabled: true,
        profile: mdxResolved.selectedProfile,
        sourcePath,
        warnings: mdxValidation.warnings,
        metadata: mdxResolved.metadata,
      },
    };
  }

  return {
    bot,
    symbol: bot.symbol,
    settingsPath,
    settings: validated.settings,
    validation: validated.validation,
    mdx: {
      enabled: false,
    },
  };
}

module.exports = {
  resolveBotSettings,
};
