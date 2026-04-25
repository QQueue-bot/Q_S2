'use strict';

const http = require('http');
const crypto = require('crypto');
const { buildMobileBotStatus } = require('../dashboard/buildMobileBotStatus');

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
  const tabs = ['s2', 's4', 's6'];
  return `<nav class="q-nav">
    <span class="q-nav-logo">Q Portal</span>
    ${tabs.map(t => `<a href="/${t}" class="q-nav-tab${active === t ? ' active' : ''}">${t.toUpperCase()}</a>`).join('')}
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

// ─── Landing page ─────────────────────────────────────────────────────────────

function renderLandingPage(status) {
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
        <div class="card-title">S6 — Funnel</div>
        <div class="card-val" style="color:#334155;">–</div>
        <div class="card-sub">Not yet integrated</div>
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
      ${bot.positionSize ? `<div class="pos-row"><span class="pos-key">Size</span><span>${bot.positionSize}</span></div>` : ''}
      ${Number.isFinite(bot.avgEntryPrice) ? `<div class="pos-row"><span class="pos-key">Entry</span><span>${bot.avgEntryPrice.toPrecision(5)}</span></div>` : ''}
      ${Number.isFinite(bot.markPrice) ? `<div class="pos-row"><span class="pos-key">Mark</span><span>${bot.markPrice.toPrecision(5)}</span></div>` : ''}
      ${Number.isFinite(bot.unrealizedPnl) ? `<div class="pos-row"><span class="pos-key">uPnL</span><span style="color:${upnlColor};font-weight:700;">${fmtPnl(bot.unrealizedPnl)}</span></div>` : ''}
      ${analysisBadgeHtml}
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

  return `<div class="bot-card${enabledClass}">
    <div class="bot-top">
      <div class="bot-name">${bot.botId}</div>
      <div class="bot-state ${stateClass}">${bot.tradeState}</div>
    </div>
    <div class="bot-meta">${enabled} · ${bot.symbol || 'n/a'}</div>
    ${profileStr ? `<div class="bot-profile">${profileStr}</div>` : ''}
    <div class="bot-balance">${balance}</div>
    ${positionHtml}
    ${statsHtml}
  </div>`;
}

function renderS2Page(status) {
  const totals = status.totals || {};
  const bots = Array.isArray(status.bots) ? status.bots : [];
  const heartbeat = status.heartbeat || {};
  const activity = status.activity || {};

  const mdxPanel = renderMdxPanel(status.mdx || null, status.reviewCriteria || []);
  const healthPanel = renderServiceHealthPanel(status.serviceHealth || null);
  const botCards = bots.map(renderBotCard).join('\n');

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
    /* Misc */
    .generated{font-size:12px;opacity:.6;text-align:center;margin-top:12px;}
    .freshness{font-size:12px;text-align:center;margin-top:6px;color:#93c5fd;}
  `;

  const body = `<div class="wrap">
    ${mdxPanel}
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
    <div class="generated">Updated ${status.generatedAt || 'n/a'}</div>
    <div class="freshness">Auto-refresh 15s · heartbeat stale after ${heartbeat.heartbeatStaleThresholdMinutes || 360}m</div>
  </div>`;

  return pageShell('s2', 'S2 — Q Portal', CSS, body, '<meta http-equiv="refresh" content="15">');
}

// ─── Iframe pages ─────────────────────────────────────────────────────────────

function renderIframe(section, url) {
  const labels = { s4: 'S4 — Signal Scout', s6: 'S6 — Signal Scout' };
  const label = labels[section] || section.toUpperCase();
  const CSS = `
    html,body{height:100%;overflow:hidden;}
    .iframe-wrap{position:fixed;top:41px;left:0;right:0;bottom:0;}
    iframe{width:100%;height:100%;border:none;display:block;}
  `;
  const body = `<div class="iframe-wrap"><iframe src="${url}" allowfullscreen></iframe></div>`;
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

  if (path === '/s2') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      const html = renderS2Page(status);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(html);
      else res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Failed to render S2: ${err.message}`);
    }
    return;
  }

  if (path === '/s4') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (method !== 'HEAD') res.end(renderIframe('s4', 'https://s4.tbotsys.one'));
    else res.end();
    return;
  }

  if (path === '/s6') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (method !== 'HEAD') res.end(renderIframe('s6', 'https://s6.tbotsys.one'));
    else res.end();
    return;
  }

  if (path === '/' || path === '/index.html') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(renderLandingPage(status));
      else res.end();
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (method !== 'HEAD') res.end(renderLandingPage(null));
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
