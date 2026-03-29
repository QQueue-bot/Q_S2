#!/usr/bin/env node
const fs = require('fs');
const { resolveMdxSettings } = require('../src/config/resolveMdxSettings');
const { validateMdxRuntimeSettings } = require('../src/config/validateMdxRuntimeSettings');

const valid = validateMdxRuntimeSettings(resolveMdxSettings());

const badAllocationPath = '/tmp/mdx-bad-allocation.json';
const source = JSON.parse(fs.readFileSync('mdx/Bot1.source.json', 'utf8'));
source.profiles.balanced.strategy.tpAllocationsPercent = [8, 40, 12, 12, 14, 10];
fs.writeFileSync(badAllocationPath, JSON.stringify(source, null, 2));
const badAllocation = validateMdxRuntimeSettings(resolveMdxSettings({ sourcePath: badAllocationPath }));

const badOrderingPath = '/tmp/mdx-bad-ordering.json';
const source2 = JSON.parse(fs.readFileSync('mdx/Bot1.source.json', 'utf8'));
source2.profiles.balanced.strategy.tpTargetsPercent = [4.27, 4.0, 9.91, 15.03, 33.21, 53.87];
fs.writeFileSync(badOrderingPath, JSON.stringify(source2, null, 2));
const badOrdering = validateMdxRuntimeSettings(resolveMdxSettings({ sourcePath: badOrderingPath }));

const badBreakEvenPath = '/tmp/mdx-bad-breakeven.json';
const source3 = JSON.parse(fs.readFileSync('mdx/Bot1.source.json', 'utf8'));
source3.profiles.balanced.strategy.slToBeTrigger = 'TP2';
fs.writeFileSync(badBreakEvenPath, JSON.stringify(source3, null, 2));
let badBreakEvenError = null;
try {
  resolveMdxSettings({ sourcePath: badBreakEvenPath });
} catch (error) {
  badBreakEvenError = error.message;
}

console.log(JSON.stringify({
  valid,
  badAllocation,
  badOrdering,
  badBreakEvenError,
}, null, 2));

if (!valid.ok) process.exit(1);
if (badAllocation.ok) process.exit(1);
if (!badAllocation.errors.some(error => error.includes('total exactly 100'))) process.exit(1);
if (badOrdering.ok) process.exit(1);
if (!badOrdering.errors.some(error => error.includes('strictly increasing'))) process.exit(1);
if (!badBreakEvenError || !badBreakEvenError.includes('Unsupported SL to BE trigger')) process.exit(1);
