'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const evaluation = require('../shared/ai-evaluation-core.js');

const suite = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'ai-eval-2026-07-26a.json'),
  'utf8'
));

test('versioned offline AI golden fixtures meet declared safety thresholds', () => {
  const report = evaluation.evaluateGoldenFixtures(suite);

  assert.equal(report.mode, 'offline-recorded-policy-fixtures');
  assert.equal(report.metrics.fixtureCount, 10);
  assert.equal(report.metrics.schemaPassRate, 1);
  assert.equal(report.metrics.evidencePrecision, 1);
  assert.equal(report.metrics.unsupportedClaimRate, 0);
  assert.equal(report.metrics.entityTickerPrecision, 1);
  assert.equal(report.metrics.timestampAccuracy, 1);
  assert.equal(report.metrics.duplicateRate, 0);
  assert.equal(report.metrics.abstentionAccuracy, 1);
  assert.equal(report.metrics.verifierRejectionAccuracy, 1);
  assert.equal(report.metrics.decisionAccuracy, 1);
  assert.equal(report.thresholdsPassed, true);
  assert.deepEqual(report.thresholdFailures, []);
});

test('golden evaluator reports threshold regressions instead of hiding them', () => {
  const broken = JSON.parse(JSON.stringify(suite));
  broken.cases[0].observed.claims[0].supported = false;
  const report = evaluation.evaluateGoldenFixtures(broken);

  assert.equal(report.thresholdsPassed, false);
  assert.ok(report.thresholdFailures.some((failure) => failure.metric === 'unsupportedClaimRate'));
});

test('golden evaluator fails closed when budget observations are absent', () => {
  const incomplete = JSON.parse(JSON.stringify(suite));
  delete incomplete.cases[0].observed.maxLatencyMs;
  delete incomplete.cases[1].observed.totalTokens;
  delete incomplete.cases[2].observed.costUnits;
  const report = evaluation.evaluateGoldenFixtures(incomplete);

  assert.equal(report.metrics.latencyBudgetPassRate, 0.9);
  assert.equal(report.metrics.tokenBudgetPassRate, 0.9);
  assert.equal(report.metrics.costBudgetPassRate, 0.9);
  assert.equal(report.thresholdsPassed, false);
  assert.deepEqual(
    report.thresholdFailures.map((failure) => failure.metric).sort(),
    ['costBudgetPassRate', 'latencyBudgetPassRate', 'tokenBudgetPassRate']
  );
});
