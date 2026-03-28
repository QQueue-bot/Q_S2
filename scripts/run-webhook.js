#!/usr/bin/env node
const path = require('path');
const { createWebhookServer } = require('../src/webhook/createServer');

const server = createWebhookServer({
  host: process.env.WEBHOOK_HOST || '127.0.0.1',
  port: Number(process.env.WEBHOOK_PORT || 3001),
  path: process.env.WEBHOOK_PATH || '/webhook/tradingview',
  secret: process.env.WEBHOOK_SECRET || 'dev-secret',
  settingsPath: path.join(__dirname, '..', 'config', 'settings.json'),
  logger: console,
});

server.start();
