#!/usr/bin/env node
const path = require('path');
const { resolveMdxSettings } = require('../src/config/resolveMdxSettings');
const { validateMdxRuntimeSettings } = require('../src/config/validateMdxRuntimeSettings');
const { resolveBotSettings } = require('../src/config/resolveBotSettings');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');

const tp1 = resolveMdxSettings({ sourcePath: path.join(__dirname, '..', 'mdx', 'Bot1.source.json') });
const tp2 = resolveMdxSettings({ sourcePath: path.join(__dirname, '..', 'mdx', 'Bot7.source.json') });
const tp3 = resolveMdxSettings({ sourcePath: path.join(__dirname, '..', 'mdx', 'Bot3.source.json') });

const bot3 = resolveBotSettings('Bot3', { registryPath });
const bot5 = resolveBotSettings('Bot5', { registryPath });
const bot7 = resolveBotSettings('Bot7', { registryPath });

let unsupportedError = null;
try {
  resolveMdxSettings({
    sourcePath: path.join(__dirname, '..', 'mdx', 'Bot1.source.json'),
    profile: 'balanced',
    override: undefined,
  });
  const broken = JSON.parse(JSON.stringify(require('../mdx/Bot1.source.json')));
  broken.profiles.balanced.strategy.slToBeTrigger = 'TP4';
} catch (error) {
  unsupportedError = error.message;
}

console.log(JSON.stringify({
  tp1BreakEven: tp1.runtimeSettings.breakEven,
  tp2BreakEven: tp2.runtimeSettings.breakEven,
  tp3BreakEven: tp3.runtimeSettings.breakEven,
  bot3: { ok: true, breakEven: bot3.settings.breakEven.triggerPercent, profile: bot3.mdx.profile },
  bot5: { ok: true, breakEven: bot5.settings.breakEven.triggerPercent, profile: bot5.mdx.profile },
  bot7: { ok: true, breakEven: bot7.settings.breakEven.triggerPercent, profile: bot7.mdx.profile },
  validations: {
    tp1: validateMdxRuntimeSettings(tp1),
    tp2: validateMdxRuntimeSettings(tp2),
    tp3: validateMdxRuntimeSettings(tp3)
  }
}, null, 2));

if (tp1.runtimeSettings.breakEven.triggerPercent !== 4.27) process.exit(1);
if (tp2.runtimeSettings.breakEven.triggerPercent !== 6.29) process.exit(1);
if (tp3.runtimeSettings.breakEven.triggerPercent !== 1.73) process.exit(1);
if (bot3.settings.breakEven.triggerPercent !== 1.73) process.exit(1);
if (bot5.settings.breakEven.triggerPercent !== 9.26) process.exit(1);
if (bot7.settings.breakEven.triggerPercent !== 6.29) process.exit(1);
if (!validateMdxRuntimeSettings(tp2).ok) process.exit(1);
if (!validateMdxRuntimeSettings(tp3).ok) process.exit(1);
