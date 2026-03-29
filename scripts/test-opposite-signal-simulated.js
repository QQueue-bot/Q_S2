#!/usr/bin/env node
const { isOppositePosition } = require('../src/execution/bybitExecution');

function simulate(parsedSignal, livePositionSide, closeOk = true) {
  const opposite = isOppositePosition(parsedSignal.signal, livePositionSide);
  if (!opposite) {
    return {
      ok: true,
      oppositeDetected: false,
      closeAttempted: false,
      newEntryAllowed: true,
    };
  }

  return {
    ok: closeOk,
    oppositeDetected: true,
    closeAttempted: true,
    closeSucceeded: closeOk,
    newEntryAllowed: closeOk,
    abortedNewEntry: !closeOk,
  };
}

const passCase = simulate({ signal: 'ENTER_SHORT', botId: 'Bot1' }, 'Buy', true);
const failCase = simulate({ signal: 'ENTER_SHORT', botId: 'Bot1' }, 'Buy', false);
const nonOppositeCase = simulate({ signal: 'ENTER_LONG', botId: 'Bot1' }, 'Buy', true);

console.log(JSON.stringify({
  passCase,
  failCase,
  nonOppositeCase,
}, null, 2));

if (!passCase.newEntryAllowed || !failCase.abortedNewEntry || !nonOppositeCase.ok) {
  process.exit(1);
}
