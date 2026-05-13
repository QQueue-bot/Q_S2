#!/usr/bin/env node
const path = require('path');
const { createWebhookServer } = require('../src/webhook/createServer');
const { startTradeManagementLoop } = require('../src/runtime/startTradeManagementLoop');
const { startReconciliationLoop } = require('../src/runtime/startReconciliationLoop');
const { startS21FillWatcher } = require('../src/runtime/startS21FillWatcher');
const { loadBotRegistry } = require('../src/config/botRegistry');
const { getS21BotIds } = require('../src/s21/config');
const { createTelegramAlerts } = require('../src/s21/telegram');

const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');

// ── Registry-collision guard (refinement #1) ──────────────────────────────
// Bot IDs registered in s21-bots.json must not appear in the legacy
// bots.json registry. If they do, the reconciler will try to drive S2.1
// bots with wrong credentials, the in-position checks will fight each
// other, and the dashboard will double-render. Fail fast at boot.
{
  const registryPath = path.join(__dirname, '..', 'config', 'bots.json');
  const legacyIds = new Set(loadBotRegistry(registryPath).bots.map(b => b.botId));
  let s21Ids;
  try {
    s21Ids = new Set(getS21BotIds());
  } catch (err) {
    console.warn('[boot] s21-bots.json not loadable — skipping collision check', err.message);
    s21Ids = new Set();
  }
  const collisions = [...s21Ids].filter(id => legacyIds.has(id));
  if (collisions.length > 0) {
    throw new Error(
      `Registry collision at boot: ${collisions.join(',')} present in BOTH ` +
      `config/bots.json (legacy S2) and config/s21-bots.json (S2.1). ` +
      `S2.1 bots must live only in s21-bots.json. Move or rename.`
    );
  }
}

// S2.1 Telegram alerts. Silent no-op until TELEGRAM_BOT_TOKEN and
// TELEGRAM_S21_CHAT_ID are both set in the env.
const s21Alerts = createTelegramAlerts({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_S21_CHAT_ID,
  logger: console,
});
console.info('[s2.1-telegram] alerts ' + (s21Alerts.enabled ? 'ENABLED' : 'disabled (env vars unset)'));

const server = createWebhookServer({
  host: process.env.WEBHOOK_HOST || '127.0.0.1',
  port: Number(process.env.WEBHOOK_PORT || 3001),
  path: process.env.WEBHOOK_PATH || '/webhook/tradingview',
  secret: process.env.WEBHOOK_SECRET || 'dev-secret',
  settingsPath,
  s21Alerts,
  logger: console,
});

const managementLoop = startTradeManagementLoop({
  settingsPath,
  envPath: '/home/ubuntu/.openclaw/workspace/.env',
  dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
  logger: console,
});

const reconciliationLoop = startReconciliationLoop({
  settingsPath,
  envPath: '/home/ubuntu/.openclaw/.env',
  dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
  logger: console,
});

const s21FillWatcher = startS21FillWatcher({
  envPath: '/home/ubuntu/.openclaw/.env',
  dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
  alerts: s21Alerts,
  logger: console,
});

server.start();

function shutdown() {
  managementLoop.stop();
  reconciliationLoop.stop();
  s21FillWatcher.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
