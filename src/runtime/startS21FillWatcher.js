'use strict';

// Boot-time wrapper for the S2.1 fill watcher.
//
// Mirrors src/runtime/startReconciliationLoop.js shape so the webhook
// process can wire S2.1 alongside the legacy reconciler with the same
// shutdown handler pattern.

const path = require('path');
const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
const { loadS21Config, resolveS21Credentials } = require('../s21/config');
const { startWatcher, DEFAULT_INTERVAL_MS } = require('../s21/fillWatcher');

function startS21FillWatcher(options = {}) {
  const {
    envPath = '/home/ubuntu/.openclaw/.env',
    dbPath = process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
    intervalMs = DEFAULT_INTERVAL_MS,
    logger = console,
  } = options;

  let s21Config;
  try {
    s21Config = loadS21Config();
  } catch (err) {
    logger.warn('[s21-watcher] s21-bots.json not loadable — watcher disabled', { error: err.message });
    return { enabled: false, stop() {} };
  }

  const enabledBots = s21Config.bots.filter(b => b.enabled);
  if (enabledBots.length === 0) {
    logger.info('[s21-watcher] no enabled S2.1 bots — watcher disabled');
    return { enabled: false, stop() {} };
  }

  const db = createDatabase(dbPath);
  initSchema(db);
  const persistence = buildPersistence(db);

  const credentialsResolver = (botConfig) => resolveS21Credentials(botConfig, envPath);

  logger.info('[s21-watcher] starting', {
    intervalMs,
    botsWatched: enabledBots.map(b => b.botId),
  });

  return startWatcher({
    persistence,
    botConfigs: enabledBots,
    credentialsResolver,
    intervalMs,
    logger,
  });
}

module.exports = { startS21FillWatcher };
