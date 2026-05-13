const path = require('path');
const { loadBotRegistry } = require('../config/botRegistry');
const { resolveBotCredentials } = require('../config/resolveBotCredentials');
const { loadAndValidateSettings } = require('../config/validateSettings');
const { createDatabase, initSchema } = require('../db/sqlite');
const { reconcileAll } = require('../reconciliation/positionReconciler');

function readReconcilerConfig(settingsPath) {
  try {
    const { settings } = loadAndValidateSettings(settingsPath);
    const cfg = settings && settings.reconciliation;
    if (!cfg || typeof cfg !== 'object') return { enabled: false };
    return {
      enabled: cfg.enabled !== false,
      intervalSeconds: Number(cfg.intervalSeconds) > 0 ? Number(cfg.intervalSeconds) : 45,
      perBotStaggerMs: Number(cfg.perBotStaggerMs) >= 0 ? Number(cfg.perBotStaggerMs) : 250,
      minQuietSecondsAfterEnter: Number(cfg.minQuietSecondsAfterEnter) >= 0 ? Number(cfg.minQuietSecondsAfterEnter) : 60,
      dryRun: cfg.dryRun === true,
    };
  } catch (e) {
    return { enabled: false, _configError: e.message };
  }
}

function startReconciliationLoop(options = {}) {
  const {
    settingsPath = path.join(__dirname, '..', '..', 'config', 'settings.json'),
    envPath = '/home/ubuntu/.openclaw/.env',
    dbPath = process.env.S2_DB_PATH || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite',
    registryPath = path.join(__dirname, '..', '..', 'config', 'bots.json'),
    logger = console,
  } = options;

  const cfg = readReconcilerConfig(settingsPath);
  if (!cfg.enabled) {
    logger.info('[reconciler] disabled (no reconciliation block in settings or enabled=false)', { configError: cfg._configError });
    return { stop() {}, enabled: false };
  }
  logger.info('[reconciler] starting', cfg);

  const db = createDatabase(dbPath);
  initSchema(db);

  const credentialsResolver = (botId) => {
    const r = resolveBotCredentials(botId, { registryPath, envPath });
    return { apiKey: r.apiKey, apiSecret: r.apiSecret };
  };

  let running = false;
  const tick = async () => {
    if (running) {
      logger.warn('[reconciler] previous cycle still running, skipping');
      return;
    }
    running = true;
    try {
      const registry = loadBotRegistry(registryPath);
      const bots = registry.bots.filter((b) => b.enabled);
      const reports = await reconcileAll({
        db,
        bots,
        credentialsResolver,
        options: {
          dryRun: cfg.dryRun,
          perBotStaggerMs: cfg.perBotStaggerMs,
          minQuietSecondsAfterEnter: cfg.minQuietSecondsAfterEnter,
        },
        logger,
      });
      const inserted = reports.reduce((acc, r) => acc + (r.inserted ? r.inserted.length : 0), 0);
      if (inserted > 0) {
        logger.info('[reconciler] cycle complete', {
          inserted,
          bots: reports.filter((r) => r.inserted && r.inserted.length > 0).map((r) => ({ bot_id: r.bot_id, n: r.inserted.length })),
        });
      }
    } catch (e) {
      logger.warn('[reconciler] cycle error', { error: e.message });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, cfg.intervalSeconds * 1000);
  tick();

  return {
    stop() { clearInterval(timer); },
    enabled: true,
    config: cfg,
  };
}

module.exports = {
  startReconciliationLoop,
};
