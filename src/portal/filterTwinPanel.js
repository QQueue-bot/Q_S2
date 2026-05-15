'use strict';
/**
 * src/portal/filterTwinPanel.js
 *
 * Filter-twin dashboard surfaces (feature/filter-twin, Phase 2 Part 2):
 *
 *   - renderFilterTwinSection(dbPath)  → two new sections injected into /s2:
 *       (1) per-bot grid (8 rows × {live-filter equity, vanilla equity,
 *           live-filter maxDD, vanilla maxDD}) with overlaid equity sparklines
 *       (2) portfolio aggregate ($800 baseline = $100 × 8 for the vanilla twin)
 *
 *   - prepareFilterTwinLog / renderFilterTwinLogBody / FILTER_TWIN_CSS →
 *       the /s2-twin signal+trade log page, mirroring the /s2-1/trade-log look.
 *
 * Read-only. Self-contained (own readonly DB handle + own namespaced canvas
 * script) so it cannot perturb the existing /s2 chart engine. Empty-safe: with
 * FILTER_GATE_ENABLED / PAPER_VANILLA_ENABLED still default-false there is no
 * data yet — every surface degrades to an explicit "no data" state.
 */

const BOTS = ['Bot1', 'Bot2', 'Bot3', 'Bot4', 'Bot5', 'Bot6', 'Bot7', 'Bot8'];
const VANILLA_BASE = 100;            // $/bot — matches paperVanillaExecutor START_BAL
const HOUR_MS = 3.6e6;

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _fmtTime(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 19).replace('T', ' ');
}
function _num(v, d = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}
function _signed(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

// maxDD over a $-equity curve, returned as a non-positive %.
function _maxDD(curve) {
  if (!curve || curve.length < 2) return 0;
  let peak = curve[0], mdd = 0;
  for (const v of curve) { peak = Math.max(peak, v); if (peak > 0) mdd = Math.min(mdd, (v - peak) / peak * 100); }
  return mdd;
}

/**
 * Compute per-bot + aggregate equity/DD for both twins.
 * Vanilla   : closed paper_positions where paper_bot_id LIKE 'vanilla_%'.
 * Live-filter: real executed trades (order_attempts entries matched to
 *              exit_events) — same realisation logic the existing /s2 equity
 *              panel uses. Empty until FILTER_GATE_ENABLED has been live.
 */
function loadFilterTwinData(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const LIVE_BASE_TOTAL = Number(process.env.PORTFOLIO_BASELINE_USDT || 2799.94);
    const LIVE_BASE = LIVE_BASE_TOTAL / 8; // per-bot live capital

    // ── vanilla twin (paper_positions) ──
    const vRows = db.prepare(
      "SELECT live_bot_id, exit_pnl_usd, closed_at FROM paper_positions " +
      "WHERE substr(paper_bot_id,1,8) = 'vanilla_' AND status = 'closed' " +
      "AND exit_pnl_usd IS NOT NULL ORDER BY closed_at ASC"
    ).all();
    const vOpen = db.prepare(
      "SELECT COUNT(*) c FROM paper_positions " +
      "WHERE substr(paper_bot_id,1,8) = 'vanilla_' AND status = 'open'"
    ).get();

    // ── live-filter twin (real fills) ──
    const entries = db.prepare(`
      SELECT id, bot_id, symbol, signal, notional_usd, qty, created_at
      FROM order_attempts
      WHERE signal LIKE 'ENTER%' AND signal NOT LIKE '%DCA_ADD%'
        AND signal NOT LIKE '%CLOSE_FIRST%'
      ORDER BY id ASC`).all();
    const exitRows = db.prepare(`
      SELECT bot_id, symbol, exit_reason, trigger_percent, close_percent, mark_price, created_at
      FROM exit_events ORDER BY id ASC`).all();

    db.close();

    const perBot = {};
    for (const b of BOTS) {
      perBot[b] = {
        vanilla: { curve: [VANILLA_BASE], pnl: 0, trades: 0, wins: 0, open: 0 },
        filter:  { curve: [LIVE_BASE],    pnl: 0, trades: 0, wins: 0 },
      };
    }

    for (const r of vRows) {
      const pb = perBot[r.live_bot_id]; if (!pb) continue;
      const p = Number(r.exit_pnl_usd) || 0;
      pb.vanilla.pnl += p; pb.vanilla.trades += 1; if (p > 0) pb.vanilla.wins += 1;
      pb.vanilla.curve.push(VANILLA_BASE + pb.vanilla.pnl);
    }
    if (vOpen && vOpen.c) {
      // distribute open-position count for display only (no equity effect)
      const openByBot = {};
      // cheap second pass not needed; report total instead
      perBot._vanillaOpenTotal = vOpen.c;
    }

    // realise live-filter trades (same slicing as the existing /s2 panel)
    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      const pb = perBot[en.bot_id]; if (!pb) continue;
      const isLong = String(en.signal).includes('LONG');
      const qty = parseFloat(en.qty) || 0;
      const ep = qty > 0 ? en.notional_usd / qty : 0;
      const next = entries.slice(i + 1).find(e => e.bot_id === en.bot_id && e.symbol === en.symbol);
      const cutoff = next ? next.created_at : null;
      const exs = exitRows.filter(e => e.bot_id === en.bot_id && e.symbol === en.symbol &&
        e.created_at > en.created_at && (!cutoff || e.created_at <= cutoff));
      let pnl = 0, rem = 1.0, closed = false;
      for (const ex of exs) {
        const sf = (ex.close_percent / 100) * rem; const sn = en.notional_usd * sf;
        let slice;
        if (ex.exit_reason === 'take_profit') slice = (ex.trigger_percent / 100) * sn;
        else if (ex.exit_reason === 'stop_loss') slice = -(ex.trigger_percent / 100) * sn;
        else { const mv = ep > 0 ? (isLong ? (ex.mark_price - ep) / ep : (ep - ex.mark_price) / ep) : 0; slice = mv * sn; }
        pnl += slice; rem -= sf;
        if (ex.close_percent >= 100 || rem <= 0.001) { closed = true; break; }
      }
      if (!closed) continue;
      pb.filter.pnl += pnl; pb.filter.trades += 1; if (pnl > 0) pb.filter.wins += 1;
      pb.filter.curve.push(LIVE_BASE + pb.filter.pnl);
    }

    const rows = BOTS.map(b => {
      const v = perBot[b].vanilla, f = perBot[b].filter;
      return {
        botId: b,
        vanilla: { pnlUsd: v.pnl, pnlPct: (v.pnl / VANILLA_BASE) * 100, maxDD: _maxDD(v.curve), trades: v.trades, wins: v.wins, curve: v.curve },
        filter:  { pnlUsd: f.pnl, pnlPct: (f.pnl / LIVE_BASE) * 100,   maxDD: _maxDD(f.curve),  trades: f.trades, wins: f.wins, curve: f.curve },
      };
    });

    const agg = (key, base) => {
      let pnl = 0, trades = 0, wins = 0;
      for (const r of rows) { pnl += r[key].pnlUsd; trades += r[key].trades; wins += r[key].wins; }
      const worstDD = Math.min(0, ...rows.map(r => r[key].maxDD));
      return { pnlUsd: pnl, pnlPct: (pnl / base) * 100, trades, wins, worstDD, base };
    };

    return {
      ok: true,
      rows,
      vanillaOpen: perBot._vanillaOpenTotal || 0,
      vanillaBaseTotal: VANILLA_BASE * 8,        // $800
      filterBaseTotal: LIVE_BASE_TOTAL,
      vanillaAgg: agg('vanilla', VANILLA_BASE * 8),
      filterAgg: agg('filter', LIVE_BASE_TOTAL),
      generatedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ok: false, error: e.message, rows: [], generatedAt: new Date().toISOString() };
  }
}

function _sparkline(id, vCurve, fCurve) {
  return `<canvas class="ftw-spark" id="${id}" data-v='${JSON.stringify(vCurve || [])}' data-f='${JSON.stringify(fCurve || [])}'></canvas>`;
}

function renderFilterTwinSection(dbPath) {
  const d = loadFilterTwinData(dbPath);

  if (!d.ok) {
    return `<div class="ftw-block"><div class="ftw-head">Filter Twin</div>
      <div class="ftw-empty">Filter-twin data unavailable: ${_escape(d.error)}</div></div>`;
  }

  const va = d.vanillaAgg, fa = d.filterAgg;
  const noData = va.trades === 0 && fa.trades === 0;

  const botRows = d.rows.map((r, i) => `
    <div class="ftw-row">
      <div class="ftw-bot">${_escape(r.botId)}</div>
      <div class="ftw-cell">
        <div class="ftw-k">live-filter eq</div>
        <div class="ftw-v ${r.filter.pnlUsd >= 0 ? 'ftw-pos' : 'ftw-neg'}">${_signed(r.filter.pnlPct)}%</div>
        <div class="ftw-sub">${_signed(r.filter.pnlUsd)} $ · ${r.filter.trades}t</div>
      </div>
      <div class="ftw-cell">
        <div class="ftw-k">vanilla eq</div>
        <div class="ftw-v ${r.vanilla.pnlUsd >= 0 ? 'ftw-pos' : 'ftw-neg'}">${_signed(r.vanilla.pnlPct)}%</div>
        <div class="ftw-sub">${_signed(r.vanilla.pnlUsd)} $ · ${r.vanilla.trades}t</div>
      </div>
      <div class="ftw-cell">
        <div class="ftw-k">live-filter DD</div>
        <div class="ftw-v ftw-neg">${_num(r.filter.maxDD, 1)}%</div>
      </div>
      <div class="ftw-cell">
        <div class="ftw-k">vanilla DD</div>
        <div class="ftw-v ftw-neg">${_num(r.vanilla.maxDD, 1)}%</div>
      </div>
      <div class="ftw-cell ftw-spark-cell">
        <div class="ftw-k">equity (filter ░ vanilla ▒)</div>
        ${_sparkline('ftw-sp-' + i, r.vanilla.curve, r.filter.curve)}
      </div>
    </div>`).join('\n');

  return `
  <div class="ftw-block">
    <div class="ftw-head">Filter Twin — per bot</div>
    ${noData ? `<div class="ftw-empty">No filter-twin trades yet — FILTER_GATE_ENABLED and PAPER_VANILLA_ENABLED are still OFF (default). Curves populate once the live filter / vanilla paper twin are activated.</div>` : ''}
    <div class="ftw-grid">${botRows}</div>
  </div>

  <div class="ftw-block">
    <div class="ftw-head">Filter Twin — portfolio aggregate</div>
    <div class="ftw-agg">
      <div class="ftw-agg-card">
        <div class="ftw-k">LIVE-FILTER ($${_num(d.filterBaseTotal, 0)} base)</div>
        <div class="ftw-agg-v ${fa.pnlUsd >= 0 ? 'ftw-pos' : 'ftw-neg'}">${_signed(fa.pnlUsd)} $</div>
        <div class="ftw-sub">${_signed(fa.pnlPct)}% · ${fa.trades} trades · ${fa.wins}W · worst-bot DD ${_num(fa.worstDD, 1)}%</div>
      </div>
      <div class="ftw-agg-card">
        <div class="ftw-k">VANILLA ($${_num(d.vanillaBaseTotal, 0)} base = $100×8)</div>
        <div class="ftw-agg-v ${va.pnlUsd >= 0 ? 'ftw-pos' : 'ftw-neg'}">${_signed(va.pnlUsd)} $</div>
        <div class="ftw-sub">${_signed(va.pnlPct)}% · ${va.trades} trades · ${va.wins}W · worst-bot DD ${_num(va.worstDD, 1)}% · ${d.vanillaOpen} open</div>
      </div>
    </div>
    <div class="ftw-foot">Full per-signal log: <a class="ftw-link" href="/s2-twin">/s2-twin</a> · generated ${_fmtTime(d.generatedAt)} UTC</div>
  </div>

  <script>
  (function(){
    var cs = document.querySelectorAll('.ftw-spark');
    for (var i=0;i<cs.length;i++){ (function(cv){
      var v, f;
      try { v = JSON.parse(cv.getAttribute('data-v')||'[]'); f = JSON.parse(cv.getAttribute('data-f')||'[]'); } catch(e){ return; }
      var w = cv.parentElement.clientWidth - 4, h = 38;
      var dpr = window.devicePixelRatio||1;
      cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
      cv.style.width=w+'px'; cv.style.height=h+'px';
      var x = cv.getContext('2d'); x.scale(dpr,dpr);
      function norm(a){ if(!a||a.length<2) return null; var c=a.map(function(p,ix){return{x:ix/(a.length-1),y:p};}); return c; }
      var all=[].concat(v||[],f||[]); if(all.length<2){ x.fillStyle='#475569'; x.font='10px Inter,sans-serif'; x.fillText('no data', 4, 22); return; }
      var mn=Math.min.apply(null,all), mx=Math.max.apply(null,all); var rng=(mx-mn)||1;
      function draw(a,col){ var c=norm(a); if(!c)return; x.beginPath(); for(var k=0;k<c.length;k++){ var px=2+c[k].x*(w-4); var py=2+(1-(c[k].y-mn)/rng)*(h-4); if(k===0)x.moveTo(px,py); else x.lineTo(px,py);} x.strokeStyle=col; x.lineWidth=1.25; x.stroke(); }
      draw(v,'#64748b'); draw(f,'#3b82f6');
    })(cs[i]); }
  })();
  </script>`;
}

// ── /s2-twin signal + trade log ──────────────────────────────────────────────

/**
 * One row per: (a) vanilla paper position, (b) live-filter decision.
 * Skipped live-filter decisions (filter_action starts 'skip') carry no
 * trade and render greyed/italic. Newest first; bot+mode filterable.
 */
function prepareFilterTwinLog(persistence, options = {}) {
  const limit = Number(options.limit) || 300;
  const botFilter = options.bot && options.bot !== 'all' ? options.bot : null;
  const modeFilter = options.mode && options.mode !== 'all' ? options.mode : null;

  const out = [];

  if (!modeFilter || modeFilter === 'paper_vanilla') {
    let vp = [];
    try { vp = persistence.getVanillaPaperPositions ? persistence.getVanillaPaperPositions() : []; } catch (_) { vp = []; }
    for (const p of vp) {
      if (botFilter && p.live_bot_id !== botFilter) continue;
      const bars = (p.created_at && p.closed_at)
        ? Math.max(0, Math.round((Date.parse(p.closed_at) - Date.parse(p.created_at)) / HOUR_MS))
        : null;
      out.push({
        ts: p.created_at,
        bot_id: p.live_bot_id,
        side: p.side === 'Buy' ? 'LONG' : (p.side === 'Sell' ? 'SHORT' : (p.side || '—')),
        entry_price: p.entry_price,
        mode: 'paper_vanilla',
        filter_action: '—',
        exit_price: p.exit_price,
        exit_reason: p.exit_reason || (p.status === 'open' ? 'OPEN' : '—'),
        pnl_pct: p.exit_pnl_pct,
        pnl_usd: p.exit_pnl_usd,
        bars_held: bars,
        skipped: false,
        status: p.status,
      });
    }
  }

  if (!modeFilter || modeFilter === 'live_filter') {
    let fd = [];
    try { fd = persistence.getFilterDecisions ? persistence.getFilterDecisions() : []; } catch (_) { fd = []; }
    for (const r of fd) {
      if (botFilter && r.bot_id !== botFilter) continue;
      const skipped = typeof r.filter_action === 'string' && r.filter_action.startsWith('skip');
      out.push({
        ts: r.signal_time_utc || r.created_at,
        bot_id: r.bot_id,
        side: r.side || (String(r.signal || '').includes('LONG') ? 'LONG' : String(r.signal || '').includes('SHORT') ? 'SHORT' : '—'),
        entry_price: skipped ? null : r.signal_price,
        mode: 'live_filter',
        filter_action: r.filter_action || '—',
        exit_price: null,
        exit_reason: skipped ? 'skipped' : '—',
        pnl_pct: null,
        pnl_usd: null,
        bars_held: null,
        skipped,
        status: skipped ? 'skipped' : 'taken',
      });
    }
  }

  out.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  const total = out.length;
  return {
    rows: out.slice(0, limit),
    total,
    shown: Math.min(total, limit),
    bots: BOTS,
    filters: { bot: botFilter || 'all', mode: modeFilter || 'all' },
    generatedAt: new Date().toISOString(),
  };
}

function _logRow(r) {
  const cls = r.skipped ? 'ftl-row ftl-skipped' : 'ftl-row';
  const sideCls = r.side === 'LONG' ? 'ftl-long' : r.side === 'SHORT' ? 'ftl-short' : '';
  const pnlCls = Number(r.pnl_usd) > 0 ? 'ftl-pos' : Number(r.pnl_usd) < 0 ? 'ftl-neg' : '';
  return `<div class="${cls}">
    <div>${_fmtTime(r.ts)}</div>
    <div>${_escape(r.bot_id || '—')}</div>
    <div class="${sideCls}">${_escape(r.side || '—')}</div>
    <div>${r.entry_price != null ? _num(r.entry_price, 6) : '—'}</div>
    <div><span class="ftl-mode ftl-mode-${r.mode === 'live_filter' ? 'lf' : 'v'}">${r.mode === 'live_filter' ? 'live-filter' : 'vanilla'}</span></div>
    <div>${_escape(r.filter_action)}</div>
    <div>${r.exit_price != null ? _num(r.exit_price, 6) : '—'}</div>
    <div>${_escape(r.exit_reason || '—')}</div>
    <div class="${pnlCls}">${r.pnl_pct != null ? _signed(r.pnl_pct) + '%' : '—'}</div>
    <div class="${pnlCls}">${r.pnl_usd != null ? _signed(r.pnl_usd) : '—'}</div>
    <div>${r.bars_held != null ? r.bars_held : '—'}</div>
  </div>`;
}

function renderFilterTwinLogBody(data) {
  const f = data.filters || { bot: 'all', mode: 'all' };
  const botOpts = ['all', ...(data.bots || BOTS)].map(b =>
    `<option value="${b}"${f.bot === b ? ' selected' : ''}>${b === 'all' ? 'All bots' : b}</option>`).join('');
  const modeOpts = [['all', 'All modes'], ['live_filter', 'Live-filter'], ['paper_vanilla', 'Vanilla']].map(([v, l]) =>
    `<option value="${v}"${f.mode === v ? ' selected' : ''}>${l}</option>`).join('');

  const head = `<div class="ftl-row ftl-head">
    <div>TIMESTAMP (UTC)</div><div>BOT</div><div>SIDE</div><div>ENTRY</div><div>MODE</div>
    <div>FILTER ACTION</div><div>EXIT</div><div>EXIT REASON</div><div>PNL %</div><div>PNL $</div><div>BARS</div>
  </div>`;

  const body = (data.rows && data.rows.length)
    ? data.rows.map(_logRow).join('\n')
    : `<div class="ftl-empty">No filter-twin signals recorded yet. With FILTER_GATE_ENABLED and PAPER_VANILLA_ENABLED still OFF (default) this log stays empty until the twins are activated.</div>`;

  return `
  <div class="ftl-wrap" id="ftl-root">
    <div class="ftl-pane-head">
      <div>
        <div class="ftl-title">S2 Filter Twin — Signal &amp; Trade Log</div>
        <div class="ftl-sub">${data.shown} of ${data.total} row(s) · vanilla paper twin + live-filter decisions · refreshed ${_fmtTime(data.generatedAt)} UTC</div>
      </div>
      <form class="ftl-filters" method="get" action="/s2-twin">
        <select name="bot">${botOpts}</select>
        <select name="mode">${modeOpts}</select>
        <button type="submit">Filter</button>
      </form>
    </div>
    <section class="ftl-panel">
      <div class="ftl-table">
        ${head}
        ${body}
      </div>
    </section>
    <div class="ftl-foot">Skipped live-filter decisions are greyed/italic and carry no trade. Times in UTC.</div>
  </div>`;
}

const FILTER_TWIN_CSS = `
  /* /s2 injected sections */
  .ftw-block { background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;margin-top:16px; }
  .ftw-head { font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e293b; }
  .ftw-empty { font-size:12px;color:#fcd34d;background:#451a03;border:1px solid #92400e;border-radius:8px;padding:8px 10px;margin-bottom:10px; }
  .ftw-grid { display:flex;flex-direction:column;gap:6px; }
  .ftw-row { display:grid;grid-template-columns:48px repeat(4,1fr) 1.4fr;gap:6px;align-items:center;background:#0f172a;border:1px solid #1f2937;border-radius:8px;padding:8px; }
  .ftw-bot { font-size:13px;font-weight:800;color:#e2e8f0; }
  .ftw-cell { text-align:center; }
  .ftw-k { font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.04em; }
  .ftw-v { font-size:14px;font-weight:700;margin-top:2px; }
  .ftw-sub { font-size:10px;color:#64748b;margin-top:1px; }
  .ftw-pos { color:#86efac; } .ftw-neg { color:#fca5a5; }
  .ftw-spark-cell { padding:0 4px; }
  .ftw-spark { display:block;width:100%;height:38px; }
  .ftw-agg { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
  .ftw-agg-card { background:#0f172a;border:1px solid #1f2937;border-radius:10px;padding:12px;text-align:center; }
  .ftw-agg-v { font-size:22px;font-weight:800;margin-top:4px; }
  .ftw-foot { font-size:11px;color:#475569;margin-top:10px; }
  .ftw-link { color:#93c5fd;text-decoration:none; }
  @media (max-width:520px){ .ftw-row{grid-template-columns:40px repeat(2,1fr);} .ftw-spark-cell{grid-column:1/-1;} .ftw-agg{grid-template-columns:1fr;} }

  /* /s2-twin log page (mirrors /s2-1/trade-log) */
  .ftl-wrap { padding:12px;max-width:1180px;margin:0 auto; }
  .ftl-pane-head { display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap; }
  .ftl-title { font-size:20px;font-weight:800;color:#e2e8f0; }
  .ftl-sub { font-size:11px;color:#64748b;margin-top:2px; }
  .ftl-filters select { background:#0f172a;border:1px solid #1f2937;color:#e2e8f0;border-radius:8px;padding:7px 10px;font-size:13px;margin-left:6px; }
  .ftl-filters button { background:#1e3a5f;color:#93c5fd;border:1px solid #1f2937;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;margin-left:6px;cursor:pointer; }
  .ftl-filters button:hover { background:#1e40af;color:#dbeafe; }
  .ftl-panel { background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px; }
  .ftl-table { display:flex;flex-direction:column; }
  .ftl-row { display:grid;grid-template-columns:148px 56px 56px 96px 92px 110px 96px 110px 80px 80px 48px;gap:8px;padding:8px 6px;font-size:12px;align-items:center;border-bottom:1px solid #1e293b;font-family:'SF Mono',Menlo,monospace; }
  .ftl-row:last-child { border-bottom:none; }
  .ftl-head { font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;background:#0a0f1c;border-radius:6px 6px 0 0;font-family:Inter,system-ui,sans-serif; }
  .ftl-skipped { opacity:.5;font-style:italic; }
  .ftl-long { color:#86efac;font-weight:700; } .ftl-short { color:#fca5a5;font-weight:700; }
  .ftl-pos { color:#86efac; } .ftl-neg { color:#fca5a5; }
  .ftl-mode { font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;display:inline-block; }
  .ftl-mode-lf { background:#1e3a5f;color:#93c5fd; } .ftl-mode-v { background:#1e293b;color:#cbd5e1; }
  .ftl-empty { font-size:13px;color:#fcd34d;background:#451a03;border:1px solid #92400e;border-radius:8px;padding:14px;text-align:center; }
  .ftl-foot { text-align:center;font-size:11px;color:#475569;margin-top:14px; }
`;

module.exports = {
  loadFilterTwinData,
  renderFilterTwinSection,
  prepareFilterTwinLog,
  renderFilterTwinLogBody,
  FILTER_TWIN_CSS,
};
