#!/usr/bin/env node
const path = require('path');
const { loadAndValidateSettings } = require('../src/config/validateSettings');

const target = process.argv[2] || path.join(__dirname, '..', 'config', 'settings.json');

try {
  const { validation } = loadAndValidateSettings(target);
  console.log(JSON.stringify(validation, null, 2));
  process.exit(validation.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({ ok: false, fatal: true, message: error.message }, null, 2));
  process.exit(1);
}
