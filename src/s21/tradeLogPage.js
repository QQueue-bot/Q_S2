'use strict';

// S2.1 dashboard route: /s2-1/trade-log
//
// Two stacked panels — Trade Log (top) and Signal Log (bottom). Mobile-first.
// Polled every 60s from the front-end via /api/s2-1/trade-log. CSV export
// at /api/s2-1/export.csv.
//
// All timestamps rendered in Europe/Zurich. Marker strip dynamically ordered
// by distance-from-entry-in-profit-direction so the ADD marker slots into its
// real position relative to the TP ladder (varies with ATR).

const { loadS21Config, getS21BotConfig } = require('./config');

const ZURICH_FORMAT = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function formatZurich(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return ZURICH_FORMAT.format(d).replace(',', '');
}

function formatZurichShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const parts = ZURICH_FORMAT.formatToParts(d);
  const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}`;
}

// ── Marker computation ──────────────────────────────────────────────────────

function _markerForTrade(trade, botConfig) {
  const slPct = botConfig.strategy.slPercent;
  const tps = botConfig.strategy.tpTargetsPercent;
  const addPct = trade.add_pct;

  // Distance from entry in the profit direction. Negative for SL, positive for TPs/ADD.
  // For both LONG and SHORT, this representation is direction-agnostic.
  const markers = [
    { label: 'SL',  pct: -slPct,  kind: 'sl'  },
    { label: 'BE',  pct: 0,       kind: 'be'  },
    { label: 'ADD', pct: addPct,  kind: 'add' },
  ];
  tps.forEach((p, i) => markers.push({ label: `TP${i+1}`, pct: p, kind: `tp${i+1}` }));

  markers.sort((a, b) => a.pct - b.pct);

  const direction = trade.direction;
  const entry = trade.t1_fill_price || trade.entry_price_snapshot;
  const tpsHit = trade.tps_hit_json ? JSON.parse(trade.tps_hit_json) : [];

  for (const m of markers) {
    const sign = direction === 'LONG' ? 1 : -1;
    m.price = entry * (1 + sign * m.pct / 100);
    if (m.kind === 'sl') {
      m.lit = Boolean(trade.sl_hit);
    } else if (m.kind === 'be') {
      m.lit = Boolean(trade._be_moved);
    } else if (m.kind === 'add') {
      m.lit = trade.t2_fired === 1;
    } else if (m.kind.startsWith('tp')) {
      const idx = Number(m.kind.slice(2));
      m.lit = tpsHit.includes(`t1_tp${idx}`) || tpsHit.includes(`t2_tp${idx}`);
    }
  }
  return markers;
}

// ── PnL computation from event timeline ─────────────────────────────────────

function _computeRealisedPnlUsd(trade, events, botConfig) {
  const direction = trade.direction;
  const sign = direction === 'LONG' ? 1 : -1;
  const t1Entry = trade.t1_fill_price;
  const t2Entry = trade.t2_fill_price;
  const t1Qty = Number(trade.t1_intended_qty);
  const t2Qty = Number(trade.t2_intended_qty);
  const allocs = botConfig.strategy.tpAllocations;
  const tps = botConfig.strategy.tpTargetsPercent;

  let realised = 0;

  for (const evt of events) {
    if (evt.event_type === 'TP_HIT') {
      const d = JSON.parse(evt.details_json || '{}');
      const tranche = d.tranche;
      const tpIdx = d.tpIdx;
      if (tpIdx == null) continue;
      const tpPrice = (tranche === 't1' ? t1Entry : t1Entry) * (1 + sign * tps[tpIdx] / 100);
      // (Both tranches use the same absolute TP prices — derived from T1 fill price.)
      const trancheQty = tranche === 't1' ? t1Qty : t2Qty;
      const trancheEntry = tranche === 't1' ? t1Entry : t2Entry;
      const qty = trancheQty * allocs[tpIdx];
      if (trancheEntry == null) continue;
      realised += sign * (tpPrice - trancheEntry) * qty;
    } else if (evt.event_type === 'SL_HIT') {
      // SL on a tranche: realized loss is (slPrice - entry) * remaining tranche size.
      // For simplicity in v1, approximate remaining as the entire tranche qty minus
      // qty already closed via TPs in that tranche. Use the SL event's recorded price.
      const d = JSON.parse(evt.details_json || '{}');
      const tranche = (d.tranche || '').toLowerCase();
      if (tranche !== 't1' && tranche !== 't2') continue;
      const trancheQty = tranche === 't1' ? t1Qty : t2Qty;
      const trancheEntry = tranche === 't1' ? t1Entry : t2Entry;
      if (trancheEntry == null) continue;
      // Subtract qty already TP-closed on this tranche
      const tpsClosed = events.filter(e => {
        if (e.event_type !== 'TP_HIT') return false;
        try { return JSON.parse(e.details_json).tranche === tranche; } catch { return false; }
      }).reduce((acc, e) => {
        try {
          const ed = JSON.parse(e.details_json);
          return acc + trancheQty * allocs[ed.tpIdx];
        } catch { return acc; }
      }, 0);
      const remaining = Math.max(0, trancheQty - tpsClosed);
      const slPrice = Number(d.slPrice);
      if (!Number.isFinite(slPrice)) continue;
      realised += sign * (slPrice - trancheEntry) * remaining;
    }
  }
  return realised;
}

// ── Enrich one trade with computed fields ───────────────────────────────────

function _enrichTrade(trade, events, botConfig) {
  const beMoved = events.some(e => e.event_type === 'T1_SL_MOVED_TO_BE');
  trade._be_moved = beMoved;
  trade._markers = _markerForTrade(trade, botConfig);
  const pnlUsd = _computeRealisedPnlUsd(trade, events, botConfig);
  trade._realised_pnl_usd = pnlUsd;
  trade._realised_pnl_pct = trade.intended_notional_usd > 0
    ? (pnlUsd / trade.intended_notional_usd) * 100
    : 0;
  trade._event_count = events.length;
  return trade;
}

// ── Public: prepare JSON data for the page / API ─────────────────────────

function prepareTradeLogData(persistence, options = {}) {
  const tradeLimit = options.tradeLimit || 50;
  const signalLimit = options.signalLimit || 50;

  const trades = persistence.getS21Trades({ limit: tradeLimit, offset: 0 });
  const signals = persistence.getS21Signals({ limit: signalLimit, offset: 0 });

  const config = loadS21Config();
  const botMap = new Map(config.bots.map(b => [b.botId, b]));

  const enrichedTrades = trades.map(trade => {
    const bot = botMap.get(trade.bot_id);
    if (!bot) {
      trade._markers = [];
      trade._be_moved = false;
      trade._realised_pnl_usd = 0;
      trade._realised_pnl_pct = 0;
      trade._event_count = 0;
      return trade;
    }
    const events = persistence.getS21EventsForTrade(trade.trade_id);
    return _enrichTrade(trade, events, bot);
  });

  return {
    generated_at: new Date().toISOString(),
    timezone: 'Europe/Zurich',
    trades: enrichedTrades,
    signals,
    counts: {
      trades_total: persistence.countS21Trades ? persistence.countS21Trades() : enrichedTrades.length,
      signals_total: persistence.countS21Signals ? persistence.countS21Signals() : signals.length,
    },
  };
}

// ── HTML rendering ──────────────────────────────────────────────────────────

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _renderMarkerStrip(markers) {
  const cells = markers.map(m => {
    const litClass = m.lit ? 's21-marker-lit' : '';
    const pct = (m.pct === 0 ? '0' : (m.pct > 0 ? '+' : '') + m.pct.toFixed(2)) + '%';
    return `
      <div class="s21-marker ${litClass} s21-marker-${m.kind}">
        <div class="s21-marker-label">${m.label}</div>
        <div class="s21-marker-pct">${pct}</div>
        <div class="s21-marker-price">${m.price.toFixed(6)}</div>
      </div>`;
  }).join('');
  return `<div class="s21-markers">${cells}</div>`;
}

function _renderTradeCard(trade) {
  const status = trade.status;
  const closed = status === 'CLOSED';
  const dirChip = trade.direction === 'LONG' ? 's21-long' : 's21-short';
  const statusChip = closed ? 's21-status-closed' : 's21-status-running';
  const statusText = closed
    ? `CLOSED · ${trade.close_reason || ''} · ${formatZurichShort(trade.close_time)}`
    : 'RUNNING';
  const cardCls = closed ? 's21-trade-card s21-card-closed' : 's21-trade-card s21-card-running';
  const pnlText = trade._realised_pnl_pct == null
    ? '—'
    : `${trade._realised_pnl_pct >= 0 ? '+' : ''}${trade._realised_pnl_pct.toFixed(2)}% realised`;
  const pnlCls = trade._realised_pnl_pct == null
    ? ''
    : (trade._realised_pnl_pct >= 0 ? 's21-pnl-pos' : 's21-pnl-neg');

  return `
  <details class="${cardCls}">
    <summary class="s21-trade-summary">
      <div class="s21-trade-head">
        <div>
          <div class="s21-trade-id">S2.1-#${trade.trade_number} / ${_escape(trade.bot_id)}</div>
          <div class="s21-trade-meta">
            <span class="s21-chip ${dirChip}">${trade.direction}</span>
            · OPENED ${formatZurichShort(trade.created_at)}
            · $${trade.intended_notional_usd}
          </div>
        </div>
        <div class="s21-trade-status">
          <span class="s21-chip ${statusChip}">${_escape(statusText)}</span>
          <div class="s21-pnl ${pnlCls}">${pnlText}</div>
        </div>
      </div>
      ${_renderMarkerStrip(trade._markers || [])}
    </summary>
    <div class="s21-trade-detail" data-trade-id="${_escape(trade.trade_id)}">
      <div class="s21-detail-grid">
        <div><span class="s21-k">entry</span> ${trade.entry_price_snapshot} <span class="s21-k">atrPct</span> ${(trade.atr_pct_at_open || 0).toFixed(4)}% <span class="s21-k">add</span> ${(trade.add_pct || 0).toFixed(4)}%</div>
        <div><span class="s21-k">T1 fill</span> ${trade.t1_fill_price ?? '—'} <span class="s21-k">slip</span> ${(trade.t1_slippage_pct ?? 0).toFixed(4)}% <span class="s21-k">qty</span> ${trade.t1_intended_qty}</div>
        <div><span class="s21-k">T2 trigger</span> ${trade.t2_trigger_price?.toFixed(6) || '—'} <span class="s21-k">fill</span> ${trade.t2_fill_price?.toFixed(6) ?? (trade.t2_fired ? '?' : 'not fired')} <span class="s21-k">slip</span> ${(trade.t2_slippage_pct ?? 0).toFixed(4)}% <span class="s21-k">qty</span> ${trade.t2_intended_qty}</div>
      </div>
      <div class="s21-events-toggle">▼ Event timeline (${trade._event_count})</div>
      <div class="s21-events-container" data-events-for="${_escape(trade.trade_id)}"></div>
    </div>
  </details>`;
}

function _renderSignalRow(sig) {
  const actedClass = sig.acted === 1 ? 's21-sig-acted' : sig.acted === 0 ? 's21-sig-rejected' : 's21-sig-pending';
  const actedText = sig.acted === 1 ? 'YES' : sig.acted === 0 ? 'NO' : 'PENDING';
  const reason = sig.reject_reason ? ` · ${_escape(sig.reject_reason)}` : '';
  return `
    <div class="s21-signal-row ${actedClass}">
      <div class="s21-sig-time">${formatZurichShort(sig.received_at)}</div>
      <div class="s21-sig-body">
        <span class="s21-sig-bot">${_escape(sig.bot_id || '?')}</span>
        <span class="s21-sig-dir">${_escape(sig.direction || '—')}</span>
      </div>
      <div class="s21-sig-acted">
        <span class="s21-chip s21-sig-chip-${actedClass}">${actedText}</span>${reason}
      </div>
    </div>`;
}

function renderTradeLogBody(data) {
  const tradeCards = data.trades.length === 0
    ? `<div class="s21-empty">No trades yet. Paper mode active until first MDX signal arrives for an S2.1 bot.</div>`
    : data.trades.map(_renderTradeCard).join('\n');

  const signalRows = data.signals.length === 0
    ? `<div class="s21-empty">No S2.1 signals received yet.</div>`
    : data.signals.map(_renderSignalRow).join('\n');

  return `
    <div class="s21-wrap" id="s21-root">
      <div class="s21-pane-head">
        <div>
          <div class="s21-title">S2.1 Trade Log</div>
          <div class="s21-sub">${data.counts.trades_total} trade(s) · ${data.counts.signals_total} signal(s) · refreshed ${formatZurich(data.generated_at)}</div>
        </div>
        <a class="s21-csv-btn" href="/api/s2-1/export.csv" download>Export CSV</a>
      </div>

      <section class="s21-panel">
        <h2 class="s21-panel-title">Trade Log</h2>
        <div id="s21-trades">${tradeCards}</div>
      </section>

      <section class="s21-panel">
        <h2 class="s21-panel-title">Signal Log</h2>
        <div id="s21-signals">${signalRows}</div>
      </section>

      <div class="s21-foot">Polls every 60s. Times in Europe/Zurich.</div>
    </div>
    <script>
      (function() {
        const POLL_MS = 60000;
        async function refresh() {
          try {
            const r = await fetch('/api/s2-1/trade-log');
            if (!r.ok) return;
            const data = await r.json();
            const html = await fetch('/s2-1/trade-log?fragment=1');
            if (!html.ok) return;
            // For v1 just reload subsections by full page reload — simpler than diffing.
            // Cheap enough at 60s. If dashboard usage grows, switch to JSON diff render.
            const newBody = await html.text();
            const m = newBody.match(/<div class="s21-wrap"[\\s\\S]*<\\/script>/);
            if (m) document.getElementById('s21-root').outerHTML = m[0];
          } catch (e) { console.warn('[s2.1] poll failed', e); }
        }
        setInterval(refresh, POLL_MS);
      })();
    </script>`;
}

const TRADE_LOG_CSS = `
  .s21-wrap { padding: 12px; max-width: 720px; margin: 0 auto; }
  .s21-pane-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .s21-title { font-size: 20px; font-weight: 800; color: #e2e8f0; }
  .s21-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
  .s21-csv-btn { background: #1e3a5f; color: #93c5fd; text-decoration: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid #1f2937; }
  .s21-csv-btn:hover { background: #1e40af; color: #dbeafe; }

  .s21-panel { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 12px; margin-bottom: 14px; }
  .s21-panel-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 10px; }

  .s21-empty { font-size: 13px; color: #475569; padding: 12px 0; }

  /* Trade card */
  .s21-trade-card { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; margin-bottom: 8px; }
  .s21-card-running { border-color: #3b82f6; box-shadow: 0 0 0 1px #1e3a5f, 0 0 12px rgba(59,130,246,0.18); }
  .s21-card-closed { opacity: 0.92; }
  .s21-trade-summary { cursor: pointer; padding: 10px 12px; list-style: none; }
  .s21-trade-summary::-webkit-details-marker { display: none; }
  .s21-trade-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .s21-trade-id { font-size: 14px; font-weight: 700; color: #e2e8f0; }
  .s21-trade-meta { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .s21-trade-status { text-align: right; }
  .s21-pnl { font-size: 11px; margin-top: 3px; font-weight: 600; }
  .s21-pnl-pos { color: #86efac; }
  .s21-pnl-neg { color: #fca5a5; }

  .s21-chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 999px; display: inline-block; }
  .s21-long { background: #14532d; color: #bbf7d0; }
  .s21-short { background: #7f1d1d; color: #fecaca; }
  .s21-status-running { background: #1e3a5f; color: #93c5fd; }
  .s21-status-closed { background: #1e293b; color: #cbd5e1; }

  /* Marker strip */
  .s21-markers { display: grid; grid-template-columns: repeat(9, 1fr); gap: 2px; padding: 4px; background: #0a0f1c; border-radius: 6px; }
  .s21-marker { padding: 4px 2px; text-align: center; border-radius: 4px; background: #0f172a; opacity: 0.5; }
  .s21-marker-lit { opacity: 1; background: #1e3a5f; }
  .s21-marker-sl.s21-marker-lit { background: #7f1d1d; }
  .s21-marker-be.s21-marker-lit { background: #14532d; }
  .s21-marker-add.s21-marker-lit { background: #581c87; }
  .s21-marker-label { font-size: 9px; font-weight: 700; color: #94a3b8; letter-spacing: 0.04em; }
  .s21-marker-lit .s21-marker-label { color: #e2e8f0; }
  .s21-marker-pct { font-size: 10px; color: #64748b; margin-top: 1px; }
  .s21-marker-price { font-size: 8px; color: #475569; margin-top: 1px; font-family: 'SF Mono', Menlo, monospace; }
  @media (max-width: 600px) {
    .s21-marker-pct, .s21-marker-price { display: none; }
    .s21-trade-card[open] .s21-marker-pct,
    .s21-trade-card[open] .s21-marker-price { display: block; }
  }

  /* Trade detail (expanded) */
  .s21-trade-detail { padding: 0 12px 12px; border-top: 1px solid #1e293b; }
  .s21-detail-grid { display: grid; gap: 6px; padding: 10px 0; font-size: 11px; color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; }
  .s21-k { color: #64748b; margin-right: 4px; }
  .s21-events-toggle { font-size: 11px; color: #93c5fd; margin: 6px 0; }
  .s21-events-container { font-size: 11px; color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; }

  /* Signal Log */
  .s21-signal-row { display: grid; grid-template-columns: 100px 1fr auto; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #1e293b; font-size: 12px; align-items: center; }
  .s21-signal-row:last-child { border-bottom: none; }
  .s21-sig-time { color: #64748b; font-family: 'SF Mono', Menlo, monospace; }
  .s21-sig-bot { font-weight: 700; color: #e2e8f0; }
  .s21-sig-dir { color: #94a3b8; margin-left: 4px; }
  .s21-sig-acted { font-size: 11px; }
  .s21-sig-chip-s21-sig-acted { background: #14532d; color: #bbf7d0; }
  .s21-sig-chip-s21-sig-rejected { background: #7f1d1d; color: #fecaca; }
  .s21-sig-chip-s21-sig-pending { background: #422006; color: #fde68a; }

  .s21-foot { text-align: center; font-size: 11px; color: #475569; margin-top: 14px; }
`;

// ── CSV export ──────────────────────────────────────────────────────────────

function _csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvExport(persistence) {
  const config = loadS21Config();
  const botMap = new Map(config.bots.map(b => [b.botId, b]));
  const trades = persistence.getS21Trades({ limit: 10000, offset: 0 });
  const cols = [
    'trade_id', 'bot', 'symbol', 'direction', 'open_time', 'close_time', 'status', 'close_reason', 'notional',
    't1_fill_price', 't1_slippage_pct', 't2_trigger_price', 't2_fired', 't2_fill_price', 't2_slippage_pct',
    'tps_hit', 'sl_hit', 'realised_pnl_pct', 'unrealised_pnl_pct', 'atr_pct_at_open', 'add_pct',
    'full_event_timeline_json',
  ];
  const rows = [cols.join(',')];
  for (const t of trades) {
    const events = persistence.getS21EventsForTrade(t.trade_id);
    const bot = botMap.get(t.bot_id);
    const pnlPct = bot ? (_computeRealisedPnlUsd(t, events, bot) / (t.intended_notional_usd || 1)) * 100 : 0;
    const row = [
      t.trade_id, t.bot_id, t.symbol, t.direction,
      t.created_at, t.close_time, t.status, t.close_reason, t.intended_notional_usd,
      t.t1_fill_price, t.t1_slippage_pct, t.t2_trigger_price, t.t2_fired, t.t2_fill_price, t.t2_slippage_pct,
      t.tps_hit_json || '[]', t.sl_hit, pnlPct.toFixed(4),
      0,  // unrealised_pnl_pct (live ticker not wired yet)
      t.atr_pct_at_open, t.add_pct,
      JSON.stringify(events),
    ].map(_csvCell).join(',');
    rows.push(row);
  }
  return rows.join('\n') + '\n';
}

module.exports = {
  prepareTradeLogData,
  renderTradeLogBody,
  buildCsvExport,
  TRADE_LOG_CSS,
  formatZurich,
  formatZurichShort,
  // exposed for tests
  _markerForTrade,
  _computeRealisedPnlUsd,
  _enrichTrade,
};
