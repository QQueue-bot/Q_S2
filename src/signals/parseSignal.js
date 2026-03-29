const ALLOWED_SIGNALS = ['ENTER_LONG', 'EXIT_LONG', 'ENTER_SHORT', 'EXIT_SHORT'];

function normalizeSignalToken(signal) {
  if (typeof signal !== 'string') return signal;
  return signal.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function normalizeBotToken(botToken) {
  if (typeof botToken !== 'string') {
    throw new Error('bot token must be a string');
  }
  const trimmed = botToken.trim();
  const match = /^bot(\d+)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid bot token: ${botToken}`);
  }
  return `Bot${match[1]}`;
}

function parseSignalString(rawSignal, options = {}) {
  if (typeof rawSignal !== 'string' || !rawSignal.trim()) {
    throw new Error('Signal input must be a non-empty string');
  }

  const trimmed = rawSignal.trim();
  const marker = '_BOT';
  const upper = trimmed.toUpperCase();
  const botIndex = upper.lastIndexOf(marker);

  if (botIndex <= 0) {
    throw new Error('Signal must follow the format SIGNAL_BotNumber');
  }

  const signalPart = trimmed.slice(0, botIndex);
  const botPart = trimmed.slice(botIndex + 1);

  const signal = normalizeSignalToken(signalPart);
  if (!ALLOWED_SIGNALS.includes(signal)) {
    throw new Error(`Unsupported signal: ${signalPart}`);
  }

  const botId = normalizeBotToken(botPart);
  const allowedBots = options.allowedBots;
  if (Array.isArray(allowedBots) && !allowedBots.includes(botId)) {
    throw new Error(`Bot is not allowed: ${botId}`);
  }

  return {
    signal,
    botId,
    receivedAt: new Date().toISOString(),
    raw: trimmed,
  };
}

module.exports = {
  ALLOWED_SIGNALS,
  parseSignalString,
  normalizeSignalToken,
  normalizeBotToken,
};
