#!/usr/bin/env node
const assert = require('assert');
const { fetchClosedPnl, normalizeClosedPnlRecord, __test__ } = require('../src/reconciliation/closedPnlClient');

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.log(`  FAIL ${name}: ${e.message}`);
  }
}

(async () => {
  console.log('-- signRequest --');
  check('produces a hex sha256 of expected length', () => {
    const sig = __test__.signRequest({
      apiKey: 'key',
      apiSecret: 'secret',
      timestamp: '1000',
      recvWindow: '5000',
      query: 'category=linear&symbol=XLMUSDT',
    });
    assert.strictEqual(typeof sig, 'string');
    assert.strictEqual(sig.length, 64);
    assert.match(sig, /^[0-9a-f]+$/);
  });

  check('signRequest is deterministic for same inputs', () => {
    const a = __test__.signRequest({ apiKey: 'k', apiSecret: 's', timestamp: '1', recvWindow: '5000', query: 'q=1' });
    const b = __test__.signRequest({ apiKey: 'k', apiSecret: 's', timestamp: '1', recvWindow: '5000', query: 'q=1' });
    assert.strictEqual(a, b);
  });

  console.log('-- buildQuery --');
  check('skips undefined/null/empty values', () => {
    const q = __test__.buildQuery({ a: 1, b: undefined, c: null, d: '', e: 'x' });
    assert.strictEqual(q, 'a=1&e=x');
  });

  check('encodes special characters', () => {
    const q = __test__.buildQuery({ k: 'a b' });
    assert.strictEqual(q, 'k=a%20b');
  });

  console.log('-- normalizeClosedPnlRecord --');
  check('coerces string numerics to numbers', () => {
    const r = normalizeClosedPnlRecord({
      createdTime: '1778583903568',
      updatedTime: '1778606248713',
      side: 'Buy',
      qty: '25720',
      avgEntryPrice: '0.03782187',
      avgExitPrice: '0.03783471',
      closedPnl: '-1.30620942',
      execType: 'Trade',
      orderType: 'Market',
      leverage: '3',
      openFee: '0.53502822',
      closeFee: '0.5352098',
      fillCount: '6',
    }, { symbol: 'DEEPUSDT' });
    assert.strictEqual(r.symbol, 'DEEPUSDT');
    assert.strictEqual(r.createdTimeMs, 1778583903568);
    assert.strictEqual(r.updatedTimeMs, 1778606248713);
    assert.strictEqual(r.closingSide, 'Buy');
    assert.strictEqual(r.qty, 25720);
    assert.strictEqual(r.avgEntryPrice, 0.03782187);
    assert.strictEqual(r.avgExitPrice, 0.03783471);
    assert.strictEqual(r.closedPnlUsd, -1.30620942);
    assert.strictEqual(r.execType, 'Trade');
    assert.strictEqual(r.fillCount, 6);
    assert.ok(r.raw);
  });

  check('handles missing/empty fields as null', () => {
    const r = normalizeClosedPnlRecord({ side: 'Sell' });
    assert.strictEqual(r.qty, null);
    assert.strictEqual(r.avgExitPrice, null);
    assert.strictEqual(r.closingSide, 'Sell');
  });

  check('returns null for non-object input', () => {
    assert.strictEqual(normalizeClosedPnlRecord(null), null);
    assert.strictEqual(normalizeClosedPnlRecord(undefined), null);
    assert.strictEqual(normalizeClosedPnlRecord('x'), null);
  });

  console.log('-- fetchClosedPnl (injected http) --');
  await checkAsync('rejects missing symbol', async () => {
    await assert.rejects(
      () => fetchClosedPnl({ credentials: { apiKey: 'k', apiSecret: 's' } }),
      /symbol is required/,
    );
  });

  await checkAsync('rejects missing credentials', async () => {
    await assert.rejects(
      () => fetchClosedPnl({ symbol: 'XLMUSDT' }),
      /credentials/,
    );
  });

  await checkAsync('returns normalized list on single-page response', async () => {
    const httpGet = async () => ({
      retCode: 0,
      retMsg: 'OK',
      result: {
        list: [
          { createdTime: '1', updatedTime: '2', side: 'Buy', qty: '10', avgEntryPrice: '1.0', avgExitPrice: '1.1', closedPnl: '0.5' },
          { createdTime: '3', updatedTime: '4', side: 'Sell', qty: '20', avgEntryPrice: '2.0', avgExitPrice: '1.9', closedPnl: '-0.5' },
        ],
        nextPageCursor: '',
      },
    });
    const out = await fetchClosedPnl({
      symbol: 'XLMUSDT',
      credentials: { apiKey: 'k', apiSecret: 's' },
      httpGet,
    });
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].qty, 10);
    assert.strictEqual(out[1].qty, 20);
    assert.strictEqual(out[0].symbol, 'XLMUSDT');
  });

  await checkAsync('throws on non-zero retCode', async () => {
    const httpGet = async () => ({ retCode: 10001, retMsg: 'invalid sig' });
    await assert.rejects(
      () => fetchClosedPnl({
        symbol: 'XLMUSDT',
        credentials: { apiKey: 'k', apiSecret: 's' },
        httpGet,
      }),
      /retCode=10001/,
    );
  });

  await checkAsync('paginates when nextPageCursor present and list at limit', async () => {
    let calls = 0;
    const httpGet = async ({ url }) => {
      calls += 1;
      if (calls === 1) {
        return {
          retCode: 0,
          result: {
            list: Array.from({ length: 2 }, (_, i) => ({
              createdTime: `${i}`, updatedTime: `${i}`, side: 'Buy', qty: '1', avgEntryPrice: '1', avgExitPrice: '1', closedPnl: '0',
            })),
            nextPageCursor: 'CURSOR_PAGE_2',
          },
        };
      }
      assert.match(url, /cursor=CURSOR_PAGE_2/);
      return {
        retCode: 0,
        result: {
          list: [{ createdTime: '99', updatedTime: '99', side: 'Buy', qty: '5', avgEntryPrice: '1', avgExitPrice: '1', closedPnl: '0' }],
          nextPageCursor: '',
        },
      };
    };
    const out = await fetchClosedPnl({
      symbol: 'XLMUSDT',
      limit: 2,
      credentials: { apiKey: 'k', apiSecret: 's' },
      httpGet,
    });
    assert.strictEqual(calls, 2);
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[2].qty, 5);
  });

  await checkAsync('stops paginating when list shorter than limit', async () => {
    let calls = 0;
    const httpGet = async () => {
      calls += 1;
      return {
        retCode: 0,
        result: {
          list: [{ createdTime: '1', updatedTime: '1', side: 'Buy', qty: '1', avgEntryPrice: '1', avgExitPrice: '1', closedPnl: '0' }],
          nextPageCursor: 'STILL_HAS_CURSOR',
        },
      };
    };
    await fetchClosedPnl({
      symbol: 'XLMUSDT',
      limit: 50,
      credentials: { apiKey: 'k', apiSecret: 's' },
      httpGet,
    });
    assert.strictEqual(calls, 1);
  });

  await checkAsync('forwards startTime and endTime in query', async () => {
    const captured = {};
    const httpGet = async ({ url }) => {
      captured.url = url;
      return { retCode: 0, result: { list: [], nextPageCursor: '' } };
    };
    await fetchClosedPnl({
      symbol: 'XLMUSDT',
      startTimeMs: 1000,
      endTimeMs: 2000,
      credentials: { apiKey: 'k', apiSecret: 's' },
      httpGet,
    });
    assert.match(captured.url, /startTime=1000/);
    assert.match(captured.url, /endTime=2000/);
  });

  console.log('');
  if (failures.length > 0) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(1);
  }
  console.log('all closed-pnl client tests passed');
})();
