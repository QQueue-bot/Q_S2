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

function sign(query='') {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const payload = timestamp + apiKey + recvWindow + query;
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return { timestamp, recvWindow, signature };
}

async function probe(baseUrl, query='coin=BTC') {
  const { timestamp, recvWindow, signature } = sign(query);
  const response = await axios.get(`${baseUrl}/v5/asset/coin/query-info?${query}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    validateStatus: () => true,
  });
  return {
    baseUrl,
    status: response.status,
    data: response.data,
  };
}

(async () => {
  const results = [];
  for (const host of [
    'https://api-testnet.bybit.com',
    'https://api-demo.bybit.com'
  ]) {
    try {
      results.push(await probe(host));
    } catch (error) {
      results.push({ baseUrl: host, error: error.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
})();
