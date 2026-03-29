#!/usr/bin/env node
const fs = require('fs');
const dotenv = require('dotenv');

const envPath = '/home/ubuntu/.openclaw/workspace/.env';
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

function inspect(name) {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return { present: false };
  }
  return {
    present: true,
    length: value.length,
    hasLeadingWhitespace: /^\s/.test(value),
    hasTrailingWhitespace: /\s$/.test(value),
    startsWithQuote: value.startsWith('"') || value.startsWith("'"),
    endsWithQuote: value.endsWith('"') || value.endsWith("'"),
    containsNewline: /\n|\r/.test(value),
  };
}

console.log(JSON.stringify({
  BYBIT_TESTNET_API_KEY: inspect('BYBIT_TESTNET_API_KEY'),
  BYBIT_TESTNET_API_SECRET: inspect('BYBIT_TESTNET_API_SECRET')
}, null, 2));
