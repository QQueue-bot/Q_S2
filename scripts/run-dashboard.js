#!/usr/bin/env node
const { createDashboardServer } = require('../src/dashboard/createDashboardServer');

const server = createDashboardServer({
  host: process.env.DASHBOARD_HOST || '127.0.0.1',
  port: Number(process.env.DASHBOARD_PORT || 3010),
  title: 'S2 Dashboard',
  runtime: {
    path: process.env.S2_RUNTIME_PATH || '/tmp/qs2_review',
    environment: 'Bybit demo / internal-only',
  },
  logger: console,
});

server.start();
