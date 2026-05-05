const path = require('path');
const { manageTpSl, manageBreakEven } = require('../execution/bybitExecution');
const { managePaperPositions } = require('../execution/paperExecution');
const { loadBotRegistry } = require('../config/botRegistry');

function startTradeManagementLoop(options = {}) {
  const {
    intervalMs = Number(process.env.S2_MANAGEMENT_INTERVAL_MS || 15000),
    settingsPath = path.join(__dirname, '..', '..', 'config', 'settings.json'),
    envPath = '/home/ubuntu/.openclaw/.env',
    dbPath = process.env.S2_DB_PATH || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite',
    registryPath = path.join(__dirname, '..', '..', 'config', 'bots.json'),
    logger = console,
  } = options;

  const tick = async () => {
    try {
      const registry = loadBotRegistry(registryPath);
      const enabledBots = registry.bots.filter(bot => bot.enabled).map(bot => bot.botId);

      for (const botId of enabledBots) {
        try {
          const tpSl = await manageTpSl({ settingsPath, envPath, dbPath, botId });
          if (tpSl && tpSl.action && tpSl.action !== 'hold' && tpSl.action !== 'no_position') {
            logger.info('TP/SL management result', { botId, tpSl });
          }

          const breakEven = await manageBreakEven({ settingsPath, envPath, dbPath, botId });
          if (breakEven && breakEven.action && breakEven.action !== 'hold' && breakEven.action !== 'no_position') {
            logger.info('Break-even management result', { botId, breakEven });
          }
        } catch (botError) {
          logger.warn('Trade management bot error', { botId, error: botError.message });
        }
      }
      // Paper position management (TP/SL/BE monitoring)
      try {
        await managePaperPositions({ dbPath, logger });
      } catch (paperError) {
        logger.warn('Paper management error', { error: paperError.message });
      }
    } catch (error) {
      logger.warn('Trade management loop error', { error: error.message });
    }
  };

  const timer = setInterval(() => {
    tick();
  }, intervalMs);

  tick();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  startTradeManagementLoop,
};
