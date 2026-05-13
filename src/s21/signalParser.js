'use strict';

// S2.1 signal parser.
//
// Accepts a superset of the legacy parseSignalString format so MDX can emit
// direction-less EXIT signals for S2.1 (the open trade has a known direction
// in our DB, so re-encoding it in the webhook is redundant).
//
// Accepted formats:
//   ENTER_LONG_BotN     → { action: 'ENTER', direction: 'LONG',  botId }
//   ENTER_SHORT_BotN    → { action: 'ENTER', direction: 'SHORT', botId }
//   EXIT_BotN           → { action: 'EXIT',  direction: null,    botId }
//   EXIT_LONG_BotN      → { action: 'EXIT',  direction: 'LONG',  botId } (compat)
//   EXIT_SHORT_BotN     → { action: 'EXIT',  direction: 'SHORT', botId } (compat)
//
// Throws on anything else. The webhook handler distinguishes "S2.1 parse
// error" (forensic value, keep s2_1_signals row) from "legacy signal that
// happens to not parse here" (delete row, fall through).

const PATTERN = /^(ENTER_LONG|ENTER_SHORT|EXIT_LONG|EXIT_SHORT|EXIT)_(Bot\d+)$/i;

function parseS21Signal(rawSignal) {
  if (typeof rawSignal !== 'string') {
    throw new Error('S2.1 signal must be a string');
  }
  const trimmed = rawSignal.trim();
  if (!trimmed) throw new Error('S2.1 signal must be non-empty');

  const m = PATTERN.exec(trimmed);
  if (!m) {
    throw new Error(`S2.1 signal must match (ENTER_LONG|ENTER_SHORT|EXIT|EXIT_LONG|EXIT_SHORT)_BotN, got: ${trimmed}`);
  }

  const prefix = m[1].toUpperCase();
  const botMatch = /^Bot(\d+)$/i.exec(m[2]);
  const botId = `Bot${botMatch[1]}`;

  const action = prefix.startsWith('ENTER') ? 'ENTER' : 'EXIT';
  const direction = prefix.includes('LONG') ? 'LONG' : (prefix.includes('SHORT') ? 'SHORT' : null);

  return { action, direction, botId, raw: trimmed };
}

module.exports = { parseS21Signal, PATTERN };
