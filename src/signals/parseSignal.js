const crypto = require('crypto');

const ALLOWED_SIGNALS = ['ENTER_LONG', 'EXIT_LONG', 'ENTER_SHORT', 'EXIT_SHORT'];
const REQUIRED_FIELDS = ['signal', 'symbol', 'timestamp', 'source', 'strategy', 'timeframe'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSignalValue(signal) {
  if (typeof signal !== 'string') return signal;
  return signal.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function deriveIdempotencyKey(payload) {
  const basis = [
    payload.signal,
    payload.symbol,
    payload.timestamp,
    payload.source,
    payload.strategy,
    payload.timeframe,
  ].join('|');
  return crypto.createHash('sha256').update(basis).digest('hex');
}

function parseIsoTimestamp(value) {
  if (typeof value !== 'string') {
    throw new Error('timestamp must be an ISO8601 UTC string');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('timestamp must be a valid ISO8601 UTC string');
  }
  return parsed.toISOString();
}

function parseSignalPayload(payload, options = {}) {
  if (!isPlainObject(payload)) {
    throw new Error('Signal payload must be a JSON object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in payload)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const normalizedSignal = normalizeSignalValue(payload.signal);
  if (!ALLOWED_SIGNALS.includes(normalizedSignal)) {
    throw new Error(`Unsupported signal: ${payload.signal}`);
  }

  if (typeof payload.symbol !== 'string' || !payload.symbol.trim()) {
    throw new Error('symbol must be a non-empty string');
  }
  const symbol = payload.symbol.trim().toUpperCase();

  const allowedSymbols = options.allowedSymbols || [];
  if (Array.isArray(allowedSymbols) && allowedSymbols.length > 0 && !allowedSymbols.includes(symbol)) {
    throw new Error(`symbol is not allowed: ${symbol}`);
  }

  const timestamp = parseIsoTimestamp(payload.timestamp);

  for (const field of ['source', 'strategy', 'timeframe']) {
    if (typeof payload[field] !== 'string' || !payload[field].trim()) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }

  if ('meta' in payload && !isPlainObject(payload.meta)) {
    throw new Error('meta must be an object when provided');
  }

  let idempotencyKey = payload.idempotencyKey;
  if (typeof idempotencyKey === 'string') {
    idempotencyKey = idempotencyKey.trim();
  }
  if (!idempotencyKey) {
    idempotencyKey = deriveIdempotencyKey({
      signal: normalizedSignal,
      symbol,
      timestamp,
      source: payload.source.trim(),
      strategy: payload.strategy.trim(),
      timeframe: payload.timeframe.trim(),
    });
  }

  return {
    signal: normalizedSignal,
    symbol,
    timestamp,
    source: payload.source.trim(),
    strategy: payload.strategy.trim(),
    timeframe: payload.timeframe.trim(),
    idempotencyKey,
    price: typeof payload.price === 'number' ? payload.price : null,
    meta: payload.meta || {},
    receivedAt: new Date().toISOString(),
  };
}

module.exports = {
  ALLOWED_SIGNALS,
  REQUIRED_FIELDS,
  parseSignalPayload,
  deriveIdempotencyKey,
};
