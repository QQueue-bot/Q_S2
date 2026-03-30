#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { resolveBotSettings } = require('../src/config/resolveBotSettings');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');
const bot1 = resolveBotSettings('Bot1', { registryPath });

const brokenRegistryPath = '/tmp/qs2_broken_mdx_runtime_registry.json';
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const registryDir = path.dirname(registryPath);
registry.bots[0].settingsRef = path.resolve(registryDir, registry.bots[0].settingsRef);
registry.bots[0].mdxSourceRef = '../mdx/DoesNotExist.source.json';
fs.writeFileSync(brokenRegistryPath, JSON.stringify(registry, null, 2));

let brokenError = null;
try {
  resolveBotSettings('Bot1', { registryPath: brokenRegistryPath });
} catch (error) {
  brokenError = error.message;
}

console.log(JSON.stringify({
  bot1: {
    botId: bot1.bot.botId,
    mdx: bot1.mdx,
    leverage: bot1.settings.positionSizing.leverage,
    breakEven: bot1.settings.breakEven,
    takeProfit: bot1.settings.takeProfit,
    stopLoss: bot1.settings.stopLoss,
  },
  brokenError,
}, null, 2));

if (!bot1.mdx?.enabled) process.exit(1);
if (bot1.mdx.profile !== 'balanced') process.exit(1);
if (bot1.settings.positionSizing.leverage !== 4) process.exit(1);
if (bot1.settings.breakEven.triggerPercent !== 4.27) process.exit(1);
if (bot1.settings.stopLoss.triggerPercent !== 6) process.exit(1);
if (!brokenError || !brokenError.includes('MDX source file not found')) process.exit(1);
