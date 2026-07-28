'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../shared/ai-provider-registry.js');

test('shared registry exposes current documented defaults and disables obsolete endpoints', () => {
  assert.equal(registry.getProvider('groq').defaultModel, 'openai/gpt-oss-120b');
  assert.equal(registry.getProvider('gemini').defaultModel, 'gemini-3.6-flash');
  assert.equal(registry.getProvider('deepseek').defaultModel, 'deepseek-v4-flash');
  assert.equal(registry.getProvider('cohere').defaultModel, 'command-a-plus-05-2026');
  assert.equal(registry.getProvider('together').defaultModel, 'openai/gpt-oss-120b');
  assert.equal(registry.getProvider('nebius').lifecycle.status, 'disabled-unverified');
  assert.equal(registry.getProvider('octoai').lifecycle.status, 'retired');
  assert.equal(registry.isActive(registry.getProvider('octoai')), false);
});

test('high-risk verifier candidates exclude opaque routers and speed models', () => {
  const providers = registry.listProviders({
    runtime: 'worker',
    tier: 'heavy',
    riskClass: 'high',
    independentVerifier: true,
  });
  const names = providers.map((provider) => provider.name);

  assert.ok(names.includes('gemini'));
  assert.ok(names.includes('deepseek'));
  assert.ok(names.includes('cfai'));
  assert.ok(!names.includes('openrouter'));
  assert.ok(!names.includes('huggingface'));
  assert.ok(!names.includes('groq'));
});

test('provider health snapshots preserve bounded operational state', () => {
  const state = registry.createProviderHealthState();
  registry.recordProviderAttempt(state, 'gemini', Date.parse('2026-07-26T10:00:00Z'));
  registry.recordProviderFailure(state, 'gemini', 'quota details should remain concise', Date.parse('2026-07-26T10:00:01Z'));
  registry.recordProviderCooldown(state, 'gemini', Date.parse('2026-07-26T10:01:00Z'));
  const snapshot = registry.providerHealthSnapshot(registry.getProvider('gemini'), state, {
    configured: true,
    requestedModel: 'gemini-3.6-flash',
  });

  assert.equal(snapshot.attempts, 1);
  assert.equal(snapshot.failures, 1);
  assert.equal(snapshot.requestedModel, 'gemini-3.6-flash');
  assert.match(snapshot.lastFailureReason, /quota details/);
  assert.equal(snapshot.cooldownUntil, '2026-07-26T10:01:00.000Z');
});
