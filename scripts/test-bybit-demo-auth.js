#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const dotenv = require('dotenv');

const envPath = '/home/ubuntu/.openclaw/workspace/.env';
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const apiKey = process.env.BYBIT_TESTNET_API_KEY;
const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error(JSON.stringify({ ok: false, error: 'Missing BYBIT_TESTNET_API_KEY or BYBIT_TESTNET_API_SECRET' }, null, 2));
  process.exit(1);
}

function sign(query = '', body = '') {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const payload = timestamp + apiKey + recvWindow + (query || body);
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return { timestamp, recvWindow, signature };
}

async function probe(name, method, path, query='', body='') {
  const { timestamp, recvWindow, signature } = sign(query, body);
  const url = `https://api-demo.bybit.com${path}${query ? '?' + query : ''}`;
  const response = await axios({
    method,
    url,
    data: body || undefined,
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    validateStatus: () => true,
  });
  return { name, status: response.status, data: response.data };
}

(async () => {
  const probes = [];
  probes.push(await probe('wallet-balance-unified', 'GET', '/v5/account/wallet-balance', 'accountType=UNIFIED'));
  probes.push(await probe('wallet-balance-contract', 'GET', '/v5/account/wallet-balance', 'accountType=CONTRACT'));
  probes.push(await probe('positions-linear-btcusdt', 'GET', '/v5/position/list', 'category=linear&symbol=BTCUSDT'));
  probes.push(await probe('order-realtime-linear', 'GET', '/v5/order/realtime', 'category=linear&symbol=BTCUSDT'));
  console.log(JSON.stringify(probes, null, 2));
})();
