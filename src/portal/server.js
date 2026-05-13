'use strict';

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { buildMobileBotStatus } = require('../dashboard/buildMobileBotStatus');

const S4_EMA_LIVE_DIR = '/home/ubuntu/s4_ema_live';

const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || '';
const COOKIE_NAME = 'portal_token';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cookieSecret() {
  return crypto.createHash('sha256').update('portal:' + PORTAL_PASSWORD).digest('hex');
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', cookieSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', cookieSecret()).update(payload).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    const { ts } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Date.now() - ts < TOKEN_TTL_MS;
  } catch { return false; }
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k) cookies[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

function isAuthenticated(req) {
  if (!PORTAL_PASSWORD) return true;
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const BASE_CSS = `
  :root{color-scheme:dark;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;}
  .q-nav{display:flex;align-items:center;gap:4px;padding:10px 16px;background:#111827;border-bottom:1px solid #1f2937;position:sticky;top:0;z-index:100;}
  .q-nav-logo{font-size:13px;font-weight:700;color:#93c5fd;margin-right:12px;letter-spacing:.05em;white-space:nowrap;}
  .q-nav-tab{padding:6px 14px;border-radius:8px;font-size:14px;font-weight:600;color:#94a3b8;text-decoration:none;}
  .q-nav-tab:hover{background:#1e293b;color:#e2e8f0;}
  .q-nav-tab.active{background:#1e3a5f;color:#93c5fd;}
  h1,h2,h3,p{margin:0;}
`;

function navBar(active) {
  const tabs = [
    { key: 's2',   href: '/s2',                label: 'S2'   },
    { key: 's2-1', href: '/s2-1/trade-log',    label: 'S2.1' },
    { key: 's4',   href: '/s4',                label: 'S4'   },
    { key: 's6',   href: '/s6',                label: 'S6'   },
  ];
  return `<nav class="q-nav">
    <span class="q-nav-logo">Q Portal</span>
    ${tabs.map(t => `<a href="${t.href}" class="q-nav-tab${active === t.key ? ' active' : ''}">${t.label}</a>`).join('')}
  </nav>`;
}

function pageShell(active, title, css, body, headExtra = '') {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${headExtra}
  <title>${title}</title>
  <style>${BASE_CSS}${css}</style>
</head>
<body>
  ${navBar(active)}
  ${body}
</body>
</html>`;
}

// ─── Login page ───────────────────────────────────────────────────────────────

function renderLoginPage(error = false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Q Portal</title>
  <style>
    :root{color-scheme:dark;}
    body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;width:100%;max-width:320px;}
    h1{font-size:20px;margin:0 0 24px;text-align:center;color:#93c5fd;}
    input{width:100%;padding:10px 14px;background:#0f172a;border:1px solid #1f2937;border-radius:8px;color:#e2e8f0;font-size:16px;margin-bottom:14px;outline:none;}
    input:focus{border-color:#3b82f6;}
    button{width:100%;padding:10px;background:#1e3a5f;border:none;border-radius:8px;color:#93c5fd;font-size:16px;font-weight:600;cursor:pointer;}
    button:hover{background:#1e4a7f;}
    .err{color:#fca5a5;font-size:13px;text-align:center;margin-bottom:12px;}
  </style>
</head>
<body>
  <div class="box">
    <h1>Q Portal</h1>
    ${error ? '<div class="err">Incorrect password</div>' : ''}
    <form method="post" action="/login">
      <input type="password" name="password" placeholder="Password" autofocus>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── Trade assessment helpers ─────────────────────────────────────────────────

function loadTradeAssessments(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trade_assessments'").get();
    if (!hasTable) { db.close(); return { rows: [], pendingCount: 0 }; }
    const rows = db.prepare('SELECT * FROM trade_assessments ORDER BY id DESC LIMIT 30').all();
    const pendingCount = rows.filter(r => !r.post_trade_text).length;
    db.close();
    return { rows, pendingCount };
  } catch {
    return { rows: [], pendingCount: 0 };
  }
}

function renderTradeAssessmentsPanel({ rows = [], pendingCount = 0 } = {}) {
  const banner = pendingCount > 0
    ? `<div class="ta-banner">&#128203; ${pendingCount} trade${pendingCount > 1 ? 's' : ''} awaiting post-trade review — share Bybit charts to complete assessment</div>`
    : '';

  if (!rows.length) {
    return `${banner}<div class="ta-empty">No trade assessments logged yet.</div>`;
  }

  const cards = rows.map(r => {
    const isPending = !r.post_trade_text;
    const score = r.s3_score !== null && r.s3_score !== undefined ? `${r.s3_score}/100` : 'n/a';
    const entryShort = (r.entry_time || '').slice(0, 16).replace('T', ' ');
    const badge = isPending
      ? `<span class="ta-badge ta-open">OPEN</span>`
      : `<span class="ta-badge ta-closed">CLOSED ${r.actual_pnl_pct !== null && r.actual_pnl_pct !== undefined ? (r.actual_pnl_pct >= 0 ? '+' : '') + Number(r.actual_pnl_pct).toFixed(2) + '%' : ''}</span>`;

    const postSection = !isPending ? `
      <div class="ta-divider"></div>
      <div class="ta-lbl">Post-trade</div>
      <div class="ta-body">${r.post_trade_text || ''}</div>
      ${r.exit_reason ? `<div class="ta-meta">Exit: ${r.exit_reason}${r.exit_time ? ' @ ' + r.exit_time.slice(0, 16).replace('T', ' ') : ''}</div>` : ''}
    ` : '';

    return `<div class="ta-card ${isPending ? 'ta-card-open' : 'ta-card-closed'}">
      <div class="ta-header">
        <span class="ta-title">${r.bot_id} · ${r.symbol} · ${r.direction}</span>
        ${badge}
      </div>
      <div class="ta-meta">Entry: ${entryShort} UTC &nbsp;·&nbsp; S3: ${score}</div>
      <div class="ta-lbl">Pre-trade assessment</div>
      <div class="ta-body">${r.pre_trade_text || ''}</div>
      ${postSection}
    </div>`;
  }).join('\n');

  return `${banner}<div class="ta-list">${cards}</div>`;
}

// ─── S6 Signal Scout helpers ─────────────────────────────────────────────────

function fetchS6QueueCount() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: 8082, path: '/api/queue', method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(Array.isArray(data) ? data.length : 0);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ─── Landing page ─────────────────────────────────────────────────────────────

function renderLandingPage(status, s6QueueCount) {
  const totals = status?.totals || {};
  const portfolio = status?.portfolio || {};
  const mdx = status?.mdx || {};
  const activity = status?.activity || {};
  const now = status?.generatedAt || new Date().toISOString();

  const mdxColor = { green: '#86efac', amber: '#fcd34d', red: '#fca5a5', neutral: '#94a3b8' }[mdx.color || 'neutral'];
  const mdxVal = mdx.daysRemaining !== null ? `${mdx.daysRemaining}d` : '–';

  const totalBalStr = portfolio.totalBalance > 0
    ? `${portfolio.totalBalance.toFixed(0)} USDT`
    : '–';
  const upnlStr = Number.isFinite(portfolio.totalUnrealizedPnl) && portfolio.totalUnrealizedPnl !== 0
    ? `${portfolio.totalUnrealizedPnl >= 0 ? '+' : ''}${portfolio.totalUnrealizedPnl.toFixed(2)} uPnL`
    : '';

  const lastSignalStr = activity.latestSignal
    ? `${activity.latestSignal.bot_id} ${activity.latestSignal.signal} · ${activity.latestSignal.ageMinutes}m ago`
    : 'No signal';

  const CSS = `
    .pg{padding:16px;max-width:640px;margin:0 auto;}
    .pg h1{font-size:17px;font-weight:700;color:#94a3b8;margin:0 0 12px;letter-spacing:.04em;text-transform:uppercase;}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}
    .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;text-decoration:none;color:inherit;display:block;}
    .card-title{font-size:12px;font-weight:600;color:#93c5fd;margin-bottom:8px;}
    .card-val{font-size:18px;font-weight:800;}
    .card-sub{font-size:11px;color:#64748b;margin-top:4px;}
    .s2-card{grid-column:1/-1;}
    .s2-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:8px;}
    .s2-stat{background:#0f172a;border-radius:8px;padding:8px 10px;}
    .s2-stat .lbl{font-size:11px;color:#64748b;}
    .s2-stat .val{font-size:15px;font-weight:700;margin-top:2px;}
    .footer{font-size:11px;color:#334155;text-align:center;margin-top:16px;}
  `;

  const body = `<div class="pg">
    <h1>System Status</h1>
    <div class="grid">
      <a href="/s2" class="card s2-card">
        <div class="card-title">S2 — Signal Bot</div>
        <div class="s2-row">
          <div class="s2-stat"><div class="lbl">Total balance</div><div class="val">${totalBalStr}${upnlStr ? ` <span style="font-size:12px;color:#64748b;">${upnlStr}</span>` : ''}</div></div>
          <div class="s2-stat"><div class="lbl">Bots enabled</div><div class="val">${totals.enabled || 0}/${totals.bots || 0}</div></div>
          <div class="s2-stat"><div class="lbl">In trade</div><div class="val">${totals.inTrade || 0}</div></div>
          <div class="s2-stat"><div class="lbl">MDX renewal</div><div class="val" style="color:${mdxColor};">${mdxVal}</div></div>
          <div class="s2-stat" style="grid-column:1/-1;"><div class="lbl">Last signal</div><div class="val" style="font-size:12px;font-weight:600;">${lastSignalStr}</div></div>
        </div>
      </a>
      <a href="/s4" class="card">
        <div class="card-title">S4 — Signal Scout</div>
        <div class="card-val" style="color:#334155;">–</div>
        <div class="card-sub">Not yet integrated</div>
      </a>
      <a href="/s6" class="card">
        <div class="card-title">S6 — Signal Scout</div>
        <div class="card-val">${s6QueueCount != null ? s6QueueCount : '–'}</div>
        <div class="card-sub">${s6QueueCount != null ? 'signals in queue' : 'unavailable'}</div>
      </a>
    </div>
    <div class="footer">Auto-refresh 30s · ${now}</div>
  </div>`;

  return pageShell('', 'Q Portal', CSS, body, '<meta http-equiv="refresh" content="30">');
}

// ─── S2 page ──────────────────────────────────────────────────────────────────

function fmtAge(minutes) {
  if (minutes === null || minutes === undefined) return 'n/a';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function fmtPrice(val) {
  if (!Number.isFinite(val)) return '–';
  if (val >= 1000) return val.toFixed(2);
  if (val >= 10) return val.toFixed(4);
  if (val >= 0.01) return val.toFixed(5);
  return val.toFixed(6);
}

function fmtPnl(val, suffix = ' USDT') {
  if (!Number.isFinite(val)) return '–';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}${suffix}`;
}

function renderMdxPanel(mdx, reviewCriteria) {
  if (!mdx || mdx.renewalDate === null) {
    return `<div class="mdx-panel mdx-neutral">
      <div class="mdx-label">MDX Renewal</div>
      <div class="mdx-days" style="font-size:18px;color:#64748b;">No date set</div>
      <div class="mdx-note">Set MDX_RENEWAL_DATE env var on EC2</div>
    </div>`;
  }

  const colorMap = { green: '#86efac', amber: '#fcd34d', red: '#fca5a5', neutral: '#94a3b8' };
  const color = colorMap[mdx.color] || colorMap.neutral;

  const criteriaHtml = reviewCriteria.length ? `
    <div class="mdx-criteria">
      ${reviewCriteria.map(c => `
        <div class="mdx-criterion">
          <span class="mdx-criterion-icon">${c.pass ? '✅' : '❌'}</span>
          <div class="mdx-criterion-body">
            <div class="mdx-criterion-label">${c.label}</div>
            <div class="mdx-criterion-detail">${c.detail}</div>
          </div>
        </div>`).join('')}
    </div>` : '';

  return `<div class="mdx-panel">
    <div class="mdx-header">
      <div>
        <div class="mdx-label">MDX Renewal</div>
        <div class="mdx-date">${mdx.renewalDate}</div>
      </div>
      <div class="mdx-days" style="color:${color};">${mdx.daysRemaining}d</div>
    </div>
    ${criteriaHtml}
    <div class="mdx-note">65% sizing requires native Bybit SL to be implemented first</div>
  </div>`;
}

function renderServiceHealthPanel(serviceHealth) {
  if (!serviceHealth) return '';
  const active = v => v === 'active'
    ? '<span style="color:#86efac;">active</span>'
    : `<span style="color:#fca5a5;">${v || 'unknown'}</span>`;
  const rows = [
    ['Webhook', active(serviceHealth.webhookService)],
    ['Tunnel', active(serviceHealth.tunnelService)],
    ['DB', serviceHealth.dbConnected
      ? `<span style="color:#86efac;">ok</span> · ${serviceHealth.exitEventCount ?? '?'} exits`
      : '<span style="color:#fca5a5;">error</span>'],
    ['Mgmt loop last fired', serviceHealth.managementLoopLastAt
      ? `${fmtAge(serviceHealth.managementLoopAgeMinutes)} <span style="color:#475569;">(${serviceHealth.managementLoopLastAt.slice(0, 19).replace('T', ' ')} UTC)</span>`
      : '<span style="color:#475569;">n/a</span>'],
  ];
  return `<div class="health-strip">
    ${rows.map(([k, v]) => `<div class="health-row"><span class="health-key">${k}</span><span class="health-val">${v}</span></div>`).join('')}
  </div>`;
}


// ─── Paper & equity data helpers ─────────────────────────────────────────────

function loadPaperPortfolio(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const P1_BASE = Number(process.env.PAPER_BASELINE_USDT  || 2756.68);
    const P2_BASE    = Number(process.env.PAPER2_BASELINE_USDT || 2756.68);
    const QPOOL_BASE = Number(process.env.QPOOL_BASELINE_USDT || 1000);

    const p1sum = db.prepare(
      "SELECT COALESCE(SUM(exit_pnl_usd),0) AS total FROM paper_positions WHERE paper_bot_id LIKE 'P_Bot%' AND status='closed'"
    ).get();
    const p2sum = db.prepare(
      "SELECT COALESCE(SUM(exit_pnl_usd),0) AS total FROM paper_positions WHERE paper_bot_id LIKE 'P2_Bot%' AND status='closed'"
    ).get();
    const qpsum = db.prepare(
      "SELECT COALESCE(SUM(exit_pnl_usd),0) AS total FROM paper_positions WHERE paper_bot_id LIKE 'QPool_Bot%' AND status='closed' AND created_at >= '2026-05-07T00:00:00.000Z'"
    ).get();

    db.close();
    return {
      p1:    { start: P1_BASE,    current: P1_BASE    + (p1sum.total || 0), pnl: p1sum.total || 0 },
      p2:    { start: P2_BASE,    current: P2_BASE    + (p2sum.total || 0), pnl: p2sum.total || 0 },
      qpool: { start: QPOOL_BASE, current: QPOOL_BASE + (qpsum.total || 0), pnl: qpsum.total || 0 },
    };
  } catch(e) {
    return { p1: null, p2: null, error: e.message };
  }
}

function loadEquityData(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const SYSTEM_START_MS = new Date('2026-05-08T00:00:00.000Z').getTime();
    const LIVE_BASE  = Number(process.env.PORTFOLIO_BASELINE_USDT || 2799.94) / 8;
    const PAPER_BASE = Number(process.env.PAPER_BASELINE_USDT  || 2756.68) / 8;
    const P2_BASE    = Number(process.env.PAPER2_BASELINE_USDT || 2756.68) / 8;
    const QPOOL_BASE = Number(process.env.QPOOL_BASELINE_USDT || 1000);

    const entries = db.prepare(`
      SELECT id, bot_id, symbol, signal, notional_usd, qty, created_at
      FROM order_attempts
      WHERE signal LIKE 'ENTER%' AND signal NOT LIKE '%DCA_ADD%'
        AND signal NOT LIKE '%CLOSE_FIRST%'
        AND created_at >= '2026-05-08T00:00:00.000Z'
      ORDER BY id ASC`).all();

    const dcaRows = db.prepare(`
      SELECT bot_id, symbol, notional_usd, created_at FROM order_attempts
      WHERE signal LIKE '%DCA_ADD%' AND created_at >= '2026-05-08T00:00:00.000Z'
      ORDER BY id ASC`).all();

    const exitRows = db.prepare(`
      SELECT bot_id, symbol, exit_reason, trigger_percent, close_percent, mark_price, created_at
      FROM exit_events WHERE created_at >= '2026-04-24T19:09:00.000Z'
      ORDER BY id ASC`).all();

    const LIVE_BOTS = ['Bot1','Bot2','Bot3','Bot4','Bot5','Bot6','Bot7','Bot8'];
    const liveEquity = {}, liveCum = {};
    LIVE_BOTS.forEach(b => { liveEquity[b] = [{ d: 0, p: 0 }]; liveCum[b] = 0; });

    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      const botId = en.bot_id; const sym = en.symbol;
      const isLong = en.signal.includes('LONG');
      const qty = parseFloat(en.qty) || 0;
      const ep = qty > 0 ? en.notional_usd / qty : 0;
      const next = entries.slice(i + 1).find(e => e.bot_id === botId && e.symbol === sym);
      const cutoff = next ? next.created_at : null;
      const dca = dcaRows.filter(e => e.bot_id === botId && e.symbol === sym &&
        e.created_at > en.created_at && (!cutoff || e.created_at <= cutoff));
      const exs = exitRows.filter(e => e.bot_id === botId && e.symbol === sym &&
        e.created_at > en.created_at && (!cutoff || e.created_at <= cutoff));
      let notional = en.notional_usd;
      dca.forEach(d => { notional += d.notional_usd; });
      let pnl = 0, rem = 1.0, closed = false, exitAt = null;
      for (const ex of exs) {
        const cf = ex.close_percent / 100; const sf = cf * rem; const sn = notional * sf;
        let slice;
        if (ex.exit_reason === 'take_profit') slice = (ex.trigger_percent / 100) * sn;
        else if (ex.exit_reason === 'stop_loss') slice = -(ex.trigger_percent / 100) * sn;
        else { const mv = isLong ? (ex.mark_price - ep) / ep : (ep - ex.mark_price) / ep; slice = mv * sn; }
        pnl += slice; rem -= sf; exitAt = ex.created_at;
        if (ex.close_percent >= 100 || rem <= 0.001) { closed = true; break; }
      }
      if (!closed || !liveEquity[botId] || !exitAt) continue;
      liveCum[botId] += pnl;
      const day = Math.round((new Date(exitAt).getTime() - SYSTEM_START_MS) / 864e5 * 100) / 100;
      liveEquity[botId].push({ d: day, p: Math.round(liveCum[botId] / LIVE_BASE * 10000) / 100 });
    }

    const p1Rows = db.prepare(`
      SELECT paper_bot_id, exit_pnl_usd, closed_at FROM paper_positions
      WHERE paper_bot_id LIKE 'P_Bot%' AND status='closed' ORDER BY closed_at ASC`).all();
    const p1Equity = {}, p1Cum = {};
    ['P_Bot1','P_Bot2','P_Bot3','P_Bot4','P_Bot5','P_Bot6','P_Bot7','P_Bot8']
      .forEach(b => { p1Equity[b] = [{ d: 0, p: 0 }]; p1Cum[b] = 0; });
    for (const pos of p1Rows) {
      if (!p1Equity[pos.paper_bot_id]) continue;
      p1Cum[pos.paper_bot_id] += Number(pos.exit_pnl_usd) || 0;
      const day = Math.round((new Date(pos.closed_at).getTime() - SYSTEM_START_MS) / 864e5 * 100) / 100;
      p1Equity[pos.paper_bot_id].push({ d: day, p: Math.round(p1Cum[pos.paper_bot_id] / PAPER_BASE * 10000) / 100 });
    }

    const p2Rows = db.prepare(`
      SELECT paper_bot_id, exit_pnl_usd, closed_at FROM paper_positions
      WHERE paper_bot_id LIKE 'P2_Bot%' AND status='closed' ORDER BY closed_at ASC`).all();
    const p2Equity = {}, p2Cum = {};
    ['P2_Bot1','P2_Bot2','P2_Bot3','P2_Bot4','P2_Bot5','P2_Bot6','P2_Bot7','P2_Bot8']
      .forEach(b => { p2Equity[b] = [{ d: 0, p: 0 }]; p2Cum[b] = 0; });
    for (const pos of p2Rows) {
      if (!p2Equity[pos.paper_bot_id]) continue;
      p2Cum[pos.paper_bot_id] += Number(pos.exit_pnl_usd) || 0;
      const day = Math.round((new Date(pos.closed_at).getTime() - SYSTEM_START_MS) / 864e5 * 100) / 100;
      p2Equity[pos.paper_bot_id].push({ d: day, p: Math.round(p2Cum[pos.paper_bot_id] / P2_BASE * 10000) / 100 });
    }

    db.close();
    return { live: liveEquity, p1: p1Equity, p2: p2Equity };
  } catch(e) { return { error: e.message }; }
}

function loadEquityDataToday(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const todayStartMs = new Date('2026-05-08T00:00:00.000Z').getTime();
    const todayStartIso = '2026-05-08T00:00:00.000Z';

    const LIVE_BASE  = Number(process.env.PORTFOLIO_BASELINE_USDT || 2799.94) / 8;
    const PAPER_BASE = Number(process.env.PAPER_BASELINE_USDT  || 2756.68) / 8;
    const P2_BASE    = Number(process.env.PAPER2_BASELINE_USDT || 2756.68) / 8;

    const entries = db.prepare(`
      SELECT id, bot_id, symbol, signal, notional_usd, qty, created_at
      FROM order_attempts
      WHERE signal LIKE 'ENTER%' AND signal NOT LIKE '%DCA_ADD%'
        AND signal NOT LIKE '%CLOSE_FIRST%'
        AND created_at >= '2026-05-08T00:00:00.000Z'
      ORDER BY id ASC`).all();

    const dcaRows = db.prepare(`
      SELECT bot_id, symbol, notional_usd, created_at FROM order_attempts
      WHERE signal LIKE '%DCA_ADD%' AND created_at >= '2026-05-08T00:00:00.000Z'
      ORDER BY id ASC`).all();

    const exitRows = db.prepare(`
      SELECT bot_id, symbol, exit_reason, trigger_percent, close_percent, mark_price, created_at
      FROM exit_events WHERE created_at >= ? ORDER BY id ASC`).all(todayStartIso);

    const LIVE_BOTS = ['Bot1','Bot2','Bot3','Bot4','Bot5','Bot6','Bot7','Bot8'];
    const liveEquity = {}, liveCum = {};
    LIVE_BOTS.forEach(b => { liveEquity[b] = [{ d: 0, p: 0 }]; liveCum[b] = 0; });

    for (let i = 0; i < entries.length; i++) {
      const en = entries[i];
      const botId = en.bot_id; const sym = en.symbol;
      const isLong = en.signal.includes('LONG');
      const qty = parseFloat(en.qty) || 0;
      const ep = qty > 0 ? en.notional_usd / qty : 0;
      const next = entries.slice(i + 1).find(e => e.bot_id === botId && e.symbol === sym);
      const cutoff = next ? next.created_at : null;
      const dca = dcaRows.filter(e => e.bot_id === botId && e.symbol === sym &&
        e.created_at > en.created_at && (!cutoff || e.created_at <= cutoff));
      const exs = exitRows.filter(e => e.bot_id === botId && e.symbol === sym &&
        e.created_at > en.created_at && (!cutoff || e.created_at <= cutoff));
      let notional = en.notional_usd;
      dca.forEach(d => { notional += d.notional_usd; });
      let pnl = 0, rem = 1.0, closed = false, exitAt = null;
      for (const ex of exs) {
        const cf = ex.close_percent / 100; const sf = cf * rem; const sn = notional * sf;
        let slice;
        if (ex.exit_reason === 'take_profit') slice = (ex.trigger_percent / 100) * sn;
        else if (ex.exit_reason === 'stop_loss') slice = -(ex.trigger_percent / 100) * sn;
        else { const mv = isLong ? (ex.mark_price - ep) / ep : (ep - ex.mark_price) / ep; slice = mv * sn; }
        pnl += slice; rem -= sf; exitAt = ex.created_at;
        if (ex.close_percent >= 100 || rem <= 0.001) { closed = true; break; }
      }
      if (!closed || !liveEquity[botId] || !exitAt) continue;
      liveCum[botId] += pnl;
      const hr = Math.round((new Date(exitAt).getTime() - todayStartMs) / 36e5 * 100) / 100;
      liveEquity[botId].push({ d: hr, p: Math.round(liveCum[botId] / LIVE_BASE * 10000) / 100 });
    }

    const p1Rows = db.prepare(`
      SELECT paper_bot_id, exit_pnl_usd, closed_at FROM paper_positions
      WHERE paper_bot_id LIKE 'P_Bot%' AND status='closed' AND closed_at >= ?
      ORDER BY closed_at ASC`).all(todayStartIso);
    const p1Equity = {}, p1Cum = {};
    ['P_Bot1','P_Bot2','P_Bot3','P_Bot4','P_Bot5','P_Bot6','P_Bot7','P_Bot8']
      .forEach(b => { p1Equity[b] = [{ d: 0, p: 0 }]; p1Cum[b] = 0; });
    for (const pos of p1Rows) {
      if (!p1Equity[pos.paper_bot_id]) continue;
      p1Cum[pos.paper_bot_id] += Number(pos.exit_pnl_usd) || 0;
      const hr = Math.round((new Date(pos.closed_at).getTime() - todayStartMs) / 36e5 * 100) / 100;
      p1Equity[pos.paper_bot_id].push({ d: hr, p: Math.round(p1Cum[pos.paper_bot_id] / PAPER_BASE * 10000) / 100 });
    }

    const p2Rows = db.prepare(`
      SELECT paper_bot_id, exit_pnl_usd, closed_at FROM paper_positions
      WHERE paper_bot_id LIKE 'P2_Bot%' AND status='closed' AND closed_at >= ?
      ORDER BY closed_at ASC`).all(todayStartIso);
    const p2Equity = {}, p2Cum = {};
    ['P2_Bot1','P2_Bot2','P2_Bot3','P2_Bot4','P2_Bot5','P2_Bot6','P2_Bot7','P2_Bot8']
      .forEach(b => { p2Equity[b] = [{ d: 0, p: 0 }]; p2Cum[b] = 0; });
    for (const pos of p2Rows) {
      if (!p2Equity[pos.paper_bot_id]) continue;
      p2Cum[pos.paper_bot_id] += Number(pos.exit_pnl_usd) || 0;
      const hr = Math.round((new Date(pos.closed_at).getTime() - todayStartMs) / 36e5 * 100) / 100;
      p2Equity[pos.paper_bot_id].push({ d: hr, p: Math.round(p2Cum[pos.paper_bot_id] / P2_BASE * 10000) / 100 });
    }

    db.close();
    return { live: liveEquity, p1: p1Equity, p2: p2Equity };
  } catch(e) { return { error: e.message }; }
}


function loadCapitalPoolData(dbPath) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const botEvents = db.prepare(`
      SELECT cpe.* FROM capital_pool_events cpe
      INNER JOIN (SELECT bot_id, MAX(id) AS max_id FROM capital_pool_events GROUP BY bot_id) latest
        ON cpe.id = latest.max_id
      ORDER BY cpe.bot_id ASC`).all();
    const newest = db.prepare('SELECT * FROM capital_pool_events ORDER BY id DESC LIMIT 1').get();
    const openP2 = db.prepare(
      "SELECT paper_bot_id, symbol, notional_usd, side FROM paper_positions WHERE paper_bot_id LIKE 'P2_Bot%' AND status='open'"
    ).all();

    // QPool equity curve (single combined line, % vs $1000 baseline, from 7 May 2026)
    const QPOOL_ACT = '2026-05-07T00:00:00.000Z';
    const qpoolClosed = db.prepare(
      "SELECT paper_bot_id, closed_at, exit_pnl_usd FROM paper_positions WHERE paper_bot_id LIKE 'QPool_Bot%' AND status='closed' AND created_at >= ? ORDER BY closed_at ASC"
    ).all(QPOOL_ACT);
    let qpoolCum = 0;
    const qpoolEquity = [{ d: QPOOL_ACT.slice(0, 10), p: 0 }];
    for (const pos of qpoolClosed) {
      qpoolCum += (pos.exit_pnl_usd || 0);
      const day = (pos.closed_at || '').slice(0, 10);
      qpoolEquity.push({ d: day, p: Math.round(qpoolCum / QPOOL_BASE * 10000) / 100 });
    }

    const openQPool = db.prepare(
      "SELECT paper_bot_id, symbol, notional_usd, side FROM paper_positions WHERE paper_bot_id LIKE 'QPool_Bot%' AND status='open'"
    ).all();
    db.close();
    return { botEvents, newest, openP2, qpoolEquity, openQPool };
  } catch(e) { return { error: e.message }; }
}

function renderCapitalPoolPanel(cpData) {
  if (!cpData || cpData.error || !cpData.newest) return '';
  const { botEvents, newest, openP2, qpoolEquity, openQPool } = cpData;

  const totalPot = newest.total_pot || 0;
  const reserved = newest.reserved_capital || 0;
  const available = newest.available_dynamic || 0;
  const deployed = openP2.reduce((s, p) => s + (p.notional_usd || 0), 0);

  const p2OpenMap = {};
  openP2.forEach(p => {
    const num = p.paper_bot_id.replace('P2_Bot', '');
    p2OpenMap['Bot' + num] = p;
  });

  const eventMap = {};
  botEvents.forEach(e => { eventMap[e.bot_id] = e; });

  const usedPct = totalPot > 0 ? Math.round(deployed / totalPot * 1000) / 10 : 0;
  const availPct = totalPot > 0 ? Math.round(available / totalPot * 1000) / 10 : 0;

  const summaryHtml = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
    <div style="background:#0f172a;border-radius:8px;padding:8px 10px;text-align:center;"><div style="font-size:10px;color:#64748b;margin-bottom:2px;">Total Pool</div><div style="font-size:15px;font-weight:800;">${totalPot.toFixed(0)}</div><div style="font-size:10px;color:#475569;">USDT</div></div>
    <div style="background:#0f172a;border-radius:8px;padding:8px 10px;text-align:center;"><div style="font-size:10px;color:#64748b;margin-bottom:2px;">Reserved 40%</div><div style="font-size:15px;font-weight:800;">${reserved.toFixed(0)}</div><div style="font-size:10px;color:#475569;">USDT</div></div>
    <div style="background:#0f172a;border-radius:8px;padding:8px 10px;text-align:center;"><div style="font-size:10px;color:#64748b;margin-bottom:2px;">Available</div><div style="font-size:15px;font-weight:800;color:#86efac;">${available.toFixed(0)}</div><div style="font-size:10px;color:#475569;">${availPct}%</div></div>
    <div style="background:#0f172a;border-radius:8px;padding:8px 10px;text-align:center;"><div style="font-size:10px;color:#64748b;margin-bottom:2px;">Deployed</div><div style="font-size:15px;font-weight:800;color:#f59e0b;">${deployed.toFixed(0)}</div><div style="font-size:10px;color:#475569;">${usedPct}%</div></div>
  </div>`;

  const BOT_ORDER = ['Bot1','Bot2','Bot3','Bot4','Bot5','Bot6','Bot7','Bot8'];
  const TIER_COLORS = { HIGH: '#86efac', MED: '#fcd34d', LOW: '#94a3b8', BLOCK: '#fca5a5' };

  const rows = BOT_ORDER.map(botId => {
    const ev = eventMap[botId];
    const openPos = p2OpenMap[botId];
    const blocked = ev && ev.signal_type === 'BLOCKED';
    const hasOpen = !!openPos;

    let statusColor, statusText;
    if (blocked) {
      statusColor = '#fca5a5';
      statusText = `BLOCKED — ${ev.block_reason || 'unknown'}`;
    } else if (hasOpen) {
      statusColor = '#f59e0b';
      const dir = openPos.side === 'Buy' ? 'LONG' : 'SHORT';
      statusText = `DEPLOYED — ${openPos.symbol} ${dir} $${openPos.notional_usd.toFixed(0)}`;
    } else if (ev) {
      statusColor = '#86efac';
      statusText = 'IDLE';
    } else {
      statusColor = '#475569';
      statusText = 'No events';
    }

    const tierColor = ev ? (TIER_COLORS[ev.score_tier] || '#94a3b8') : '#475569';

    const scoreInfo = ev
      ? `<span style="color:${tierColor};font-weight:600;">${ev.score_tier}</span> · V2:${ev.v2_score} V1:${ev.v1_score} · ${ev.symbol}`
      : '';

    const allocInfo = ev && !blocked && ev.notional_allocated > 0
      ? `<span style="color:#64748b;">Base ${ev.base_allocation.toFixed(0)}</span> <span style="color:#f59e0b;">+Dyn ${ev.dynamic_allocation.toFixed(0)}</span> <span style="color:#94a3b8;">= ${ev.notional_allocated.toFixed(0)}</span>`
      : '';

    return `<div style="display:grid;grid-template-columns:52px 1fr auto;align-items:start;gap:8px;padding:8px 0;border-bottom:1px solid #1e293b;">
      <div style="font-size:13px;font-weight:700;padding-top:1px;">${botId}</div>
      <div>
        <div style="font-size:12px;font-weight:600;color:${statusColor};">${statusText}</div>
        ${scoreInfo ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${scoreInfo}</div>` : ''}
      </div>
      <div style="font-size:10px;text-align:right;white-space:nowrap;padding-top:1px;">${allocInfo}</div>
    </div>`;
  }).join('');

  return `<div style="margin-top:12px;padding:12px;background:#111827;border:1px solid #1f2937;border-radius:12px;">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Capital Pool Distribution</div>
    ${summaryHtml}
    <div>${rows}</div>
  </div>`;
}

function renderBotCard(bot) {
  const enabled = bot.enabled ? 'Enabled' : 'Disabled';
  const balance = bot.balanceStatus === 'ok' && Number.isFinite(bot.balance)
    ? `${bot.balance.toFixed(2)} USDT`
    : 'Balance unavailable';
  const stateClass = (bot.tradeState === 'Long' || bot.tradeState === 'Short') ? 'trade-live' : 'trade-flat';
  const enabledClass = bot.enabled ? '' : ' bot-disabled';
  const profileStr = bot.mdxProfile
    ? `${bot.mdxProfile.charAt(0).toUpperCase() + bot.mdxProfile.slice(1)}${bot.leverage ? ` · ${bot.leverage}x` : ''}`
    : '';
  const pausedBadge = !bot.enabled
    ? `<span style="background:#92400e22;color:#f59e0b;font-size:11px;font-weight:800;padding:2px 8px;border-radius:4px;letter-spacing:.04em;border:1px solid #92400e55;">PAUSED</span>`
    : '';

  // Signal analysis badge (S6 directive)
  const sa = bot.signalAnalysis;
  let analysisBadgeHtml = '';
  if (sa) {
    const dColors = { TRADE: '#86efac', WAIT: '#fcd34d', AVOID: '#fca5a5', MONITOR: '#93c5fd' };
    const dColor = dColors[sa.s6_directive] || '#94a3b8';
    const convStr = sa.conviction_score ? `${sa.conviction_score}/5` : '';
    analysisBadgeHtml = `<div class="pos-row" style="margin-top:5px;padding-top:5px;border-top:1px solid #1e293b;">
      <span class="pos-key">S6</span>
      <span style="display:flex;align-items:center;gap:6px;">
        <span style="background:${dColor}22;color:${dColor};font-size:11px;font-weight:800;padding:2px 7px;border-radius:4px;letter-spacing:.03em;">${sa.s6_directive || '?'}</span>
        ${convStr ? `<span style="color:#64748b;font-size:11px;">${convStr}</span>` : ''}
      </span>
    </div>`;
  }

  // Open position section
  let positionHtml = '';
  if (bot.tradeState === 'Long' || bot.tradeState === 'Short') {
    const upnlColor = Number.isFinite(bot.unrealizedPnl) && bot.unrealizedPnl >= 0 ? '#86efac' : '#fca5a5';
    positionHtml = `<div class="bot-position">
      ${bot.positionNotional ? `<div class="pos-row"><span class="pos-key">Notional</span><span>$${bot.positionNotional.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>` : ''}
      ${bot.positionMargin ? `<div class="pos-row"><span class="pos-key">Margin</span><span>$${bot.positionMargin.toFixed(2)}</span></div>` : ''}
      ${bot.positionLeverage ? `<div class="pos-row"><span class="pos-key">Leverage</span><span>${bot.positionLeverage}x</span></div>` : ''}
      ${bot.positionSizePct ? `<div class="pos-row"><span class="pos-key">Size</span><span>${bot.positionSizePct.toFixed(1)}% of acct</span></div>` : ''}
      ${Number.isFinite(bot.avgEntryPrice) ? `<div class="pos-row"><span class="pos-key">Entry</span><span>${fmtPrice(bot.avgEntryPrice)}</span></div>` : ''}
      ${Number.isFinite(bot.markPrice) ? `<div class="pos-row"><span class="pos-key">Mark</span><span>${fmtPrice(bot.markPrice)}</span></div>` : ''}
      ${Number.isFinite(bot.unrealizedPnl) ? `<div class="pos-row"><span class="pos-key">uPnL</span><span style="color:${upnlColor};font-weight:700;">${fmtPnl(bot.unrealizedPnl)}</span></div>` : ''}
      ${(bot.remainingQtyPct !== null && bot.remainingQtyPct !== undefined) ? `<div class="pos-row"><span class="pos-key">Rem. qty</span><span>${bot.remainingQtyPct.toFixed(0)}%</span></div>` : ''}
      ${analysisBadgeHtml}
      ${(() => {
        const tbs = bot.tpBeState;
        if (!tbs || !tbs.levels || !tbs.levels.length) return '';
        const rows = tbs.levels.map(l => {
          const cls = l.fired ? 'tp-fired' : 'tp-pending';
          const dot = l.fired ? '✓' : '○';
          return `<div class="tp-row ${cls}"><span class="tp-lbl">TP${l.index}</span><span class="tp-trigger">${l.triggerPercent}%</span><span class="tp-alloc">\xd7${l.closePercent}%</span><span class="tp-dot">${dot}</span></div>`;
        }).join('');
        const beTrigger = tbs.beTrigger !== null ? `${tbs.beTrigger}%` : '–';
        const beCls = tbs.beFired ? 'tp-be-fired' : tbs.beArmed ? 'tp-be-armed' : 'tp-pending';
        const beDot = tbs.beFired ? '✗' : tbs.beArmed ? '●' : '○';
        const slTrigger = bot.slTrigger !== null && bot.slTrigger !== undefined ? `${bot.slTrigger}%` : null;
        const slRow = slTrigger ? `<div class="tp-row tp-sl"><span class="tp-lbl">SL</span><span class="tp-trigger">${slTrigger}</span><span class="tp-alloc"></span><span class="tp-dot">▼</span></div>` : '';
        return `<div class="tp-ladder">${rows}<div class="tp-row ${beCls}"><span class="tp-lbl">BE</span><span class="tp-trigger">${beTrigger}</span><span class="tp-alloc"></span><span class="tp-dot">${beDot}</span></div>${slRow}</div>`;
      })()}
    </div>`;
  }

  // Trade stats
  const ts = bot.tradeStats;
  let statsHtml = '';
  if (ts) {
    const at = ts.allTime;
    const todayS = ts.today;
    const sevenS = ts.sevenDay;
    const wrStr = at && at.winRate !== null ? `${(at.winRate * 100).toFixed(0)}%` : '–';
    const todayPnl = todayS && todayS.count > 0 ? fmtPnl(todayS.approxPnl) : '–';
    const sevenPnl = sevenS && sevenS.count > 0 ? fmtPnl(sevenS.approxPnl) : '–';
    const allPnl = at && at.count > 0 ? fmtPnl(at.approxPnl) : '–';

    statsHtml = `<div class="bot-stats">
      <div class="stats-row">
        <span class="stats-key">Trades (all)</span>
        <span>${at ? `${at.count} · ${wrStr} WR · ${at.wins}W/${at.losses}L` : '–'}</span>
      </div>
      <div class="stats-row">
        <span class="stats-key">Est. P&amp;L today / 7d / all</span>
        <span>${todayPnl} / ${sevenPnl} / ${allPnl}</span>
      </div>
      ${ts.lastSignal ? `<div class="stats-row"><span class="stats-key">Last signal</span><span>${ts.lastSignal.signal} · ${fmtAge(ts.lastSignal.ageMinutes)}</span></div>` : ''}
      ${ts.lastOrder ? `<div class="stats-row"><span class="stats-key">Last order</span><span>${ts.lastOrder.status} · ${fmtAge(ts.lastOrder.ageMinutes)}</span></div>` : ''}
    </div>`;
  }

  // Paper positions section
  let paperHtml = '';
  if (bot.paperPositions && bot.paperPositions.length > 0) {
    paperHtml = bot.paperPositions.map(pp => {
      const ppUpnlColor = Number.isFinite(pp.unrealizedPnl) && pp.unrealizedPnl >= 0 ? '#86efac' : '#fca5a5';
      const ppLabel = pp.paperBotId && pp.paperBotId.startsWith('P2_') ? 'P2 (scored)' : 'Paper';
      return `<div class="bot-position" style="margin-top:4px;border-left:2px solid #1e40af;">
        <div class="pos-row" style="margin-bottom:3px;"><span class="pos-key" style="color:#93c5fd;font-size:11px;">${ppLabel} · ${pp.side === 'Buy' ? 'LONG' : 'SHORT'}</span></div>
        ${pp.notional ? `<div class="pos-row"><span class="pos-key">Notional</span><span>$${pp.notional.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>` : ''}
        ${pp.margin ? `<div class="pos-row"><span class="pos-key">Margin</span><span>$${pp.margin.toFixed(2)}</span></div>` : ''}
        ${pp.leverage ? `<div class="pos-row"><span class="pos-key">Leverage</span><span>${pp.leverage}x</span></div>` : ''}
        ${Number.isFinite(pp.entryPrice) ? `<div class="pos-row"><span class="pos-key">Entry</span><span>${fmtPrice(pp.entryPrice)}</span></div>` : ''}
        ${Number.isFinite(pp.markPrice) ? `<div class="pos-row"><span class="pos-key">Mark</span><span>${fmtPrice(pp.markPrice)}</span></div>` : ''}
        ${Number.isFinite(pp.unrealizedPnl) ? `<div class="pos-row"><span class="pos-key">uPnL</span><span style="color:${ppUpnlColor};font-weight:700;">${fmtPnl(pp.unrealizedPnl)}</span></div>` : ''}
        ${pp.remainingQtyPct !== null ? `<div class="pos-row"><span class="pos-key">Rem. qty</span><span>${Number(pp.remainingQtyPct).toFixed(0)}%</span></div>` : ''}
      </div>`;
    }).join('');
  }

  return `<div class="bot-card${enabledClass}">
    <div class="bot-top">
      <div class="bot-name">${bot.botId}</div>
      ${pausedBadge}
      <div class="bot-state ${stateClass}">${bot.tradeState}</div>
    </div>
    <div class="bot-meta">${enabled} · ${bot.symbol || 'n/a'}</div>
    ${profileStr ? `<div class="bot-profile">${profileStr}</div>` : ''}
    <div class="bot-balance">${balance}</div>
    ${positionHtml}
    ${paperHtml}
    ${statsHtml}
  </div>`;
}

function renderS2Page(status, paperPortfolio, cpData) {
  const totals = status.totals || {};
  const bots = Array.isArray(status.bots) ? status.bots : [];
  const heartbeat = status.heartbeat || {};
  const activity = status.activity || {};

  const mdxPanel = renderMdxPanel(status.mdx || null, status.reviewCriteria || []);
  const healthPanel = renderServiceHealthPanel(status.serviceHealth || null);
  const botCards = bots.map(renderBotCard).join('\n');
  const pp = paperPortfolio || {};
  const cpPanel = renderCapitalPoolPanel(cpData || null);

  const CSS = `
    .wrap{padding:12px;max-width:480px;margin:0 auto;}
    /* MDX Panel */
    .mdx-panel{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;margin-bottom:10px;}
    .mdx-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
    .mdx-label{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em;}
    .mdx-date{font-size:13px;color:#94a3b8;margin-top:2px;}
    .mdx-days{font-size:40px;font-weight:900;line-height:1;}
    .mdx-criteria{display:grid;gap:6px;margin-bottom:10px;}
    .mdx-criterion{display:flex;gap:8px;align-items:flex-start;}
    .mdx-criterion-icon{font-size:14px;flex-shrink:0;margin-top:1px;}
    .mdx-criterion-label{font-size:13px;font-weight:600;}
    .mdx-criterion-detail{font-size:11px;color:#64748b;margin-top:1px;}
    .mdx-note{font-size:11px;color:#475569;margin-top:6px;padding-top:8px;border-top:1px solid #1e293b;}
    /* Health strip */
    .health-strip{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;margin-bottom:10px;display:grid;gap:5px;}
    .health-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;}
    .health-key{color:#64748b;flex-shrink:0;}
    .health-val{text-align:right;}
    /* Summary cards */
    .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;}
    .summary-card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px;text-align:center;}
    .summary-card .lbl{font-size:12px;opacity:.8;}
    .summary-card .val{font-size:20px;font-weight:700;margin-top:2px;}
    /* Heartbeat & activity */
    .heartbeat{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;margin-bottom:10px;}
    .heartbeat .lbl{font-size:12px;opacity:.8;}
    .heartbeat .val{font-size:15px;font-weight:700;margin-top:3px;}
    .heartbeat .sub{font-size:12px;margin-top:4px;color:#93c5fd;}
    .activity{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;margin-bottom:10px;display:grid;gap:10px;}
    .activity-row .lbl{font-size:12px;opacity:.8;}
    .activity-row .val{font-size:14px;font-weight:700;margin-top:3px;}
    .activity-row .sub{font-size:12px;margin-top:4px;color:#93c5fd;}
    /* Bot cards */
    .bot-list{display:flex;flex-direction:column;gap:8px;}
    .bot-card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;}
    .bot-disabled{opacity:.7;}
    .bot-top{display:flex;justify-content:space-between;align-items:center;gap:8px;}
    .bot-name{font-size:18px;font-weight:700;}
    .bot-state{font-size:13px;font-weight:700;padding:4px 8px;border-radius:999px;}
    .trade-live{background:#14532d;color:#bbf7d0;}
    .trade-flat{background:#1e293b;color:#cbd5e1;}
    .bot-meta{font-size:13px;opacity:.82;margin-top:4px;}
    .bot-profile{font-size:12px;color:#93c5fd;margin-top:3px;}
    .bot-balance{font-size:22px;font-weight:800;margin-top:8px;}
    /* Position detail */
    .bot-position{background:#0f172a;border-radius:8px;padding:8px 10px;margin-top:8px;display:grid;gap:3px;}
    .pos-row{display:flex;justify-content:space-between;font-size:13px;}
    .pos-key{color:#64748b;}
    /* Trade stats */
    .bot-stats{border-top:1px solid #1e293b;margin-top:8px;padding-top:8px;display:grid;gap:4px;}
    .stats-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;}
    .stats-key{color:#64748b;flex-shrink:0;}
    /* TP ladder */
    .tp-ladder{margin-top:8px;padding-top:6px;border-top:1px solid #1e293b;display:grid;gap:2px;}
    .tp-row{display:grid;grid-template-columns:26px 1fr 1fr 16px;align-items:center;font-size:11px;gap:4px;padding:1px 0;}
    .tp-lbl{color:#64748b;font-weight:600;}
    .tp-trigger{color:#64748b;}
    .tp-alloc{color:#334155;text-align:right;}
    .tp-dot{text-align:right;font-size:11px;color:#334155;}
    .tp-fired .tp-lbl{color:#4ade80;}.tp-fired .tp-trigger{color:#4ade80;}.tp-fired .tp-alloc{color:#166534;}.tp-fired .tp-dot{color:#4ade80;}
    .tp-be-armed .tp-lbl{color:#f59e0b;}.tp-be-armed .tp-trigger{color:#f59e0b;}.tp-be-armed .tp-dot{color:#f59e0b;}
    .tp-be-fired .tp-lbl{color:#64748b;text-decoration:line-through;}.tp-be-fired .tp-trigger{color:#64748b;text-decoration:line-through;}
    .tp-sl .tp-lbl{color:#f87171;}.tp-sl .tp-trigger{color:#f87171;}.tp-sl .tp-dot{color:#f87171;}
    /* Misc */
    .generated{font-size:12px;opacity:.6;text-align:center;margin-top:12px;}
    .freshness{font-size:12px;text-align:center;margin-top:6px;color:#93c5fd;}
    /* Trade assessments */
    .ta-section-head{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px;}
    .ta-banner{background:#451a03;border:1px solid #92400e;border-radius:10px;padding:10px 14px;margin-bottom:10px;color:#fcd34d;font-weight:600;font-size:13px;}
    .ta-empty{font-size:13px;color:#475569;padding:8px 0;}
    .ta-list{display:flex;flex-direction:column;gap:8px;}
    .ta-card{background:#0f172a;border:1px solid #1f2937;border-radius:10px;padding:10px 12px;display:grid;gap:5px;}
    .ta-card-open{border-color:#92400e;}
    .ta-card-closed{border-color:#14532d;}
    .ta-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;}
    .ta-title{font-size:13px;font-weight:700;}
    .ta-badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;}
    .ta-open{background:#451a03;color:#fcd34d;}
    .ta-closed{background:#14532d;color:#86efac;}
    .ta-lbl{font-size:10px;color:#93c5fd;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
    .ta-body{font-size:12px;color:#94a3b8;line-height:1.5;white-space:pre-wrap;}
    .ta-meta{font-size:11px;color:#475569;}
    .ta-divider{border:none;border-top:1px solid #1e293b;margin:4px 0;}
  `;

  const body = `<div class="wrap">
    ${mdxPanel}

    <div style="margin-top:14px;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #1e293b;">Strategy Portfolio Summary</div>
      <div style="display:grid;gap:8px;">
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">S2 Live System</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Starting</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${(Number(process.env.PORTFOLIO_BASELINE_USDT||2799.94)).toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Current</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${status.portfolio && status.portfolio.totalBalance > 0 ? status.portfolio.totalBalance.toFixed(0)+' USDT' : '–'}</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">P&L</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:${(status.portfolio&&status.portfolio.totalBalance>0)?((status.portfolio.totalBalance-Number(process.env.PORTFOLIO_BASELINE_USDT||2799.94))>=0?'#86efac':'#fca5a5'):'#94a3b8'};">${status.portfolio&&status.portfolio.totalBalance>0?((status.portfolio.totalBalance-Number(process.env.PORTFOLIO_BASELINE_USDT||2799.94))>=0?'+':'')+((status.portfolio.totalBalance-Number(process.env.PORTFOLIO_BASELINE_USDT||2799.94)).toFixed(0))+' USDT':'–'}</div></div>
          </div>
        </div>
        ${pp.p1 ? `<div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">P1 Mirror (control)</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Starting</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.p1.start.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Current</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.p1.current.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">P&L</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:${pp.p1.pnl>=0?'#86efac':'#fca5a5'};">${pp.p1.pnl>=0?'+':''}${pp.p1.pnl.toFixed(0)} USDT</div></div>
          </div>
        </div>` : ''}
        ${pp.p2 ? `<div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;">
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">P2 Capital Pool</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Starting</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.p2.start.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Current</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.p2.current.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">P&L</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:${pp.p2.pnl>=0?'#86efac':'#fca5a5'};">${pp.p2.pnl>=0?'+':''}${pp.p2.pnl.toFixed(0)} USDT</div></div>
          </div>
        </div>` : ''}
        ${pp.qpool ? `<div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:12px;">
          <div style="font-size:11px;font-weight:700;color:#8b5cf6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Q_Pool · Quality-Gated · 2× (from 7 May 2026)</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Starting</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.qpool.start.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">Current</div><div style="font-size:14px;font-weight:700;margin-top:2px;">${pp.qpool.current.toFixed(0)} USDT</div></div>
            <div style="background:#0f172a;border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:#64748b;">P&L</div><div style="font-size:14px;font-weight:700;margin-top:2px;color:${pp.qpool.pnl>=0?'#86efac':'#fca5a5'};">${pp.qpool.pnl>=0?'+':''}${pp.qpool.pnl.toFixed(2)} USDT</div></div>
          </div>
        </div>` : ''}
      </div>
    </div>
    ${healthPanel}
    <div class="summary">
      <div class="summary-card"><div class="lbl">Bots</div><div class="val">${totals.bots || 0}</div></div>
      <div class="summary-card"><div class="lbl">Enabled</div><div class="val">${totals.enabled || 0}</div></div>
      <div class="summary-card"><div class="lbl">In Trade</div><div class="val">${totals.inTrade || 0}</div></div>
    </div>
    <div class="heartbeat">
      <div class="lbl">Last heartbeat</div>
      <div class="val">${heartbeat.lastHeartbeatAt || 'n/a'}</div>
      <div class="sub">${heartbeat.heartbeatAgeMinutes === null ? 'Age unknown' : `${heartbeat.heartbeatAgeMinutes}m ago`} · ${heartbeat.heartbeatFresh === null ? 'status unknown' : (heartbeat.heartbeatStale ? 'stale' : 'fresh')}</div>
    </div>
    <div class="activity">
      <div class="activity-row">
        <div class="lbl">Last trade signal</div>
        <div class="val">${activity.latestSignal ? `${activity.latestSignal.bot_id} ${activity.latestSignal.signal}` : 'n/a'}</div>
        <div class="sub">${activity.latestSignal ? `${activity.latestSignal.ageMinutes}m ago · ${activity.latestSignal.received_at.slice(0, 19).replace('T', ' ')} UTC` : 'No signal recorded'}</div>
      </div>
      <div class="activity-row">
        <div class="lbl">Last order attempt</div>
        <div class="val">${activity.latestOrder ? `${activity.latestOrder.bot_id} ${activity.latestOrder.symbol} ${activity.latestOrder.status}` : 'n/a'}</div>
        <div class="sub">${activity.latestOrder ? `${activity.latestOrder.ageMinutes}m ago` : 'No order attempt recorded'}</div>
      </div>
      <div class="activity-row">
        <div class="lbl">Last failure</div>
        <div class="val">${activity.latestFailure ? `${activity.latestFailure.bot_id} ${activity.latestFailure.symbol}` : 'n/a'}</div>
        <div class="sub">${activity.latestFailure ? `${activity.latestFailure.reason} · ${activity.latestFailure.ageMinutes}m ago` : 'No recent failures'}</div>
      </div>
    </div>
    <div class="bot-list">${botCards || '<div class="bot-card">No bots found.</div>'}</div>
    ${cpPanel}

    <div style="margin-top:20px;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e293b;">Bot Equity Curves — % from activation</div>
      <div style="display:grid;gap:10px;">
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">S2 Live System</div><canvas id="chart-live" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">P1 Mirror (control)</div><canvas id="chart-p1" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">P2 Capital Pool</div><canvas id="chart-p2" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">Q_Pool (from 7 May 2026)</div><canvas id="chart-qpool" style="width:100%;height:300px;display:block;"></canvas></div>
      </div>
    </div>

    <div style="margin-top:20px;">
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #1e293b;">Bot Equity Curves — % since 3 May 2026</div>
      <div style="display:grid;gap:10px;">
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">S2 Live — since 3 May</div><canvas id="chart-live-today" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">P1 Mirror — since 3 May</div><canvas id="chart-p1-today" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">P2 Capital Pool — since 3 May</div><canvas id="chart-p2-today" style="width:100%;height:540px;display:block;"></canvas></div>
        <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;"><div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">Q_Pool — since 7 May 2026</div><canvas id="chart-qpool-today" style="width:100%;height:300px;display:block;"></canvas></div>
      </div>
    </div>

    <script>
    (function(){
      var COLORS=['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];
      var QPOOL_EQUITY=${JSON.stringify(cpData.qpoolEquity||[])};
      var BOT_LABELS={Bot1:'Bot1',Bot2:'Bot2',Bot3:'Bot3',Bot4:'Bot4',Bot5:'Bot5',Bot6:'Bot6',Bot7:'Bot7',Bot8:'Bot8',P_Bot1:'Bot1',P_Bot2:'Bot2',P_Bot3:'Bot3',P_Bot4:'Bot4',P_Bot5:'Bot5',P_Bot6:'Bot6',P_Bot7:'Bot7',P_Bot8:'Bot8',P2_Bot1:'Bot1',P2_Bot2:'Bot2',P2_Bot3:'Bot3',P2_Bot4:'Bot4',P2_Bot5:'Bot5',P2_Bot6:'Bot6',P2_Bot7:'Bot7',P2_Bot8:'Bot8',QPool_Bot1:'Bot1',QPool_Bot2:'Bot2',QPool_Bot3:'Bot3',QPool_Bot4:'Bot4',QPool_Bot5:'Bot5',QPool_Bot6:'Bot6',QPool_Bot7:'Bot7',QPool_Bot8:'Bot8'};
      function drawChart(id,data,opts){
        var canvas=document.getElementById(id); if(!canvas)return;
        var dpr=window.devicePixelRatio||1;
        var cssW=canvas.parentElement.clientWidth-28;
        var cssH=canvas.offsetHeight||540;
        canvas.width=Math.round(cssW*dpr); canvas.height=Math.round(cssH*dpr);
        canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px';
        var ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
        var PAD={t:20,r:100,b:48,l:60};
        var CW=cssW-PAD.l-PAD.r, CH=cssH-PAD.t-PAD.b;
        var bots=Object.keys(data);
        var allPts=bots.reduce(function(a,b){return a.concat(data[b]);}, []);
        if(!allPts.length)return;
        var maxDay=Math.max.apply(null,allPts.map(function(p){return p.d;}))||1;
        maxDay=Math.ceil(maxDay)+0.3;
        var minP=Math.min.apply(null,allPts.map(function(p){return p.p;}));
        var maxP=Math.max.apply(null,allPts.map(function(p){return p.p;}));
        minP=Math.min(minP,-2); maxP=Math.max(maxP,2);
        var rawRng=maxP-minP;
        var step=rawRng<=20?5:rawRng<=60?10:rawRng<=120?20:50;
        var pad=step*Math.ceil(Math.abs(minP)/step);
        minP=-pad; maxP=Math.max(maxP,pad);
        var rng=maxP-minP||10;
        function xs(d){return PAD.l+d/maxDay*CW;}
        function ys(p){return PAD.t+CH-(p-minP)/rng*CH;}
        ctx.fillStyle='#111827'; ctx.fillRect(0,0,cssW,cssH);
        ctx.font='11px Inter,system-ui,sans-serif';
        for(var p=minP;p<=maxP+0.01;p+=step){
          var y=ys(p); if(y<PAD.t-2||y>PAD.t+CH+2)continue;
          ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(PAD.l+CW,y);
          ctx.strokeStyle=p===0?'#374151':'#1e293b'; ctx.lineWidth=p===0?1.5:0.75; ctx.stroke();
          ctx.fillStyle=p===0?'#94a3b8':'#64748b'; ctx.textAlign='right';
          ctx.fillText((p>=0?'+':'')+p+'%',PAD.l-8,y+4);
        }
        var isHour=opts&&opts.xLabel==='h';
        var dayStep=isHour?(maxDay>20?6:maxDay>12?4:maxDay>6?2:1):(maxDay>10?3:maxDay>5?2:1);
        for(var d=0;d<=maxDay;d+=dayStep){
          var x=xs(d);
          ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,PAD.t+CH);
          ctx.strokeStyle='#1e293b'; ctx.lineWidth=0.75; ctx.stroke();
          ctx.fillStyle='#64748b'; ctx.textAlign='center';
          ctx.fillText(((opts&&opts.xLabel)||'d')+d,x,PAD.t+CH+18);
        }
        var startRef=opts&&opts.startIso?new Date(opts.startIso).getTime():new Date('2026-04-24T19:09:00.000Z').getTime();
        var timeUnit=opts&&opts.xLabel==='h'?36e5:864e5;
        var nowDay=(Date.now()-startRef)/timeUnit;
        var nx=xs(nowDay);
        if(nx>=PAD.l&&nx<=PAD.l+CW){
          ctx.beginPath();ctx.moveTo(nx,PAD.t);ctx.lineTo(nx,PAD.t+CH);
          ctx.strokeStyle='#374151'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle='#4b5563'; ctx.textAlign='center'; ctx.font='10px Inter,system-ui,sans-serif';
          ctx.fillText('now',nx,PAD.t-6); ctx.font='11px Inter,system-ui,sans-serif';
        }
        bots.forEach(function(bot,i){
          var pts=data[bot]; if(!pts||pts.length<1)return;
          ctx.beginPath();
          pts.forEach(function(pt,j){var x=xs(pt.d),y=ys(pt.p);if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
          ctx.strokeStyle=COLORS[i%8]; ctx.lineWidth=2.5; ctx.stroke();
          var last=pts[pts.length-1]; var lx=xs(last.d),ly=ys(last.p);
          ctx.beginPath();ctx.arc(lx,ly,5,0,Math.PI*2); ctx.fillStyle=COLORS[i%8]; ctx.fill();
          var lbl=(BOT_LABELS[bot]||bot)+' '+(last.p>=0?'+':'')+last.p.toFixed(1)+'%';
          ctx.font='10px Inter,system-ui,sans-serif'; ctx.fillStyle=COLORS[i%8]; ctx.textAlign='left';
          ctx.fillText(lbl,lx+9,ly+4); ctx.font='11px Inter,system-ui,sans-serif';
        });
        var legCols=Math.min(bots.length,8); var colW=Math.floor(CW/legCols); var legY=cssH-14;
        bots.forEach(function(bot,i){
          var lbl=BOT_LABELS[bot]||bot; var lx=PAD.l+i*colW;
          ctx.fillStyle=COLORS[i%8]; ctx.fillRect(lx,legY-8,16,3);
          ctx.fillStyle='#94a3b8'; ctx.textAlign='left'; ctx.font='11px Inter,system-ui,sans-serif';
          ctx.fillText(lbl,lx+20,legY);
        });
      }
      function loadCharts(){
        fetch('/s2/equity-data').then(function(r){return r.json();}).then(function(d){
          if(d.error){console.error('equity-data:',d.error);return;}
          drawChart('chart-live',d.live);
          drawChart('chart-p1',d.p1);
          drawChart('chart-p2',d.p2);
        }).catch(function(e){console.error('chart fetch:',e);});
        fetch('/s2/equity-data-today').then(function(r){return r.json();}).then(function(d){
          if(d.error){console.error('equity-data-today:',d.error);return;}
          drawChart('chart-live-today',d.live,{xLabel:'h',startIso:'2026-05-03T00:00:00.000Z'});
          drawChart('chart-p1-today',d.p1,{xLabel:'h',startIso:'2026-05-03T00:00:00.000Z'});
          drawChart('chart-p2-today',d.p2,{xLabel:'h',startIso:'2026-05-03T00:00:00.000Z'});
        }).catch(function(e){console.error('chart-today fetch:',e);});
      }
      loadCharts();
      setInterval(loadCharts,60000);
      // Q_Pool equity chart
      if(QPOOL_EQUITY && QPOOL_EQUITY.length > 1){
        var qpDs=[{label:'Q_Pool',data:QPOOL_EQUITY.map(function(p){return{x:p.d,y:p.p};}),borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,0.08)',fill:true,tension:0.3,pointRadius:2}];
        drawChart('chart-qpool',{datasets:qpDs},{yLabel:'% return',title:'Q_Pool Equity (from 7 May 2026)'});
        drawChart('chart-qpool-today',{datasets:qpDs},{yLabel:'% return',title:'Q_Pool Equity'});
      }
    })();
    </script>

    <div class="generated">Updated ${status.generatedAt || 'n/a'}</div>
    <div class="freshness">Auto-refresh 15s · heartbeat stale after ${heartbeat.heartbeatStaleThresholdMinutes || 360}m</div>
  </div>`;

  return pageShell('s2', 'S2 — Q Portal', CSS, body, '<meta http-equiv="refresh" content="15">');
}

// ─── Reverse proxy helpers ────────────────────────────────────────────────────

function injectPortalNav(html, activeTab) {
  const tabs = [['s2', 'S2'], ['s4', 'S4'], ['s6', 'S6']];
  const tabsHtml = tabs.map(([key, label]) => {
    const isActive = key === activeTab;
    const bg = isActive ? 'background:#1e3a5f;' : '';
    const color = isActive ? 'color:#93c5fd;' : 'color:#94a3b8;';
    return `<a href="/${key}" style="padding:6px 14px;border-radius:8px;font-size:14px;font-weight:600;${bg}${color}text-decoration:none;">${label}</a>`;
  }).join('');

  const nav = `<div id="q-portal-nav" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111827;border-bottom:1px solid #1f2937;display:flex;align-items:center;gap:4px;padding:0 16px;height:41px;font-family:Inter,system-ui,-apple-system,sans-serif;">
  <span style="font-size:13px;font-weight:700;color:#93c5fd;margin-right:12px;letter-spacing:.05em;white-space:nowrap;">Q Portal</span>
  ${tabsHtml}
</div>
<style>body{padding-top:41px!important;}.navbar.sticky-top,.navbar.fixed-top,.sticky-top{top:41px!important;}</style>`;

  if (html.includes('id="q-portal-nav"')) return html;
  if (/<body[\s>]/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>\n${nav}`);
  }
  return nav + html;
}

function rewriteHtmlPaths(html, prefix) {
  return html
    // HTML attributes: href="/...", src="/...", action="/...", data-src="/..."
    .replace(/((?:href|src|action|data-src|data-href|data-url)=")\/(?![/"])/g, `$1${prefix}/`)
    // JS fetch('/...') — single or double quotes
    .replace(/(\bfetch\s*\(\s*)'\/(?![/'])/g, `$1'${prefix}/`)
    .replace(/(\bfetch\s*\(\s*)"\/(?![/"])/g, `$1"${prefix}/`)
    // window.location = '/...' or window.location.href = '/...'
    .replace(/(window\.location(?:\.href)?\s*=\s*)'\/(?![/'])/g, `$1'${prefix}/`)
    .replace(/(window\.location(?:\.href)?\s*=\s*)"\/(?![/"])/g, `$1"${prefix}/`);
}

function proxyRequest(req, res, { targetPort, prefix, activeTab, rewritePaths = false }) {
  const rawUrl = req.url || '/';
  const qIdx = rawUrl.indexOf('?');
  const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx) : '';

  let targetPath = rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
  if (!targetPath || targetPath === '') targetPath = '/';
  if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

  const upstreamReq = http.request(
    {
      hostname: '127.0.0.1',
      port: targetPort,
      path: targetPath + rawQuery,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
      },
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode;
      const headers = {};
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (k === 'transfer-encoding') continue;
        headers[k] = v;
      }

      // Rewrite Location for redirects
      if (headers.location) {
        const loc = headers.location;
        if (loc.startsWith('/') && !loc.startsWith('//')) {
          headers.location = prefix + loc;
        }
      }

      const contentType = headers['content-type'] || '';
      const isHtml = contentType.includes('text/html');

      if (!isHtml) {
        res.writeHead(status, headers);
        upstreamRes.pipe(res);
        return;
      }

      delete headers['content-length'];
      const chunks = [];
      upstreamRes.on('data', chunk => chunks.push(Buffer.from(chunk)));
      upstreamRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        if (rewritePaths) html = rewriteHtmlPaths(html, prefix);
        // Skip nav injection when request comes from inside an iframe (already has portal nav on outer page)
        const fetchDest = req.headers['sec-fetch-dest'] || '';
        if (fetchDest !== 'iframe' && fetchDest !== 'frame') {
          html = injectPortalNav(html, activeTab);
        }
        const buf = Buffer.from(html, 'utf8');
        headers['content-length'] = buf.length;
        res.writeHead(status, headers);
        res.end(buf);
      });
    }
  );

  upstreamReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Proxy error: ${err.message}`);
    }
  });

  req.pipe(upstreamReq);
}

// ─── S4 EMA Live page ─────────────────────────────────────────────────────────

function renderEmaLivePage() {
  const CSS = `
    .pg{padding:16px;max-width:900px;margin:0 auto;}
    h1{font-size:17px;font-weight:700;color:#94a3b8;margin:0 0 12px;letter-spacing:.04em;text-transform:uppercase;}
    .state-card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:14px;margin-bottom:12px;}
    .state-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid #1e293b;}
    .state-row:last-child{border:none;}
    .state-key{color:#64748b;}
    table{width:100%;border-collapse:collapse;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1f2937;}
    th{text-align:left;padding:10px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #1f2937;font-weight:600;}
    td{padding:9px 12px;font-size:13px;border-bottom:1px solid #1e293b;}
    tr:last-child td{border:none;}
    .pos{color:#86efac;}.neg{color:#fca5a5;}.neutral{color:#94a3b8;}
    .err{color:#fca5a5;padding:16px;}
    .loading{color:#64748b;padding:16px;}
    .footer{font-size:11px;color:#334155;text-align:center;margin-top:12px;}
  `;
  const body = `<div class="pg">
    <h1>S4 — EMA Live</h1>
    <div id="state-wrap"><div class="loading">Loading state…</div></div>
    <div id="trades-wrap"><div class="loading">Loading trades…</div></div>
    <div class="footer" id="ts"></div>
  </div>
  <script>
  async function load() {
    try {
      const r = await fetch('/s4/ema-live/data');
      const d = await r.json();
      if (d.error) { document.getElementById('state-wrap').innerHTML = '<div class="err">Error: ' + d.error + '</div>'; return; }

      const state = d.state || {};
      const stateRows = Object.entries(state).map(([k,v]) =>
        '<div class="state-row"><span class="state-key">' + k + '</span><span>' + JSON.stringify(v) + '</span></div>'
      ).join('');
      document.getElementById('state-wrap').innerHTML = stateRows
        ? '<div class="state-card">' + stateRows + '</div>'
        : '<div class="state-card" style="color:#64748b;font-size:13px;">No state data</div>';

      const trades = Array.isArray(d.trades) ? d.trades : (typeof d.trades === 'object' ? Object.values(d.trades) : []);
      if (!trades.length) {
        document.getElementById('trades-wrap').innerHTML = '<div class="state-card" style="color:#64748b;font-size:13px;">No trades</div>';
        return;
      }
      const cols = Object.keys(trades[0] || {});
      const thead = '<tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>';
      const tbody = trades.map(t => '<tr>' + cols.map(c => {
        const v = t[c];
        const n = parseFloat(v);
        const cls = !isNaN(n) && cols[c] !== undefined ? (n > 0 ? 'pos' : n < 0 ? 'neg' : 'neutral') : '';
        return '<td class="' + cls + '">' + (v === null || v === undefined ? '–' : v) + '</td>';
      }).join('') + '</tr>').join('');
      document.getElementById('trades-wrap').innerHTML = '<table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
      document.getElementById('ts').textContent = 'Loaded ' + new Date().toISOString();
    } catch(e) {
      document.getElementById('state-wrap').innerHTML = '<div class="err">Fetch error: ' + e.message + '</div>';
    }
  }
  load();
  setInterval(load, 15000);
  </script>`;
  return pageShell('s4', 'S4 EMA Live — Q Portal', CSS, body, '<meta http-equiv="refresh" content="30">');
}

// ─── Iframe pages ─────────────────────────────────────────────────────────────

function renderIframe(section, url) {
  const labels = { s4: 'S4 — EMA Live', s6: 'S6 — Signal Scout' };
  const label = labels[section] || section.toUpperCase();
  const CSS = `
    html,body{height:100%;overflow:hidden;}
    .iframe-wrap{position:fixed;top:41px;left:0;right:0;bottom:0;}
    iframe{width:100%;height:100%;border:none;display:block;}
  `;
  const body = `<div class="iframe-wrap"><iframe src="${url}" allowfullscreen></iframe></div>`;
  return pageShell(section, `Q Portal — ${label}`, CSS, body);
}

function renderComingSoon(section, label, detail = '') {
  const CSS = `
    .pg{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:40px 20px;text-align:center;}
    .badge{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:16px;}
    h1{font-size:24px;font-weight:800;color:#e2e8f0;margin:0 0 10px;}
    p{color:#64748b;font-size:14px;max-width:360px;line-height:1.6;}
  `;
  const body = `<div class="pg">
    <div class="badge">${section.toUpperCase()}</div>
    <h1>${label}</h1>
    ${detail ? `<p>${detail}</p>` : ''}
  </div>`;
  return pageShell(section, `Q Portal — ${label}`, CSS, body);
}

// ─── Request handler ──────────────────────────────────────────────────────────

async function handleRequest(req, res, options) {
  const path = String(req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const method = req.method;

  if (path === '/login') {
    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLoginPage(false));
      return;
    }
    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const password = new URLSearchParams(body).get('password') || '';
        if (PORTAL_PASSWORD && password === PORTAL_PASSWORD) {
          const token = makeToken();
          res.writeHead(302, {
            Location: '/',
            'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
          });
          res.end();
        } else {
          res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderLoginPage(true));
        }
      });
      return;
    }
  }

  if (!isAuthenticated(req)) {
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }

  // ── S6 — native portal wrapper + iframe ──────────────────────────────────
  if (path === '/s6') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIframe('s6', '/s6/funnel'));
    return;
  }
  if (path.startsWith('/s6/')) {
    proxyRequest(req, res, { targetPort: 8083, prefix: '/s6', activeTab: 's6', rewritePaths: true });
    return;
  }

  // ── S4 Notes API → port 8400 (before general S4 catch-all) ───────────────
  if (path === '/s4/api/note') {
    proxyRequest(req, res, { targetPort: 8400, prefix: '/s4', activeTab: 's4' });
    return;
  }

  // ── S4 — native portal wrapper + iframe ──────────────────────────────────
  if (path === '/s4') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIframe('s4', '/s4/s4_live_review.html'));
    return;
  }
  if (path.startsWith('/s4/')) {
    proxyRequest(req, res, { targetPort: 8080, prefix: '/s4', activeTab: 's4' });
    return;
  }

  // ── Portal-native routes (GET/HEAD only) ──────────────────────────────────
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  if (path === '/mobile') {
    res.writeHead(302, { Location: '/s2' });
    res.end();
    return;
  }

  if (path === '/api/mobile-bot-status') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (method !== 'HEAD') res.end(JSON.stringify(status, null, 2));
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      if (method !== 'HEAD') res.end(JSON.stringify({ error: err.message }));
      else res.end();
    }
    return;
  }

  if (path === '/s2/equity-data') {
    const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
    const data = loadEquityData(dbPath);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (method !== 'HEAD') res.end(JSON.stringify(data)); else res.end();
    return;
  }

  if (path === '/s2/equity-data-today') {
    const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
    const LIVE_BASE  = Number(process.env.PORTFOLIO_BASELINE_USDT || 2799.94) / 8;
    const PAPER_BASE = Number(process.env.PAPER_BASELINE_USDT  || 2756.68) / 8;
    const P2_BASE    = Number(process.env.PAPER2_BASELINE_USDT || 2756.68) / 8;
    const todayStartMs = new Date('2026-05-03T00:00:00.000Z').getTime();
    const nowHr = Math.round((Date.now() - todayStartMs) / 36e5 * 100) / 100;
    const [data, liveStatus] = await Promise.all([
      Promise.resolve(loadEquityDataToday(dbPath)),
      buildMobileBotStatus(options.mobileBotStatusOptions).catch(() => null),
    ]);
    if (!data.error && liveStatus && Array.isArray(liveStatus.bots)) {
      liveStatus.bots.forEach(bot => {
        if (bot.botId && data.live[bot.botId] && Number.isFinite(bot.unrealizedPnl) && bot.unrealizedPnl !== 0) {
          const curve = data.live[bot.botId];
          const lastP = curve.length > 0 ? curve[curve.length - 1].p : 0;
          const unrealPct = Math.round(bot.unrealizedPnl / LIVE_BASE * 10000) / 100;
          curve.push({ d: nowHr, p: Math.round((lastP + unrealPct) * 100) / 100, unreal: true });
        }
        if (Array.isArray(bot.paperPositions)) {
          bot.paperPositions.forEach(pp => {
            if (!pp.paperBotId || !Number.isFinite(pp.unrealizedPnl) || pp.unrealizedPnl === 0) return;
            const isP2 = pp.paperBotId.startsWith('P2_');
            const dataset = isP2 ? data.p2 : data.p1;
            const base = isP2 ? P2_BASE : PAPER_BASE;
            const curve = dataset && dataset[pp.paperBotId];
            if (!curve) return;
            const lastP = curve.length > 0 ? curve[curve.length - 1].p : 0;
            const unrealPct = Math.round(pp.unrealizedPnl / base * 10000) / 100;
            curve.push({ d: nowHr, p: Math.round((lastP + unrealPct) * 100) / 100, unreal: true });
          });
        }
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (method !== 'HEAD') res.end(JSON.stringify(data)); else res.end();
    return;
  }

  // ── S2.1 routes ─────────────────────────────────────────────────────────
  if (path === '/s2-1') {
    res.writeHead(302, { Location: '/s2-1/trade-log' });
    res.end();
    return;
  }
  if (path === '/s2-1/trade-log') {
    try {
      const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/tmp/qs2_review/data/s2.sqlite';
      const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
      const { prepareTradeLogData, renderTradeLogBody, TRADE_LOG_CSS } = require('../s21/tradeLogPage');
      const db = createDatabase(dbPath);
      initSchema(db);
      const persistence = buildPersistence(db);
      const data = prepareTradeLogData(persistence);
      const body = renderTradeLogBody(data);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(pageShell('s2-1', 'S2.1 Trade Log', TRADE_LOG_CSS, body));
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Failed to render S2.1 trade log: ${err.message}`);
    }
    return;
  }
  if (path === '/api/s2-1/trade-log') {
    try {
      const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/tmp/qs2_review/data/s2.sqlite';
      const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
      const { prepareTradeLogData } = require('../s21/tradeLogPage');
      const db = createDatabase(dbPath);
      initSchema(db);
      const persistence = buildPersistence(db);
      const data = prepareTradeLogData(persistence);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (method !== 'HEAD') res.end(JSON.stringify(data));
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (path === '/api/s2-1/export.csv') {
    try {
      const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/tmp/qs2_review/data/s2.sqlite';
      const { createDatabase, initSchema, buildPersistence } = require('../db/sqlite');
      const { buildCsvExport } = require('../s21/tradeLogPage');
      const db = createDatabase(dbPath);
      initSchema(db);
      const persistence = buildPersistence(db);
      const csv = buildCsvExport(persistence);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="s2-1-trade-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
      if (method !== 'HEAD') res.end(csv);
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`CSV export failed: ${err.message}`);
    }
    return;
  }

  if (path === '/s2') {
    try {
      const dbPath = (options.mobileBotStatusOptions || {}).dbPath || '/home/ubuntu/.openclaw/workspace/Q_S2/data/s2.sqlite';
      const [status, paperPortfolio, cpData] = await Promise.all([
        buildMobileBotStatus(options.mobileBotStatusOptions),
        Promise.resolve(loadPaperPortfolio(dbPath)),
        Promise.resolve(loadCapitalPoolData(dbPath)),
      ]);
      const html = renderS2Page(status, paperPortfolio, cpData);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(html);
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Failed to render S2: ${err.message}`);
    }
    return;
  }

  if (path === '/' || path === '/index.html') {
    try {
      const [status, s6QueueCount] = await Promise.all([
        buildMobileBotStatus(options.mobileBotStatusOptions),
        fetchS6QueueCount(),
      ]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(renderLandingPage(status, s6QueueCount));
      else res.end();
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(renderLandingPage(null, null));
      else res.end();
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// ─── Server factory ───────────────────────────────────────────────────────────

function createPortalServer(options = {}) {
  const host = options.host || '0.0.0.0';
  const port = options.port || 3010;
  const logger = options.logger || console;

  const server = http.createServer((req, res) => {
    handleRequest(req, res, options).catch(err => {
      logger.error('Unhandled portal error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal server error');
    });
  });

  return {
    start() {
      return new Promise(resolve => {
        server.listen(port, host, () => {
          logger.info(`Portal server listening on ${host}:${port}`);
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
      });
    },
  };
}

module.exports = { createPortalServer };
