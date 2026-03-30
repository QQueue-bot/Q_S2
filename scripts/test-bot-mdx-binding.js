#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadBotRegistry } = require('../src/config/botRegistry');
const { resolveBotMdxSource } = require('../src/config/resolveBotMdxSource');

const registryPath = path.join(__dirname, '..', 'config', 'bots.json');
const registry = loadBotRegistry(registryPath);
const bindings = registry.bots.map(bot => resolveBotMdxSource(bot.botId, { registryPath }));

const brokenRegistryPath = '/tmp/qs2_broken_mdx_binding.json';
const brokenRegistry = JSON.parse(JSON.stringify(registry));
brokenRegistry.bots[1].mdxSourceRef = './mdx/DoesNotExist.source.json';
fs.writeFileSync(brokenRegistryPath, JSON.stringify(brokenRegistry, null, 2));

let brokenBindingError = null;
try {
  resolveBotMdxSource('Bot2', { registryPath: brokenRegistryPath });
} catch (error) {
  brokenBindingError = error.message;
}

console.log(JSON.stringify({
  botCount: registry.bots.length,
  bindings,
  brokenBindingError,
}, null, 2));

if (registry.bots.length !== 8) process.exit(1);
if (new Set(bindings.map(item => item.sourcePath)).size !== 8) process.exit(1);
if (!brokenBindingError || !brokenBindingError.includes('MDX source file not found')) process.exit(1);
