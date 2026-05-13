'use strict';

// S2.1 trade-log page tests:
//   - marker strip ordering (SL · BE · ADD · TPs sorted by % from entry)
//   - marker lit state derived from trade row + events
//   - realised PnL computation from event timeline
//   - signal log shape (acted, pending, rejected with reason)
//   - HTML render smoke (no crash on empty + populated states)
//   - CSV export shape

const path = require('path');

// Stub bybitClient so loading tradeLogPage doesn't pull network deps.
const stubPath = path.resolve(__dirname, '../../src/s21/bybitClient.js');
require.cache[stubPath] = {
  id: stubPath, filename: stubPath, loaded: true,
  exports: {
    getLivePosition: () => { throw new Error('§4: getLivePosition'); },
    getLivePrice: () => { throw new Error('§4: getLivePrice'); },
    getInstrumentInfo: () => Promise.resolve({ lotSizeFilter: { qtyStep: '1', minOrderQty: '10', minNotionalValue: '5' } }),
    getOpenOrders: () => { throw new Error('§4: getOpenOrders'); },
    cancelOrder: () => { throw new Error('§4: cancelOrder'); },
    placeOrder: () => { throw new Error('§4: placeOrder'); },
    fetchKlineCandles: () => { throw new Error('§4: fetchKlineCandles'); },
  },
};

const page = require('../../src/s21/tradeLogPage');

function assert(cond, msg) {
  if (!cond) { console.error('   FAIL —', msg); process.exit(1); }
}

const BOT_CONFIG = {
  botId: 'Bot9', symbol: 'DEEPUSDT', displayName: 'DEEP', enabled: true,
  notionalUsd: 500,
  strategy: {
    leverage: 5,
    tpTargetsPercent: [3.37, 4.76, 12.40, 14.67, 22.40, 30.06],
    tpAllocations: [0.13, 0.18, 0.22, 0.22, 0.17, 0.08],
    slPercent: 6.0, beAfterTpIdx: 0,
  },
  scaledEntry: {
    t1Fraction: 0.5, t2Fraction: 0.5, noiseBandMult: 0.5,
    t2SlMode: 'breakeven', atrPeriod: 14, atrIntervalMin: 240,
  },
};

function makeTrade(overrides = {}) {
  return {
    trade_id: 's21_bot9_0001', trade_number: 1,
    bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', status: 'T1_T2_OPEN',
    dry_run: 1,
    entry_price_snapshot: 0.03604, atr_pct_at_open: 4.97, add_pct: 2.485,
    intended_notional_usd: 500,
    t1_intended_qty: '6936', t2_intended_qty: '6937',
    t2_trigger_price: 0.036935,
    t1_fill_price: 0.03604, t1_fill_time: '2026-05-14T10:00:00Z', t1_slippage_pct: 0,
    t1_sl_order_id: 's21_bot9_0001_t1_sl',
    t2_order_id: 's21_bot9_0001_t2_trigger',
    t2_fired: 0,
    t2_fill_price: null, t2_fill_time: null, t2_slippage_pct: 0,
    tps_hit_json: null,
    sl_hit: null, close_reason: null, close_time: null,
    created_at: '2026-05-14T10:00:00Z', updated_at: '2026-05-14T10:00:00Z',
    ...overrides,
  };
}

function test_markerOrdering_inProfitDirection() {
  console.log('\n── TEST: marker ordering — sorted by % from entry (profit direction) ──');
  const trade = makeTrade();
  const markers = page._markerForTrade(trade, BOT_CONFIG);
  const labels = markers.map(m => m.label);
  // SL(-6), BE(0), ADD(2.485), TP1(3.37), TP2(4.76), TP3(12.4), TP4(14.67), TP5(22.4), TP6(30.06)
  assert(JSON.stringify(labels) === JSON.stringify(['SL','BE','ADD','TP1','TP2','TP3','TP4','TP5','TP6']),
    `expected SL,BE,ADD,TP1..TP6 got ${labels.join(',')}`);
  // Verify the ADD slot sits between BE and TP1
  const beIdx = labels.indexOf('BE');
  const addIdx = labels.indexOf('ADD');
  const tp1Idx = labels.indexOf('TP1');
  assert(addIdx === beIdx + 1 && tp1Idx === addIdx + 1, 'ADD must sit between BE and TP1 at this ATR');
  console.log(`  PASS — 9 markers ordered: ${labels.join(' · ')}`);
}

function test_markerOrdering_highAtrPushesAddPastTp1() {
  console.log('\n── TEST: marker ordering — high ATR (15%) → ADD lands past TP2 ──');
  const trade = makeTrade({ atr_pct_at_open: 15, add_pct: 7.5 });  // 0.5 × 15
  const markers = page._markerForTrade(trade, BOT_CONFIG);
  const labels = markers.map(m => m.label);
  // ADD=7.5 sits between TP2(4.76) and TP3(12.4)
  // Order: SL(-6), BE(0), TP1(3.37), TP2(4.76), ADD(7.5), TP3(12.4), TP4..TP6
  const tp2Idx = labels.indexOf('TP2');
  const addIdx = labels.indexOf('ADD');
  const tp3Idx = labels.indexOf('TP3');
  assert(addIdx === tp2Idx + 1 && tp3Idx === addIdx + 1,
    `ADD should sit between TP2 and TP3 at high ATR, got order: ${labels.join(',')}`);
  console.log(`  PASS — high-ATR ADD repositions: ${labels.join(' · ')}`);
}

function test_markerLitStates() {
  console.log('\n── TEST: marker lit states from trade row + events ──');
  const trade = makeTrade({
    t2_fired: 1,
    tps_hit_json: JSON.stringify(['t1_tp1', 't2_tp1']),
    sl_hit: null,
  });
  trade._be_moved = true;  // simulating after enrichment
  const markers = page._markerForTrade(trade, BOT_CONFIG);
  const litLabels = markers.filter(m => m.lit).map(m => m.label).sort();
  // Expected lit: BE (T1 SL moved), ADD (T2 fired), TP1 (both tranches hit)
  assert(litLabels.includes('BE'), `BE should be lit, got ${litLabels.join(',')}`);
  assert(litLabels.includes('ADD'), 'ADD should be lit');
  assert(litLabels.includes('TP1'), 'TP1 should be lit');
  assert(!litLabels.includes('SL'), 'SL must NOT be lit');
  assert(!litLabels.includes('TP2'), 'TP2 must NOT be lit');
  console.log(`  PASS — lit set: ${litLabels.join(', ')}`);
}

function test_markerLit_slHit() {
  console.log('\n── TEST: marker lit — SL hit lights SL marker ──');
  const trade = makeTrade({ sl_hit: 'T1', status: 'CLOSED', close_reason: 'T1_SL' });
  const markers = page._markerForTrade(trade, BOT_CONFIG);
  const sl = markers.find(m => m.label === 'SL');
  assert(sl.lit === true, 'SL should be lit when sl_hit is set');
  console.log('  PASS — SL lights when sl_hit is set');
}

function test_pnlFromEventTimeline() {
  console.log('\n── TEST: realised PnL computed from TP_HIT events ──');
  const trade = makeTrade({
    t2_fired: 1, t2_fill_price: 0.036935,
    tps_hit_json: JSON.stringify(['t1_tp1', 't2_tp1']),
  });
  const events = [
    { event_type: 'TP_HIT', details_json: JSON.stringify({ tranche: 't1', tpIdx: 0, hitPrice: 0.037254 }) },
    { event_type: 'TP_HIT', details_json: JSON.stringify({ tranche: 't2', tpIdx: 0, hitPrice: 0.037254 }) },
  ];
  const pnlUsd = page._computeRealisedPnlUsd(trade, events, BOT_CONFIG);
  // T1: (tp1Price - t1_fill) * t1Qty * alloc[0] = (0.0372 - 0.03604) * 6936 * 0.13
  // T2: (tp1Price - t2_fill) * t2Qty * alloc[0] = (0.0372 - 0.036935) * 6937 * 0.13
  // Manual:
  const tp1Price = 0.03604 * 1.0337;  // ~ 0.037254548
  const expT1 = (tp1Price - 0.03604) * 6936 * 0.13;
  const expT2 = (tp1Price - 0.036935) * 6937 * 0.13;
  const expected = expT1 + expT2;
  assert(Math.abs(pnlUsd - expected) < 1e-6, `expected ${expected.toFixed(4)}, got ${pnlUsd.toFixed(4)}`);
  console.log(`  PASS — PnL: $${pnlUsd.toFixed(4)} (T1: $${expT1.toFixed(4)}, T2: $${expT2.toFixed(4)})`);
}

function test_pnlShort() {
  console.log('\n── TEST: realised PnL — SHORT direction sign is inverted ──');
  const trade = makeTrade({
    direction: 'SHORT', t1_fill_price: 0.04,
    t2_fired: 1, t2_fill_price: 0.039,
  });
  // SHORT TP1: price drops to entry * (1 - 3.37/100) = 0.04 * 0.9663
  const tp1Price = 0.04 * (1 - 3.37 / 100);
  const events = [
    { event_type: 'TP_HIT', details_json: JSON.stringify({ tranche: 't1', tpIdx: 0 }) },
  ];
  const pnlUsd = page._computeRealisedPnlUsd(trade, events, BOT_CONFIG);
  // SHORT: pnl = sign * (tpPrice - entry) * qty, sign = -1
  // (tpPrice - 0.04) * 6936 * 0.13 * (-1)
  // tpPrice < 0.04, so (tpPrice - 0.04) is negative, negated → positive PnL
  const expected = -1 * (tp1Price - 0.04) * 6936 * 0.13;
  assert(Math.abs(pnlUsd - expected) < 1e-6, `expected ${expected.toFixed(4)}, got ${pnlUsd.toFixed(4)}`);
  assert(pnlUsd > 0, 'SHORT with price dropping should produce positive PnL');
  console.log(`  PASS — SHORT TP1 hit yielded +$${pnlUsd.toFixed(4)} (sign correct)`);
}

function test_emptyRenderDoesNotCrash() {
  console.log('\n── TEST: empty data renders without crashing ──');
  const data = { generated_at: '2026-05-14T10:00:00Z', timezone: 'Europe/Zurich', trades: [], signals: [], counts: { trades_total: 0, signals_total: 0 } };
  const html = page.renderTradeLogBody(data);
  assert(html.includes('s21-wrap'), 'wrap class present');
  assert(html.includes('No trades yet'), 'empty trade state shown');
  assert(html.includes('No S2.1 signals received yet'), 'empty signal state shown');
  assert(html.includes('Export CSV'), 'CSV button present');
  console.log('  PASS — empty state rendered cleanly');
}

function test_populatedRenderHasMarkerStrip() {
  console.log('\n── TEST: populated render includes marker strip with labels and lit states ──');
  const trade = makeTrade({
    t2_fired: 1, tps_hit_json: JSON.stringify(['t1_tp1']),
    _be_moved: true, _markers: page._markerForTrade(makeTrade({ t2_fired: 1, tps_hit_json: JSON.stringify(['t1_tp1']) }), BOT_CONFIG),
    _realised_pnl_pct: 0.45, _event_count: 10,
  });
  const data = {
    generated_at: '2026-05-14T10:00:00Z', timezone: 'Europe/Zurich',
    trades: [trade],
    signals: [
      { id: 1, bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', received_at: '2026-05-14T10:00:00Z', acted: 1, reject_reason: null },
      { id: 2, bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'LONG', received_at: '2026-05-14T11:00:00Z', acted: 0, reject_reason: 'IN_POSITION' },
      { id: 3, bot_id: 'Bot9', symbol: 'DEEPUSDT', direction: 'EXIT', received_at: '2026-05-14T12:00:00Z', acted: null, reject_reason: null },
    ],
    counts: { trades_total: 1, signals_total: 3 },
  };
  const html = page.renderTradeLogBody(data);
  assert(html.includes('S2.1-#1 / Bot9'), 'trade title rendered');
  assert(html.includes('LONG'), 'direction chip rendered');
  assert(html.includes('s21-markers'), 'marker strip block present');
  assert(html.includes('SL') && html.includes('BE') && html.includes('ADD') && html.includes('TP1') && html.includes('TP6'), 'all 9 marker labels present');
  assert(html.includes('IN_POSITION'), 'reject_reason shown in signal log');
  assert(html.includes('PENDING'), 'pending signal state shown');
  assert(html.includes('YES'), 'acted=1 → YES');
  assert(html.includes('NO'), 'acted=0 → NO');
  // Marker lit class present for at least one marker
  assert(/s21-marker-lit/.test(html), 'lit class applied to at least one marker');
  console.log('  PASS — populated render contains all required structural elements');
}

function test_csvExportShape() {
  console.log('\n── TEST: CSV export shape ──');
  const fakePersistence = {
    getS21Trades: () => [
      makeTrade({ status: 'CLOSED', close_reason: 'MDX_EXIT', close_time: '2026-05-14T12:00:00Z',
        t2_fired: 1, t2_fill_price: 0.036935, tps_hit_json: JSON.stringify(['t1_tp1']) }),
    ],
    getS21EventsForTrade: () => [
      { event_type: 'TP_HIT', details_json: JSON.stringify({ tranche: 't1', tpIdx: 0 }), occurred_at: '2026-05-14T10:30:00Z' },
    ],
  };
  const csv = page.buildCsvExport(fakePersistence);
  const lines = csv.trim().split('\n');
  assert(lines.length === 2, `expected header + 1 row, got ${lines.length} lines`);
  const header = lines[0].split(',');
  const expectedCols = ['trade_id','bot','symbol','direction','open_time','close_time','status','close_reason','notional',
    't1_fill_price','t1_slippage_pct','t2_trigger_price','t2_fired','t2_fill_price','t2_slippage_pct',
    'tps_hit','sl_hit','realised_pnl_pct','unrealised_pnl_pct','atr_pct_at_open','add_pct',
    'full_event_timeline_json'];
  assert(JSON.stringify(header) === JSON.stringify(expectedCols),
    `column mismatch:\n  got: ${header.join(',')}\n want: ${expectedCols.join(',')}`);
  // Row body sanity
  const row = lines[1];
  assert(row.includes('s21_bot9_0001'));
  assert(row.includes('Bot9'));
  assert(row.includes('DEEPUSDT'));
  assert(row.includes('MDX_EXIT'));
  // Event timeline embedded as JSON (quoted)
  assert(/"\[\{.*tranche.*\}\]"/.test(row) || row.includes('TP_HIT'), 'event timeline column present');
  console.log(`  PASS — CSV has ${expectedCols.length} columns, row correctly serialised`);
}

function test_csvEscaping() {
  console.log('\n── TEST: CSV cell escaping for quotes and commas ──');
  const fakePersistence = {
    getS21Trades: () => [
      makeTrade({ close_reason: 'a,b "weird"' }),
    ],
    getS21EventsForTrade: () => [],
  };
  const csv = page.buildCsvExport(fakePersistence);
  const lines = csv.trim().split('\n');
  // Find the close_reason column value — should be quoted with escaped inner quote
  assert(csv.includes('"a,b ""weird"""'), `expected CSV-escaped close_reason, got: ${csv}`);
  console.log('  PASS — CSV escaping handles commas and embedded quotes');
}

(function() {
  test_markerOrdering_inProfitDirection();
  test_markerOrdering_highAtrPushesAddPastTp1();
  test_markerLitStates();
  test_markerLit_slHit();
  test_pnlFromEventTimeline();
  test_pnlShort();
  test_emptyRenderDoesNotCrash();
  test_populatedRenderHasMarkerStrip();
  test_csvExportShape();
  test_csvEscaping();
  console.log('\n✅ ALL TRADE-LOG PAGE TESTS PASS');
})();
