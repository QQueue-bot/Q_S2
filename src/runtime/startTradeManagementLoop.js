const path = require('path');
const { manageTpSl, manageBreakEven } = require('../execution/bybitExecution');

function startTradeManagementLoop(options = {}) {
  const {
    intervalMs = Number(process.env.S2_MANAGEMENT_INTERVAL_MS || 15000),
    settingsPath = path.join(__dirname, '..', '..', 'config', 'settings.json'),
    envPath = '/home/ubuntu/.openclaw/workspace/.env',
    dbPath = process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
    logger = console,
  } = options;

  const tick = async () => {
    try {
      const tpSl = await manageTpSl({ settingsPath, envPath, dbPath });
      if (tpSl && tpSl.action && tpSl.action !== 'hold' && tpSl.action !== 'no_position') {
        logger.info('TP/SL management result', { tpSl });
      }

      const breakEven = await manageBreakEven({ settingsPath, envPath, dbPath });
      if (breakEven && breakEven.action && breakEven.action !== 'hold' && breakEven.action !== 'no_position') {
        logger.info('Break-even management result', { breakEven });
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
