#!/usr/bin/env node
const { resolveDcaStrategy } = require('../src/config/resolveDcaStrategy');
const { validateDcaStrategy } = require('../src/config/validateDcaStrategy');

const strategy = resolveDcaStrategy();
const validation = validateDcaStrategy(strategy);

const broken = JSON.parse(JSON.stringify(strategy));
broken.entries.initialEntryPercent = 60;
broken.entries.addEntryPercent = 50;
const brokenValidation = validateDcaStrategy(broken);

console.log(JSON.stringify({
  strategy,
  validation,
  brokenValidation,
}, null, 2));

if (!validation.ok) process.exit(1);
if (brokenValidation.ok) process.exit(1);
if (!brokenValidation.errors.some(error => error.includes('total exactly 100'))) process.exit(1);
