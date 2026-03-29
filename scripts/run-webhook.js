#!/usr/bin/env node
const path = require('path');
const { createWebhookServer } = require('../src/webhook/createServer');
const { startTradeManagementLoop } = require('../src/runtime/startTradeManagementLoop');

const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');

const server = createWebhookServer({
  host: process.env.WEBHOOK_HOST || '127.0.0.1',
  port: Number(process.env.WEBHOOK_PORT || 3001),
  path: process.env.WEBHOOK_PATH || '/webhook/tradingview',
  secret: process.env.WEBHOOK_SECRET || 'dev-secret',
  settingsPath,
  logger: console,
});

const managementLoop = startTradeManagementLoop({
  settingsPath,
  envPath: '/home/ubuntu/.openclaw/workspace/.env',
  dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
  logger: console,
});

server.start();

process.on('SIGINT', () => {
  managementLoop.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  managementLoop.stop();
  process.exit(0);
});
