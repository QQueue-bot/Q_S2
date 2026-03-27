#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseSignalPayload } = require('../src/signals/parseSignal');

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf8'));
const target = process.argv[2] || path.join(__dirname, '..', 'samples', 'signals', 'enter-long.valid.json');
const payload = JSON.parse(fs.readFileSync(target, 'utf8'));

try {
  const parsed = parseSignalPayload(payload, {
    allowedSymbols: settings.trading.allowedSymbols,
  });
  console.log(JSON.stringify({ ok: true, parsed }, null, 2));
  process.exit(0);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
