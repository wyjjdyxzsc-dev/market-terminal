'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const policyCore = require('../shared/ai-task-policy-core.js');
const verification = require('../shared/ai-verification-core.js');

const NOW = '2026-07-26T12:00:00Z';
const EVIDENCE = [
  {
    id: 'ev_primary',
    title: 'Issuer publishes verified operating update',
    publisher: 'Issuer',
    publisherDomain: 'issuer.example',
    sourceUrl: 'https://issuer.example/update',
    publishedAt: '2026-07-26T11:45:00Z',
    sourceTier: 'primary',
  },
  {
    id: 'ev_reuters',
    title: 'Reuters reports the same operating update',
    publisher: 'Reuters',
    publisherDomain: 'reuters.com',
    sourceUrl: 'https://reuters.com/example',
    publishedAt: '2026-07-26T11:40:00Z',
    sourceTier: 'reputable-secondary',
  },
];

function preparation() {
  return policyCore.prepareTask('intel.situation', EVIDENCE, { now: NOW });
}

function provider(name, model, costUnits = 1) {
  return {
    name,
    tier: 'heavy',
    defaultModel: model,
    requestedModel: model,
    maxOutputTokens: 4_000,
    timeoutMs: 2_000,
    costUnits,
    pricing: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.2 },
    independentVerifierEligible: true,
  };
}

test('high-risk pipeline requires and records a different provider and model', async () => {
  const calls = [];
  const providers = [
    provider('gemini', 'gemini-3.6-flash'),
    provider('deepseek', 'deepseek-v4-flash'),
  ];
  const result = await verification.runVerifiedPipeline({
    preparation: preparation(),
    providers,
    system: 'Return a situation JSON object.',
    user: 'Use the supplied evidence.',
    validate: (data) => data && data.evidenceIds?.includes('ev_primary'),
    extractJson: JSON.parse,
    callProvider: async (selected, system) => {
      calls.push(selected.name);
      if (/independent factual verifier/i.test(system)) {
        return {
          text: JSON.stringify({
            status: 'pass',
            reason: 'All material claims are directly supported.',
            unsupportedClaims: [],
            evidenceIds: ['ev_primary', 'ev_reuters'],
          }),
          requestedModel: selected.defaultModel,
          servedModel: selected.defaultModel,
          usage: { prompt_tokens: 100, completion_tokens: 40 },
        };
      }
      return {
        text: JSON.stringify({
          threatLevel: 'Guarded',
          domains: [{ domain: 'Economic' }, { domain: 'Political' }, { domain: 'Military' }],
          defcon: 5,
          evidenceIds: ['ev_primary'],
        }),
        requestedModel: selected.defaultModel,
        servedModel: selected.defaultModel,
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      };
    },
  });
  const runtime = verification.getRuntimeMetadata(result);

  assert.deepEqual(calls, ['gemini', 'deepseek']);
  assert.equal(runtime.status, 'verified');
  assert.equal(runtime.generator.provider, 'gemini');
  assert.equal(runtime.verifier.provider, 'deepseek');
  assert.equal(runtime.verifier.status, 'passed');
  assert.equal(runtime.totals.providerCalls, 2);
  assert.equal(runtime.totals.withinBudget, true);
});

test('same underlying model family cannot independently verify itself', async () => {
  const providers = [
    provider('groq', 'openai/gpt-oss-120b'),
    provider('cfai', '@cf/openai/gpt-oss-120b'),
  ];

  await assert.rejects(
    verification.runVerifiedPipeline({
      preparation: preparation(),
      providers,
      system: 'Return JSON.',
      user: 'Use evidence.',
      validate: () => true,
      extractJson: JSON.parse,
      callProvider: async (selected) => ({
        text: JSON.stringify({ evidenceIds: ['ev_primary'] }),
        requestedModel: selected.defaultModel,
        servedModel: selected.defaultModel,
      }),
    }),
    (error) => error.code === 'verifier_unavailable' &&
      error.runtime?.verifier?.status === 'not-run'
  );
});

test('verifier selection skips a provider that cannot fit the remaining cost budget', async () => {
  const prep = preparation();
  prep.policy = {
    ...prep.policy,
    maxCostUnits: 2,
    maxEstimatedCostUsd: null,
  };
  const providers = [
    provider('gemini', 'gemini-3.6-flash', 1),
    provider('github', 'openai/gpt-4.1', 2),
    provider('deepseek', 'deepseek-v4-flash', 1),
  ];
  const calls = [];

  const result = await verification.runVerifiedPipeline({
    preparation: prep,
    providers,
    system: 'Return JSON.',
    user: 'Use evidence.',
    validate: () => true,
    extractJson: JSON.parse,
    callProvider: async (selected, system) => {
      calls.push(selected.name);
      return {
        text: /independent factual verifier/i.test(system)
          ? JSON.stringify({
            status: 'pass',
            reason: 'All cited evidence was checked.',
            unsupportedClaims: [],
            evidenceIds: ['ev_primary'],
          })
          : JSON.stringify({ evidenceIds: ['ev_primary'] }),
        requestedModel: selected.defaultModel,
        servedModel: selected.defaultModel,
      };
    },
  });

  assert.deepEqual(calls, ['gemini', 'deepseek']);
  assert.equal(verification.getRuntimeMetadata(result).verifier.provider, 'deepseek');
});

test('first valid independent rejection is authoritative', async () => {
  const providers = [
    provider('gemini', 'gemini-3.6-flash'),
    provider('deepseek', 'deepseek-v4-flash'),
    provider('cohere', 'command-a-plus-05-2026'),
  ];
  let callCount = 0;

  await assert.rejects(
    verification.runVerifiedPipeline({
      preparation: preparation(),
      providers,
      system: 'Return JSON.',
      user: 'Use evidence.',
      validate: () => true,
      extractJson: JSON.parse,
      callProvider: async (selected, system) => {
        callCount += 1;
        if (/independent factual verifier/i.test(system)) {
          return {
            text: JSON.stringify({
              status: 'reject',
              reason: 'A material causal claim is unsupported.',
              unsupportedClaims: [{ path: '$.overview', claim: 'Unsupported cause', reason: 'No evidence.' }],
              evidenceIds: ['ev_primary'],
            }),
            requestedModel: selected.defaultModel,
            servedModel: selected.defaultModel,
          };
        }
        return {
          text: JSON.stringify({ evidenceIds: ['ev_primary'], overview: 'Unsupported cause.' }),
          requestedModel: selected.defaultModel,
          servedModel: selected.defaultModel,
        };
      },
    }),
    (error) => error.code === 'verifier_rejected' &&
      error.runtime?.verifier?.unsupportedClaimCount === 1
  );
  assert.equal(callCount, 2);
});

test('input and provider-call budgets fail closed', async () => {
  const prep = preparation();
  prep.policy = {
    ...prep.policy,
    maxInputTokens: 2,
    maxProviderCalls: 1,
    maxCostUnits: 1,
  };

  await assert.rejects(
    verification.runVerifiedPipeline({
      preparation: prep,
      providers: [provider('gemini', 'gemini-3.6-flash')],
      system: 'This prompt is deliberately longer than two estimated tokens.',
      user: 'Reject it before a provider call.',
      validate: () => true,
      extractJson: JSON.parse,
      callProvider: async () => {
        throw new Error('should not run');
      },
    }),
    (error) => error.code === 'input_token_budget_exceeded' &&
      error.runtime?.status === 'failed' &&
      error.runtime?.failureCode === 'input_token_budget_exceeded' &&
      error.runtime?.totals?.providerCalls === 0
  );
});

test('model identity canonicalization detects broker and host aliases', () => {
  assert.equal(
    verification.canonicalModelIdentity('@cf/openai/gpt-oss-120b'),
    verification.canonicalModelIdentity('openai/gpt-oss-120b:fastest')
  );
  assert.equal(
    verification.modelsAreIndependent(
      { name: 'groq', servedModel: 'openai/gpt-oss-120b' },
      { name: 'cfai', servedModel: '@cf/openai/gpt-oss-120b' }
    ),
    false
  );
});

test('a passing verifier must cover every evidence ID cited by the candidate', () => {
  const candidate = {
    evidenceIds: ['ev_primary'],
    domains: [{ evidenceIds: ['ev_reuters'] }],
  };
  const required = verification.collectCandidateEvidenceIds(candidate);

  assert.deepEqual(required.sort(), ['ev_primary', 'ev_reuters']);
  assert.equal(verification.validateVerifierVerdict({
    status: 'pass',
    reason: 'Checked only one citation.',
    unsupportedClaims: [],
    evidenceIds: ['ev_primary'],
  }, ['ev_primary', 'ev_reuters'], required), false);
  assert.equal(verification.validateVerifierVerdict({
    status: 'pass',
    reason: 'Checked every cited record.',
    unsupportedClaims: [],
    evidenceIds: ['ev_primary', 'ev_reuters'],
  }, ['ev_primary', 'ev_reuters'], required), true);
});
