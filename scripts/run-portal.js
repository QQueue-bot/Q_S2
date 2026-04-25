#!/usr/bin/env node
'use strict';

const { createPortalServer } = require('../src/portal/server');

const server = createPortalServer({
  host: process.env.PORTAL_HOST || '0.0.0.0',
  port: Number(process.env.PORTAL_PORT || process.env.DASHBOARD_PORT || 3010),
  logger: console,
  mobileBotStatusOptions: {
    registryPath: process.env.S2_REGISTRY_PATH || undefined,
    envPath: process.env.S2_ENV_PATH || '/home/ubuntu/.openclaw/.env',
    dbPath: process.env.S2_DB_PATH || '/tmp/qs2_review/data/s2.sqlite',
  },
});

server.start();
