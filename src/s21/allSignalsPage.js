'use strict';

// "S2 all Signal Log" — unified view of every webhook the system has received.
//
// Source of truth: raw_webhook_events (every webhook hits this, including
// pre-S2.1 history). Enriched with:
//   - parsed bot_id + direction (permissive — accepts legacy ENTER/EXIT_LONG/SHORT
//     and S2.1's direction-less EXIT shape)
//   - source classification: S2_LEGACY (Bot1-8), S2_1 (Bot9+), HEARTBEAT, UNPARSED
//   - acted/reject_reason from s2_1_signals when the signal was S2.1-routed
//
// Heartbeats are surfaced because operators occasionally want to see them
// (proves the webhook path is alive). Render them muted.

const S21_BOT_IDS = new Set();  // populated lazily from s21-bots.json
const BOT_SYMBOLS = new Map();  // botId → symbol, lazily populated from both registries

function _getS21BotIds() {
  if (S21_BOT_IDS.size > 0) return S21_BOT_IDS;
  try {
    const { getS21BotIds } = require('./config');
    for (const id of getS21BotIds()) S21_BOT_IDS.add(id);
  } catch {
    // s21-bots.json missing → empty set, nothing classifies as S2.1
  }
  return S21_BOT_IDS;
}

// Builds the bot→symbol map from BOTH registries. S2.1 wins on collision
// (defence in depth — though the boot-time collision check should already
// have prevented dual registration).
function _getBotSymbols() {
  if (BOT_SYMBOLS.size > 0) return BOT_SYMBOLS;
  const path = require('path');
  // Legacy S2 (config/bots.json)
  try {
    const legacy = require(path.join(__dirname, '..', '..', 'config', 'bots.json'));
    for (const bot of legacy.bots || []) {
      if (bot.botId && bot.symbol) BOT_SYMBOLS.set(bot.botId, bot.symbol);
    }
  } catch {}
  // S2.1 (config/s21-bots.json) — overrides legacy on collision
  try {
    const { loadS21Config } = require('./config');
    const s21 = loadS21Config();
    for (const bot of s21.bots || []) {
      if (bot.botId && bot.symbol) BOT_SYMBOLS.set(bot.botId, bot.symbol);
    }
  } catch {}
  return BOT_SYMBOLS;
}

// Permissive signal parser. Matches legacy and S2.1 shapes both.
//   ENTER_LONG_BotN  / ENTER_SHORT_BotN
//   EXIT_LONG_BotN   / EXIT_SHORT_BotN
//   EXIT_BotN        (S2.1 direction-less)
// Returns { botId, action, direction } or null.
const SIGNAL_PATTERN = /^(ENTER_LONG|ENTER_SHORT|EXIT_LONG|EXIT_SHORT|EXIT)_(Bot\d+)$/i;

function _parseBotSignal(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return null;
  const m = SIGNAL_PATTERN.exec(rawBody.trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const botMatch = /^Bot(\d+)$/i.exec(m[2]);
  return {
    botId: `Bot${botMatch[1]}`,
    action: prefix.startsWith('ENTER') ? 'ENTER' : 'EXIT',
    direction: prefix.includes('LONG') ? 'LONG' : (prefix.includes('SHORT') ? 'SHORT' : null),
  };
}

function _classifySource(parsed, rawBody) {
  if (rawBody && String(rawBody).trim().toUpperCase() === 'S2_HEARTBEAT') return 'HEARTBEAT';
  if (!parsed) return 'UNPARSED';
  return _getS21BotIds().has(parsed.botId) ? 'S2_1' : 'S2_LEGACY';
}

function prepareAllSignalsData(persistence, options = {}) {
  const limit = options.limit || 100;
  // Master query: every webhook event the system has stored.
  const events = persistence.getRecentWebhookEvents
    ? persistence.getRecentWebhookEvents(limit)
    : persistence.getWebhookEvents().slice(-limit).reverse();

  // Build a lookup of S2.1 signal verdicts keyed by raw_body + received_at-window.
  // s2_1_signals received_at is set at insertion time, raw_webhook_events
  // received_at uses the parser's receivedAt — they're milliseconds apart.
  const s21Signals = persistence.getS21Signals
    ? persistence.getS21Signals({ limit: limit * 2, offset: 0 })
    : [];
  const s21ByRaw = new Map();
  for (const sig of s21Signals) {
    if (!sig.raw_body) continue;
    const key = sig.raw_body.trim();
    if (!s21ByRaw.has(key)) s21ByRaw.set(key, []);
    s21ByRaw.get(key).push(sig);
  }

  const rows = events.map(evt => {
    const parsed = _parseBotSignal(evt.raw_body);
    const source = _classifySource(parsed, evt.raw_body);

    // Look up S2.1 verdict if applicable
    let s21Match = null;
    if (source === 'S2_1' && evt.raw_body) {
      const candidates = s21ByRaw.get(evt.raw_body.trim()) || [];
      // Pick the closest s2_1_signals row by time (within 60s of webhook receipt)
      const evtMs = Date.parse(evt.received_at);
      for (const cand of candidates) {
        const candMs = Date.parse(cand.received_at);
        if (Number.isFinite(evtMs) && Number.isFinite(candMs) && Math.abs(candMs - evtMs) < 60000) {
          s21Match = cand;
          break;
        }
      }
    }

    let status;
    let statusDetail = null;
    if (source === 'HEARTBEAT') {
      status = 'HEARTBEAT';
    } else if (evt.auth_ok === 0) {
      status = 'UNAUTHORIZED';
      statusDetail = evt.error_message;
    } else if (source === 'S2_1' && s21Match) {
      if (s21Match.acted === 1) status = 'ACCEPTED';
      else if (s21Match.acted === 0) { status = 'REJECTED'; statusDetail = s21Match.reject_reason; }
      else status = 'PENDING';
    } else if (source === 'S2_1' && !s21Match) {
      // S2.1-bound but no matching s2_1_signals row — either pre-deploy or
      // the signal was deleted (shouldn't happen for S2.1 bots, but possible
      // if the bot was reclassified). Show as PROCESSED with note.
      status = 'PROCESSED';
      statusDetail = 'no s2_1_signals match';
    } else if (source === 'S2_LEGACY') {
      // Legacy bot — handled by S2 engine. The raw_webhook_events row only
      // tells us auth+parse status, not whether the legacy engine accepted.
      // For a deeper status we'd need to cross-reference order_attempts /
      // normalized_signals, but that's outside v1 scope.
      if (evt.parse_ok === 1 && !evt.error_message) status = 'PROCESSED';
      else if (evt.error_message) { status = 'ERROR'; statusDetail = evt.error_message; }
      else status = 'PROCESSED';
    } else {
      // UNPARSED
      status = evt.error_message ? 'PARSE_ERROR' : 'UNPARSED';
      statusDetail = evt.error_message;
    }

    const symbol = parsed ? (_getBotSymbols().get(parsed.botId) || null) : null;

    return {
      id: evt.id,
      received_at: evt.received_at,
      raw_body: evt.raw_body,
      source,
      bot_id: parsed ? parsed.botId : null,
      symbol,
      action: parsed ? parsed.action : null,
      direction: parsed ? parsed.direction : null,
      status,
      status_detail: statusDetail,
      auth_ok: evt.auth_ok,
      parse_ok: evt.parse_ok,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    timezone: 'Europe/Zurich',
    rows,
    count: rows.length,
  };
}

// ── HTML rendering ──────────────────────────────────────────────────────────

const ZURICH_FORMAT = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function _formatZurich(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const parts = ZURICH_FORMAT.formatToParts(d);
  const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
  return `${get('day')}.${get('month')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _renderRow(row) {
  const sourceChip = `sas-source-${row.source.toLowerCase()}`;
  const statusChip = `sas-status-${row.status.toLowerCase()}`;
  const direction = row.direction ? `<span class="sas-dir">${row.direction}</span>` : '';
  const detail = row.status_detail ? ` <span class="sas-detail">${_escape(row.status_detail)}</span>` : '';
  return `
    <div class="sas-row sas-row-${row.source.toLowerCase()}">
      <div class="sas-time">${_formatZurich(row.received_at)}</div>
      <div class="sas-source"><span class="sas-chip ${sourceChip}">${row.source.replace('_', ' ')}</span></div>
      <div class="sas-bot">${_escape(row.bot_id || '—')} ${row.action ? `<span class="sas-action">${row.action}</span>` : ''}${direction}</div>
      <div class="sas-token">${_escape(row.symbol || '—')}</div>
      <div class="sas-status"><span class="sas-chip ${statusChip}">${row.status}</span>${detail}</div>
      <div class="sas-raw">${_escape(row.raw_body || '—')}</div>
    </div>`;
}

function renderAllSignalsBody(data) {
  const rows = data.rows.length === 0
    ? `<div class="sas-empty">No webhook signals received yet.</div>`
    : data.rows.map(_renderRow).join('\n');

  // Source counts for the header summary
  const counts = data.rows.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});

  return `
    <div class="sas-wrap" id="sas-root">
      <div class="sas-head">
        <div>
          <div class="sas-title">S2 all Signal Log</div>
          <div class="sas-sub">Every webhook the system received. Last ${data.count} entries · refreshed ${_formatZurich(data.generated_at)}</div>
        </div>
      </div>

      <div class="sas-summary">
        <span class="sas-chip sas-source-s2_legacy">S2 LEGACY: ${counts.S2_LEGACY || 0}</span>
        <span class="sas-chip sas-source-s2_1">S2.1: ${counts.S2_1 || 0}</span>
        <span class="sas-chip sas-source-heartbeat">HEARTBEAT: ${counts.HEARTBEAT || 0}</span>
        <span class="sas-chip sas-source-unparsed">UNPARSED: ${counts.UNPARSED || 0}</span>
      </div>

      <div class="sas-list-head">
        <div>TIME (CH)</div><div>SOURCE</div><div>BOT</div><div>TOKEN</div><div>STATUS</div><div>RAW</div>
      </div>
      <div class="sas-list">${rows}</div>

      <div class="sas-foot">Polls every 60s. Times in Europe/Zurich. Legacy webhook details on the S2 page; S2.1 trade detail on the S2.1 page.</div>
    </div>
    <script>
      (function() {
        async function refresh() {
          try {
            const html = await fetch('/s2-all-signals?_t=' + Date.now());
            if (!html.ok) return;
            const body = await html.text();
            const m = body.match(/<div class="sas-wrap"[\\s\\S]*?<\\/script>/);
            if (m) document.getElementById('sas-root').outerHTML = m[0];
          } catch (e) { console.warn('[s2-all] poll failed', e); }
        }
        setInterval(refresh, 60000);
      })();
    </script>`;
}

const ALL_SIGNALS_CSS = `
  .sas-wrap { padding: 12px; max-width: 1100px; margin: 0 auto; }
  .sas-head { margin-bottom: 14px; }
  .sas-title { font-size: 20px; font-weight: 800; color: #e2e8f0; }
  .sas-sub { font-size: 11px; color: #64748b; margin-top: 2px; }

  .sas-summary { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }

  .sas-list-head, .sas-row {
    display: grid;
    grid-template-columns: 130px 95px 130px 110px 1fr 1.2fr;
    gap: 8px;
    padding: 8px 10px;
    align-items: center;
    font-size: 12px;
  }
  .sas-list-head {
    background: #0a0f1c; border: 1px solid #1f2937; border-radius: 6px 6px 0 0;
    font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .sas-list { background: #111827; border: 1px solid #1f2937; border-top: none; border-radius: 0 0 6px 6px; }
  .sas-row { border-top: 1px solid #1e293b; }
  .sas-row:first-child { border-top: none; }
  .sas-row-heartbeat { opacity: 0.55; }
  .sas-row-unparsed { opacity: 0.7; }
  .sas-row-s2_1 { background: #0c1729; }

  .sas-time { color: #94a3b8; font-family: 'SF Mono', Menlo, monospace; }
  .sas-bot { color: #e2e8f0; font-weight: 600; }
  .sas-action { color: #94a3b8; font-weight: 400; margin-left: 4px; font-size: 11px; }
  .sas-dir { color: #93c5fd; font-weight: 400; margin-left: 4px; font-size: 11px; }
  .sas-token { color: #c4b5fd; font-family: 'SF Mono', Menlo, monospace; font-size: 11px; font-weight: 600; }
  .sas-raw { color: #475569; font-family: 'SF Mono', Menlo, monospace; font-size: 10px; word-break: break-all; }
  .sas-detail { color: #fca5a5; font-size: 10px; margin-left: 4px; }

  .sas-chip { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 999px; display: inline-block; }
  .sas-source-s2_legacy { background: #1e293b; color: #cbd5e1; }
  .sas-source-s2_1      { background: #1e3a5f; color: #93c5fd; }
  .sas-source-heartbeat { background: #422006; color: #fde68a; }
  .sas-source-unparsed  { background: #3f3f46; color: #a1a1aa; }
  .sas-status-accepted     { background: #14532d; color: #bbf7d0; }
  .sas-status-rejected     { background: #7f1d1d; color: #fecaca; }
  .sas-status-pending      { background: #422006; color: #fde68a; }
  .sas-status-processed    { background: #1e293b; color: #cbd5e1; }
  .sas-status-heartbeat    { background: #422006; color: #fde68a; }
  .sas-status-unauthorized { background: #7f1d1d; color: #fecaca; }
  .sas-status-parse_error  { background: #7c2d12; color: #fed7aa; }
  .sas-status-unparsed     { background: #3f3f46; color: #a1a1aa; }
  .sas-status-error        { background: #7f1d1d; color: #fecaca; }

  .sas-empty { padding: 24px; text-align: center; color: #475569; font-size: 13px; }
  .sas-foot { text-align: center; font-size: 11px; color: #475569; margin-top: 14px; }

  @media (max-width: 700px) {
    .sas-list-head { display: none; }
    .sas-row { grid-template-columns: 1fr; gap: 4px; padding: 10px; }
    .sas-time { font-size: 11px; }
    .sas-raw { font-size: 10px; }
  }
`;

module.exports = {
  prepareAllSignalsData,
  renderAllSignalsBody,
  ALL_SIGNALS_CSS,
  // exposed for tests
  _parseBotSignal,
  _classifySource,
};
