const http = require('http');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const axios = require('axios');
const crypto = require('crypto');

const BYBIT_BASE_URL = process.env.BYBIT_BASE_URL || 'https://api-demo.bybit.com';
dotenv.config({ path: '/home/ubuntu/.openclaw/workspace/.env' });

function loadRecentSignals(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const hasNormalizedSignals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='normalized_signals'").get();
    const hasOrderAttempts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='order_attempts'").get();

    let signals = [];
    if (hasNormalizedSignals) {
      signals = db.prepare(`
        SELECT received_at AS timestamp, raw_input AS rawSignal, signal AS parsedSignal, bot_id AS botId, 'received' AS status
        FROM normalized_signals
        ORDER BY id DESC
        LIMIT 10
      `).all();
    }

    if (signals.length === 0 && hasOrderAttempts) {
      signals = db.prepare(`
        SELECT created_at AS timestamp, signal AS rawSignal, signal AS parsedSignal, bot_id AS botId,
               CASE WHEN status = 'submitted' THEN 'actionable' ELSE status END AS status
        FROM order_attempts
        ORDER BY id DESC
        LIMIT 10
      `).all();
    }

    db.close();
    return signals;
  } catch {
    return [];
  }
}

function signBybitRequest(query = '', body = '') {
  const apiKey = process.env.BYBIT_TESTNET_API_KEY;
  const apiSecret = process.env.BYBIT_TESTNET_API_SECRET;
  if (!apiKey || !apiSecret) {
    return null;
  }
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const payload = timestamp + apiKey + recvWindow + (query || body);
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return { apiKey, timestamp, recvWindow, signature };
}

async function loadCurrentPositionAndOrders(symbol = 'BTCUSDT') {
  try {
    const query = `category=linear&symbol=${symbol}`;
    const signed = signBybitRequest(query, '');
    if (!signed) {
      return { position: null, orders: [], error: 'Missing Bybit credentials' };
    }

    const headers = {
      'X-BAPI-API-KEY': signed.apiKey,
      'X-BAPI-TIMESTAMP': signed.timestamp,
      'X-BAPI-RECV-WINDOW': signed.recvWindow,
      'X-BAPI-SIGN': signed.signature,
    };

    const [positionResponse, ordersResponse] = await Promise.all([
      axios.get(`${BYBIT_BASE_URL}/v5/position/list?${query}`, { headers, validateStatus: () => true }),
      axios.get(`${BYBIT_BASE_URL}/v5/order/realtime?${query}`, { headers, validateStatus: () => true }),
    ]);

    const position = (positionResponse.data?.result?.list || []).find(item => Number(item.size || 0) > 0) || null;
    const orders = ordersResponse.data?.result?.list || [];
    return { position, orders, error: null };
  } catch (error) {
    return { position: null, orders: [], error: error.message };
  }
}

function renderSignalFeed(signals = []) {
  if (!signals.length) {
    return '<p>No recent signals found yet.</p>';
  }

  const items = signals.map(signal => `
    <div class="signal-item">
      <div><strong>${signal.timestamp || 'unknown time'}</strong></div>
      <div><span class="label">Raw:</span> <code>${signal.rawSignal || 'n/a'}</code></div>
      <div><span class="label">Parsed:</span> <code>${signal.parsedSignal || 'n/a'}</code></div>
      <div><span class="label">Bot:</span> <code>${signal.botId || 'n/a'}</code></div>
      <div><span class="label">Status:</span> <code>${signal.status || 'unknown'}</code></div>
    </div>
  `).join('\n');

  return `<div class="signal-list">${items}</div>`;
}

function loadExecutionTimeline(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const timeline = [];

    const hasOrderAttempts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='order_attempts'").get();
    const hasExitEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exit_events'").get();
    const hasBreakEvenEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='break_even_events'").get();
    const hasStagedEntryEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='staged_entry_events'").get();

    if (hasOrderAttempts) {
      const rows = db.prepare(`
        SELECT created_at AS timestamp, 'ORDER' AS eventType, signal AS title, status, side, qty, bot_id AS botId
        FROM order_attempts
        ORDER BY id DESC
        LIMIT 15
      `).all();
      timeline.push(...rows);
    }

    if (hasExitEvents) {
      const rows = db.prepare(`
        SELECT created_at AS timestamp, 'EXIT' AS eventType, exit_reason AS title,
               exit_reason AS status, side, qty, NULL AS botId
        FROM exit_events
        ORDER BY id DESC
        LIMIT 15
      `).all();
      timeline.push(...rows);
    }

    if (hasBreakEvenEvents) {
      const rows = db.prepare(`
        SELECT created_at AS timestamp, 'BREAK EVEN' AS eventType, event_type AS title,
               event_type AS status, side, NULL AS qty, NULL AS botId
        FROM break_even_events
        ORDER BY id DESC
        LIMIT 15
      `).all();
      timeline.push(...rows);
    }

    if (hasStagedEntryEvents) {
      const rows = db.prepare(`
        SELECT created_at AS timestamp, 'STAGED ENTRY' AS eventType, stage_name AS title,
               status, NULL AS side, qty, bot_id AS botId
        FROM staged_entry_events
        ORDER BY id DESC
        LIMIT 15
      `).all();
      timeline.push(...rows);
    }

    db.close();

    return timeline.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 20);
  } catch {
    return [];
  }
}

function renderExecutionTimeline(events = []) {
  if (!events.length) {
    return '<p>No execution events found yet.</p>';
  }

  const items = events.map(event => {
    const statusClass = /failed|error/i.test(event.status || '') ? 'status-failed'
      : /skipped/i.test(event.status || '') ? 'status-skipped'
      : /submitted|armed|take_profit|stop_loss|closed/i.test(event.status || '') ? 'status-success'
      : 'status-neutral';
    return `
      <div class="signal-item">
        <div><strong>${event.timestamp || 'unknown time'}</strong></div>
        <div><span class="label">Type:</span> <code>${event.eventType}</code></div>
        <div><span class="label">Event:</span> <code>${event.title || 'n/a'}</code></div>
        ${event.botId ? `<div><span class="label">Bot:</span> <code>${event.botId}</code></div>` : ''}
        ${event.side ? `<div><span class="label">Side:</span> <code>${event.side}</code></div>` : ''}
        ${event.qty ? `<div><span class="label">Qty:</span> <code>${event.qty}</code></div>` : ''}
        <div><span class="label">Status:</span> <code class="${statusClass}">${event.status || 'unknown'}</code></div>
      </div>
    `;
  }).join('\n');

  return `<div class="signal-list">${items}</div>`;
}

function renderPositionPanel(positionState = {}) {
  const { position, orders = [], error } = positionState;
  if (error) {
    return `<p>Unable to load live BTCUSDT state: ${error}</p>`;
  }

  const positionHtml = position ? `
    <div class="signal-item">
      <div><strong>Open BTCUSDT Position</strong></div>
      <div><span class="label">Side:</span> <code>${position.side}</code></div>
      <div><span class="label">Size:</span> <code>${position.size}</code></div>
      <div><span class="label">Avg Price:</span> <code>${position.avgPrice || 'n/a'}</code></div>
      <div><span class="label">Mark Price:</span> <code>${position.markPrice || 'n/a'}</code></div>
      <div><span class="label">Unrealized PnL:</span> <code>${position.unrealisedPnl || 'n/a'}</code></div>
    </div>
  ` : '<p>No open BTCUSDT position.</p>';

  const ordersHtml = orders.length ? `
    <div class="signal-list">
      ${orders.map(order => `
        <div class="signal-item">
          <div><strong>Open Order</strong></div>
          <div><span class="label">Order ID:</span> <code>${order.orderId}</code></div>
          <div><span class="label">Side:</span> <code>${order.side}</code></div>
          <div><span class="label">Qty:</span> <code>${order.qty}</code></div>
          <div><span class="label">Status:</span> <code>${order.orderStatus}</code></div>
        </div>
      `).join('')}
    </div>
  ` : '<p>No open BTCUSDT orders.</p>';

  return `${positionHtml}<div style="height:12px"></div>${ordersHtml}`;
}

function renderDashboardHtml({ title = 'S2 Dashboard', runtime = {}, signals = [], positionState = {}, executionEvents = [] } = {}) {
  const sections = [
    {
      id: 'signals',
      title: 'Recent Signals',
      body: renderSignalFeed(signals),
    },
    {
      id: 'positions',
      title: 'Open Positions / Orders',
      body: renderPositionPanel(positionState),
    },
    {
      id: 'events',
      title: 'Execution Events',
      body: renderExecutionTimeline(executionEvents),
    },
    {
      id: 'summary',
      title: 'Trade Summary',
      body: 'Placeholder for Sprint B5 trade summary view.',
    },
    {
      id: 'health',
      title: 'Runtime Health',
      body: 'Placeholder for Sprint B6 bot/runtime health panel.',
    },
  ];

  const cards = sections.map(section => `
    <section class="card" id="${section.id}">
      <h2>${section.title}</h2>
      <div class="card-body">${section.body}</div>
    </section>
  `).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0b1020;
      color: #e5e7eb;
    }
    header {
      padding: 24px;
      border-bottom: 1px solid #1f2937;
      background: #111827;
    }
    main {
      padding: 24px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .meta {
      margin-top: 12px;
      display: grid;
      gap: 8px;
      color: #93c5fd;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 16px;
      min-height: 140px;
    }
    .card-body {
      color: #cbd5e1;
      line-height: 1.5;
    }
    .signal-list {
      display: grid;
      gap: 10px;
    }
    .signal-item {
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 10px;
      background: #0f172a;
      display: grid;
      gap: 4px;
    }
    .label {
      color: #93c5fd;
    }
    .status-success {
      color: #86efac;
    }
    .status-failed {
      color: #fca5a5;
    }
    .status-skipped {
      color: #fcd34d;
    }
    .status-neutral {
      color: #cbd5e1;
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 16px; margin-bottom: 10px; }
    p { color: #cbd5e1; line-height: 1.5; }
    code { color: #f9a8d4; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <div class="meta">
      <div><strong>Mode:</strong> internal-only scaffold</div>
      <div><strong>Runtime path:</strong> <code>${runtime.path || 'Q_S2 workspace'}</code></div>
      <div><strong>Environment:</strong> <code>${runtime.environment || 'demo / internal'}</code></div>
      <div><strong>Status:</strong> basic scaffold online</div>
    </div>
  </header>
  <main>
    ${cards}
  </main>
</body>
</html>`;
}

function createDashboardServer(options = {}) {
  const {
    host = '127.0.0.1',
    port = 3010,
    title = 'S2 Dashboard',
    runtime = {},
    logger = console,
  } = options;

  const signalDbPath = runtime.dbPath || '/tmp/qs2_review/data/s2.sqlite';

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }

    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const signals = loadRecentSignals(signalDbPath);
    const executionEvents = loadExecutionTimeline(signalDbPath);
    const positionState = await loadCurrentPositionAndOrders('BTCUSDT');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboardHtml({ title, runtime, signals, positionState, executionEvents }));
  });

  return {
    start() {
      return new Promise(resolve => {
        server.listen(port, host, () => {
          logger.info('Dashboard server listening', { host, port, title });
          resolve(server);
        });
      });
    },
    stop() {
      return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

module.exports = {
  createDashboardServer,
  renderDashboardHtml,
};
