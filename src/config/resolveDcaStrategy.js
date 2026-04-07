function resolveDcaStrategy(options = {}) {
  const profile = options.profile || 'balanced';
  const bot = options.bot || null;
  const botDcaEnabled = typeof bot?.dcaPolicy?.enabled === 'boolean'
    ? bot.dcaPolicy.enabled
    : false;

  const strategy = {
    enabled: botDcaEnabled,
    mode: 'impulse_aware_confirmation',
    profile,
    entries: {
      initialEntryPercent: 50,
      addEntryPercent: 50,
      maxAdds: 1,
    },
    impulseDetection: {
      enabled: true,
      lookbackCandles: 10,
      rangeMultiplier: 1.5,
    },
    addTiming: {
      minDelayCandles: 1,
      maxDelayCandles: 2,
    },
    guards: {
      blockIfBreakEvenArmed: true,
      blockIfTakeProfitStarted: true,
      blockIfOppositeSignal: true,
      blockIfRegimeInvalid: true,
    },
    stopBehavior: {
      alterStopOnAdd: false,
      notes: 'DCA does not alter stop structure in Candidate A.',
    },
    policy: {
      source: 'bot.dcaPolicy.enabled',
      defaultOff: true,
      botId: bot?.botId || null,
    },
  };

  return strategy;
}

module.exports = {
  resolveDcaStrategy,
};
