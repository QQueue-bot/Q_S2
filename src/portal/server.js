'use strict';

const http = require('http');
const crypto = require('crypto');
const { buildMobileBotStatus } = require('../dashboard/buildMobileBotStatus');
const { renderMobileBotStatusHtml } = require('../dashboard/createDashboardServer');

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

const NAV_CSS = `<style>
  .q-nav{display:flex;align-items:center;gap:4px;padding:10px 16px;background:#111827;border-bottom:1px solid #1f2937;position:sticky;top:0;z-index:100;}
  .q-nav-logo{font-size:13px;font-weight:700;color:#93c5fd;margin-right:12px;letter-spacing:.05em;white-space:nowrap;}
  .q-nav-tab{padding:6px 14px;border-radius:8px;font-size:14px;font-weight:600;color:#94a3b8;text-decoration:none;}
  .q-nav-tab:hover{background:#1e293b;color:#e2e8f0;}
  .q-nav-tab.active{background:#1e3a5f;color:#93c5fd;}
</style>`;

function navBar(active) {
  const tabs = ['s2', 's4', 's6'];
  const tabsHtml = tabs.map(t =>
    `<a href="/${t}" class="q-nav-tab${active === t ? ' active' : ''}">${t.toUpperCase()}</a>`
  ).join('');
  return `<nav class="q-nav"><span class="q-nav-logo">Q Portal</span>${tabsHtml}</nav>`;
}

function injectNav(html, active) {
  return html
    .replace('</head>', NAV_CSS + '</head>')
    .replace('<body>', '<body>' + navBar(active));
}

function renderLoginPage(error = false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Q Portal</title>
  <style>
    :root{color-scheme:dark;}
    body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;width:100%;max-width:320px;}
    h1{font-size:20px;margin:0 0 24px;text-align:center;color:#93c5fd;}
    input{width:100%;padding:10px 14px;background:#0f172a;border:1px solid #1f2937;border-radius:8px;color:#e2e8f0;font-size:16px;box-sizing:border-box;margin-bottom:14px;outline:none;}
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

function renderLandingPage(s2Status) {
  const totals = s2Status && s2Status.totals ? s2Status.totals : null;
  const s2Val = totals ? `${totals.enabled}/${totals.bots} enabled` : '–';
  const s2Sub = totals ? `${totals.inTrade} in trade` : 'Status unavailable';
  const now = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Q Portal</title>
  <style>
    :root{color-scheme:dark;}
    body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;}
    ${NAV_CSS.replace('<style>', '').replace('</style>', '')}
    .landing{padding:20px 16px;max-width:640px;margin:0 auto;}
    h1{font-size:20px;font-weight:700;margin:0 0 16px;}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;}
    .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px;cursor:default;}
    .card a{text-decoration:none;color:inherit;}
    .card-title{font-size:13px;font-weight:600;color:#93c5fd;margin-bottom:10px;}
    .card-val{font-size:20px;font-weight:800;}
    .card-sub{font-size:12px;color:#64748b;margin-top:4px;}
    .footer{font-size:11px;color:#334155;text-align:center;margin-top:20px;}
  </style>
</head>
<body>
  ${navBar('')}
  <div class="landing">
    <h1>System Status</h1>
    <div class="grid">
      <a href="/s2" style="text-decoration:none;">
        <div class="card">
          <div class="card-title">S2 — Signal Bot</div>
          <div class="card-val">${s2Val}</div>
          <div class="card-sub">${s2Sub}</div>
        </div>
      </a>
      <a href="/s4" style="text-decoration:none;">
        <div class="card">
          <div class="card-title">S4 — Signal Scout</div>
          <div class="card-val">–</div>
          <div class="card-sub">Not yet integrated</div>
        </div>
      </a>
      <a href="/s6" style="text-decoration:none;">
        <div class="card">
          <div class="card-title">S6 — Funnel</div>
          <div class="card-val">–</div>
          <div class="card-sub">Not yet integrated</div>
        </div>
      </a>
    </div>
    <div class="footer">Q Portal · Auto-refresh 30s · ${now}</div>
  </div>
</body>
</html>`;
}

function renderPlaceholder(section) {
  const labels = { s4: 'S4 — Signal Scout', s6: 'S6 — Funnel' };
  const label = labels[section] || section.toUpperCase();
  const inner = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Q Portal — ${label}</title>
  <style>
    :root{color-scheme:dark;}
    body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;}
    .page{padding:40px 20px;max-width:480px;margin:0 auto;text-align:center;}
    h1{font-size:20px;font-weight:700;color:#93c5fd;margin:0 0 12px;}
    p{color:#64748b;font-size:14px;margin:0;}
  </style>
</head>
<body>
  <div class="page">
    <h1>${label}</h1>
    <p>Integration coming in Phase 5. Data for this system lives on a separate server and will be proxied here.</p>
  </div>
</body>
</html>`;
  return injectNav(inner, section);
}

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
        const params = new URLSearchParams(body);
        const password = params.get('password') || '';
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

  if (path === '/mobile') {
    res.writeHead(302, { Location: '/s2' });
    res.end();
    return;
  }

  if (path === '/api/mobile-bot-status') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(status, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (path === '/s2') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      const html = injectNav(renderMobileBotStatusHtml(status), 's2');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Failed to render S2 status: ${err.message}`);
    }
    return;
  }

  if (path === '/s4') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPlaceholder('s4'));
    return;
  }

  if (path === '/s6') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPlaceholder('s6'));
    return;
  }

  if (path === '/' || path === '/index.html') {
    try {
      const status = await buildMobileBotStatus(options.mobileBotStatusOptions);
      const html = renderLandingPage(status);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      const html = renderLandingPage(null);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

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
