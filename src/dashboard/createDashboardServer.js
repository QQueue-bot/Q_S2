const http = require('http');
const Database = require('better-sqlite3');

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

function renderDashboardHtml({ title = 'S2 Dashboard', runtime = {}, signals = [] } = {}) {
  const sections = [
    {
      id: 'signals',
      title: 'Recent Signals',
      body: renderSignalFeed(signals),
    },
    {
      id: 'positions',
      title: 'Open Positions / Orders',
      body: 'Placeholder for Sprint B3 open position and open order state panel.',
    },
    {
      id: 'events',
      title: 'Execution Events',
      body: 'Placeholder for Sprint B4 execution event timeline.',
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

  const server = http.createServer((req, res) => {
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboardHtml({ title, runtime, signals }));
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
