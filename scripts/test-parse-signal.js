#!/usr/bin/env node
const { parseSignalString } = require('../src/signals/parseSignal');

const input = process.argv[2] || 'ENTER_LONG_Bot1';
const allowedBots = ['Bot1'];

try {
  const parsed = parseSignalString(input, { allowedBots });
  console.log(JSON.stringify({ ok: true, parsed }, null, 2));
  process.exit(0);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
