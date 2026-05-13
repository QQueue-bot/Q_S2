const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://api.bybit.com';
const DEFAULT_RECV_WINDOW = '5000';
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGES = 20;

function signRequest({ apiKey, apiSecret, timestamp, recvWindow, query }) {
  const payload = timestamp + apiKey + recvWindow + query;
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}

function buildQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

async function defaultHttpGet({ url, headers, timeoutMs }) {
  const axios = require('axios');
  const response = await axios.get(url, {
    headers,
    timeout: timeoutMs,
    validateStatus: () => true,
  });
  return response.data;
}

function normalizeClosedPnlRecord(raw, { symbol } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  return {
    symbol: symbol || raw.symbol || null,
    createdTimeMs: raw.createdTime ? Number(raw.createdTime) : null,
    updatedTimeMs: raw.updatedTime ? Number(raw.updatedTime) : null,
    closingSide: raw.side || null,
    qty: num(raw.qty),
    avgEntryPrice: num(raw.avgEntryPrice),
    avgExitPrice: num(raw.avgExitPrice),
    closedPnlUsd: num(raw.closedPnl),
    execType: raw.execType || null,
    orderType: raw.orderType || null,
    leverage: num(raw.leverage),
    openFeeUsd: num(raw.openFee),
    closeFeeUsd: num(raw.closeFee),
    fillCount: num(raw.fillCount),
    raw,
  };
}

async function fetchClosedPnl({
  symbol,
  startTimeMs,
  endTimeMs,
  limit = DEFAULT_PAGE_LIMIT,
  credentials,
  baseUrl = DEFAULT_BASE_URL,
  recvWindow = DEFAULT_RECV_WINDOW,
  timeoutMs = 10000,
  httpGet = defaultHttpGet,
} = {}) {
  if (!symbol) throw new Error('fetchClosedPnl: symbol is required');
  if (!credentials || !credentials.apiKey || !credentials.apiSecret) {
    throw new Error('fetchClosedPnl: credentials.apiKey and apiSecret are required');
  }

  const collected = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = buildQuery({
      category: 'linear',
      symbol,
      startTime: startTimeMs,
      endTime: endTimeMs,
      limit,
      cursor: cursor || undefined,
    });
    const timestamp = Date.now().toString();
    const signature = signRequest({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      timestamp,
      recvWindow,
      query,
    });
    const body = await httpGet({
      url: `${baseUrl}/v5/position/closed-pnl?${query}`,
      headers: {
        'X-BAPI-API-KEY': credentials.apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      },
      timeoutMs,
    });
    if (!body || body.retCode !== 0) {
      const code = body && body.retCode;
      const msg = body && body.retMsg;
      throw new Error(`bybit closed-pnl error retCode=${code} retMsg=${msg}`);
    }
    const list = (body.result && body.result.list) || [];
    for (const raw of list) {
      const norm = normalizeClosedPnlRecord(raw, { symbol });
      if (norm) collected.push(norm);
    }
    cursor = (body.result && body.result.nextPageCursor) || '';
    if (!cursor || list.length < limit) break;
  }
  return collected;
}

module.exports = {
  fetchClosedPnl,
  normalizeClosedPnlRecord,
  __test__: { signRequest, buildQuery },
};
