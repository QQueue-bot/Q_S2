'use strict';

// HMAC auth + REST helpers for the S2.1 engine.
//
// The auth pattern (signRequest, bybitPrivateGet, bybitPrivatePost) is mirrored
// verbatim from src/execution/bybitExecution.js — including the quirk that GET
// uses axios while POST uses native fetch and returns { ok, json }. Do not
// "improve" silently; any change to the auth contract must be a separate PR
// touching both modules together.

const crypto = require('crypto');
const axios = require('axios');

const DEFAULT_BYBIT_BASE_URL = 'https://api-demo.bybit.com';

function getBybitBaseUrl(options = {}) {
  if (options.bybitBaseUrl) return options.bybitBaseUrl;
  if (process.env.BYBIT_BASE_URL) return process.env.BYBIT_BASE_URL;
  return DEFAULT_BYBIT_BASE_URL;
}

function signRequest({ apiKey, apiSecret, timestamp, recvWindow, query = '', body = '' }) {
  const payloadToSign = timestamp + apiKey + recvWindow + (query || body);
  return crypto.createHmac('sha256', apiSecret).update(payloadToSign).digest('hex');
}

async function bybitPrivateGet(pathname, query, credentials, options = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const signature = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow,
    query,
  });
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}${pathname}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    validateStatus: () => true,
  });
  return response.data;
}

async function bybitPrivatePost(pathname, bodyObject, credentials, options = {}) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const body = JSON.stringify(bodyObject);
  const signature = signRequest({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    timestamp,
    recvWindow,
    body,
  });
  const baseUrl = getBybitBaseUrl(options);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': credentials.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    },
    body,
  });
  return {
    ok: response.ok,
    json: await response.json(),
  };
}

// ── Public endpoints (no auth) ──────────────────────────────────────────────

async function getInstrumentInfo(symbol, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}/v5/market/instruments-info?category=linear&symbol=${symbol}`);
  const instrument = response.data?.result?.list?.[0];
  if (!instrument) {
    throw new Error(`Instrument info not found for ${symbol}`);
  }
  return instrument;
}

async function getLivePrice(symbol, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const response = await axios.get(`${baseUrl}/v5/market/tickers?category=linear&symbol=${symbol}`);
  const ticker = response.data?.result?.list?.[0];
  const price = Number(ticker?.lastPrice || 0);
  if (!price) {
    throw new Error(`Live reference price not found for ${symbol}`);
  }
  return { last_price: price, source: 'bybit_ticker' };
}

async function fetchKlineCandles({ symbol, intervalMin, limit = 50 }, options = {}) {
  const baseUrl = getBybitBaseUrl(options);
  const url = `${baseUrl}/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalMin}&limit=${limit}`;
  const response = await axios.get(url);
  const list = response.data?.result?.list || [];
  // Bybit returns newest-first; reverse so candles[i+1] is later than candles[i].
  return list.slice().reverse().map(row => ({
    t: Number(row[0]),       // open time (ms)
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  }));
}

// ── Private endpoints ────────────────────────────────────────────────────────

async function getLivePosition(symbol, credentials, options = {}) {
  const response = await bybitPrivateGet(
    '/v5/position/list',
    `category=linear&symbol=${symbol}`,
    credentials,
    options
  );
  const positions = response?.result?.list || [];
  return positions.find(p => Number(p.size || 0) > 0) || null;
}

async function getPositions(symbol, credentials, options = {}) {
  const response = await bybitPrivateGet(
    '/v5/position/list',
    `category=linear&symbol=${symbol}`,
    credentials,
    options
  );
  return response?.result?.list || [];
}

async function placeOrder(orderPayload, credentials, options = {}) {
  return bybitPrivatePost('/v5/order/create', orderPayload, credentials, options);
}

async function cancelOrder({ symbol, orderId, orderLinkId }, credentials, options = {}) {
  const payload = { category: 'linear', symbol };
  if (orderId) payload.orderId = orderId;
  if (orderLinkId) payload.orderLinkId = orderLinkId;
  return bybitPrivatePost('/v5/order/cancel', payload, credentials, options);
}

async function cancelAllOrders({ symbol }, credentials, options = {}) {
  return bybitPrivatePost('/v5/order/cancel-all', { category: 'linear', symbol }, credentials, options);
}

async function getOpenOrders({ symbol }, credentials, options = {}) {
  const response = await bybitPrivateGet(
    '/v5/order/realtime',
    `category=linear&symbol=${symbol}`,
    credentials,
    options
  );
  return response?.result?.list || [];
}

module.exports = {
  // auth primitives (exported for testing; prefer the named helpers below)
  getBybitBaseUrl,
  signRequest,
  bybitPrivateGet,
  bybitPrivatePost,
  // public market data
  getInstrumentInfo,
  getLivePrice,
  fetchKlineCandles,
  // private account / orders
  getLivePosition,
  getPositions,
  placeOrder,
  cancelOrder,
  cancelAllOrders,
  getOpenOrders,
};
