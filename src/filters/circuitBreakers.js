'use strict';
/**
 * src/filters/circuitBreakers.js
 *
 * Pluggable filter gate for the LIVE MDX execution path.
 *
 * Design mirrors the spec's Python reference exactly:
 *   - FilterRule  : base class; evaluate() decides allow/reject, onOutcome() mutates state
 *   - SkipWednesdayRule       : reject signals that arrive on a Wednesday (UTC)
 *   - SkipAfterNLossesRule(n) : reject once `n` consecutive losing trades have been recorded
 *   - FilterGate  : chains rules, first reject wins, per-bot state persisted to JSON
 *
 * Swapping the rule list is the only change required to alter filtering.
 * The live signal handler only calls gate.shouldTake(signalTimeUtc) and,
 * when a live trade closes, gate.recordOutcome(pnlPct).
 */

const fs = require('fs');
const path = require('path');

class FilterRule {
  /** @type {string} */
  name = 'base';

  // eslint-disable-next-line no-unused-vars
  evaluate(signalTimeUtc, state) {
    throw new Error('FilterRule.evaluate must be implemented');
  }

  // Called when a trade closes. Returns updated state. Default: unchanged.
  // eslint-disable-next-line no-unused-vars
  onOutcome(pnlPct, state) {
    return state;
  }
}

class SkipWednesdayRule extends FilterRule {
  name = 'skip_wednesday';

  // signalTimeUtc: Date (UTC). JS getUTCDay(): Sun=0..Sat=6 → Wednesday=3.
  evaluate(signalTimeUtc, _state) {
    if (signalTimeUtc.getUTCDay() === 3) {
      return [false, 'skip_wednesday'];
    }
    return [true, null];
  }
}

class SkipAfterNLossesRule extends FilterRule {
  name = 'skip_after_n_losses';

  constructor(n = 2) {
    super();
    this.n = n;
  }

  evaluate(_signalTimeUtc, state) {
    if ((state.consecutive_losses || 0) >= this.n) {
      return [false, `skip_after_${this.n}L`];
    }
    return [true, null];
  }

  onOutcome(pnlPct, state) {
    const next = { ...state };
    if (pnlPct < 0) {
      next.consecutive_losses = (next.consecutive_losses || 0) + 1;
    } else {
      next.consecutive_losses = 0;
    }
    return next;
  }
}

class FilterGate {
  /**
   * @param {string} botId
   * @param {FilterRule[]} rules
   * @param {string} stateDir  directory holding <botId>.json
   */
  constructor(botId, rules, stateDir) {
    this.botId = botId;
    this.rules = rules;
    this.stateDir = stateDir;
    this.statePath = path.join(stateDir, `${botId}.json`);
    this.state = this._loadState();
  }

  _loadState() {
    try {
      if (fs.existsSync(this.statePath)) {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      }
    } catch (e) {
      // Corrupt/unreadable state must never crash the live path — start clean.
      return {};
    }
    return {};
  }

  _saveState() {
    fs.mkdirSync(this.stateDir, { recursive: true });
    // Atomic write: temp + rename so a concurrent reader never sees a partial file.
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.statePath);
  }

  /**
   * Evaluate all rules in order. First reject wins.
   * @param {Date} signalTimeUtc
   * @returns {[boolean, string|null]} [allow, reason]
   */
  shouldTake(signalTimeUtc) {
    for (const rule of this.rules) {
      const [allow, reason] = rule.evaluate(signalTimeUtc, this.state);
      if (!allow) {
        // skip_after_NL CONSUMES the skip: counter resets so the NEXT signal is taken.
        if (reason && reason.startsWith('skip_after_')) {
          this.state.consecutive_losses = 0;
        }
        this._saveState();
        return [false, reason];
      }
    }
    return [true, null];
  }

  /** Update state for all rules after a LIVE trade closes. */
  recordOutcome(pnlPct) {
    for (const rule of this.rules) {
      this.state = rule.onOutcome(pnlPct, this.state);
    }
    this._saveState();
  }

  /** Snapshot of current state (for the verbose first-decision audit + DB column). */
  snapshot() {
    return { ...this.state };
  }
}

// Default production configuration: Skip-Wednesday + Skip-after-2-consecutive-losses.
function buildDefaultGate(botId, stateDir) {
  return new FilterGate(
    botId,
    [new SkipWednesdayRule(), new SkipAfterNLossesRule(2)],
    stateDir,
  );
}

module.exports = {
  FilterRule,
  SkipWednesdayRule,
  SkipAfterNLossesRule,
  FilterGate,
  buildDefaultGate,
};
