'use strict';

// S2.1 Telegram alerts.
//
// No-op by design when TELEGRAM_BOT_TOKEN or TELEGRAM_S21_CHAT_ID is unset —
// allows PR 1–5 deploys to ship without breaking before the chat ID exists.
// Once both env vars are set the next webhook restart picks them up.
//
// All sends are fire-and-forget: errors are logged but never thrown, so a
// Telegram outage can never break the trade lifecycle.

const TELEGRAM_API = 'https://api.telegram.org';

function createTelegramAlerts({ botToken, chatId, logger = console, _fetch } = {}) {
  if (!botToken || !chatId) {
    return {
      enabled: false,
      send: async () => {},
    };
  }

  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  const fetchFn = _fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) {
    logger.warn('[s2.1-telegram] no fetch available — alerts disabled');
    return { enabled: false, send: async () => {} };
  }

  async function send(message) {
    if (typeof message !== 'string' || !message.trim()) return;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn('[s2.1-telegram] non-2xx response', {
          status: res.status,
          body: body.slice(0, 200),
          message: message.slice(0, 80),
        });
      }
    } catch (err) {
      logger.warn('[s2.1-telegram] send failed (swallowed)', { error: err.message });
    }
  }

  return { enabled: true, send };
}

module.exports = { createTelegramAlerts, TELEGRAM_API };
