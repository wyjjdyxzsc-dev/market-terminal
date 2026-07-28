'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { evaluateGoldenFixtures } = require('../shared/ai-evaluation-core.js');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'ai-eval-2026-07-26a.json');
const suite = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const report = evaluateGoldenFixtures(suite);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.thresholdsPassed) process.exitCode = 1;
