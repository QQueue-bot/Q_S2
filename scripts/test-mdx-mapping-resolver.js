#!/usr/bin/env node
const fs = require('fs');
const { resolveMdxSettings } = require('../src/config/resolveMdxSettings');

const balanced = resolveMdxSettings();
const safe = resolveMdxSettings({ profile: 'safe' });
const aggressive = resolveMdxSettings({ profile: 'aggressive' });

const brokenPath = '/tmp/mdx-broken-source.json';
fs.writeFileSync(brokenPath, JSON.stringify({
  botMeta: { botName: 'Broken', asset: 'BROKENUSDT' },
  defaultProfile: 'balanced',
  profiles: {
    balanced: {
      strategy: {
        tpTargetsPercent: [1, 2, 3],
        tpAllocationsPercent: [10, 20, 30],
        stopLossPercent: 6,
        slToBeTrigger: 'TP1',
        leverage: 4
      }
    }
  }
}, null, 2));

let malformedError = null;
try {
  resolveMdxSettings({ sourcePath: brokenPath });
} catch (error) {
  malformedError = error.message;
}

console.log(JSON.stringify({
  balanced,
  safe,
  aggressive,
  malformedError,
}, null, 2));

if (balanced.selectedProfile !== 'balanced') process.exit(1);
if (safe.selectedProfile !== 'safe') process.exit(1);
if (aggressive.selectedProfile !== 'aggressive') process.exit(1);
if (balanced.runtimeSettings.breakEven.triggerPercent !== 4.27) process.exit(1);
if (safe.runtimeSettings.breakEven.triggerPercent !== 3.74) process.exit(1);
if (aggressive.runtimeSettings.breakEven.triggerPercent !== 4.51) process.exit(1);
if (!malformedError) process.exit(1);
