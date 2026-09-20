(() => {
  'use strict';

  const AI_PROVIDER_REGISTRY_SCHEMA_VERSION = '2026-07-26a';

  function freezeProvider(provider) {
    return Object.freeze({
      ...provider,
      runtimes: Object.freeze(provider.runtimes || ['node', 'worker']),
      capabilities: Object.freeze(provider.capabilities || ['chat', 'json']),
      eligibleRiskClasses: Object.freeze(provider.eligibleRiskClasses || ['low', 'medium']),
      pricing: provider.pricing ? Object.freeze({ ...provider.pricing }) : null,
      lifecycle: Object.freeze({ ...(provider.lifecycle || {}) }),
    });
  }

  const PROVIDERS = Object.freeze([
    freezeProvider({
      name: 'groq',
      tier: 'speed',
      envKey: 'GROQ_API_KEY',
      modelEnv: 'GROQ_MODEL',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      format: 'openai',
      defaultModel: 'openai/gpt-oss-120b',
      contextWindowTokens: 131_072,
      maxOutputTokens: 65_536,
      // gpt-oss reasoning tokens are billed against max_tokens. At the default
      // effort a 60-headline NEWS batch spends ~2.5k tokens reasoning, overruns
      // the shared 4k race ceiling, and Groq's JSON mode rejects the truncated
      // output (400 "Failed to validate JSON"). Low effort keeps it well inside.
      reasoningEffort: 'low',
      timeoutMs: 15_000,
      costTier: 'low',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.60 },
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['low', 'medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://console.groq.com/docs/models',
        note: 'Migrated from llama-3.3-70b-versatile before its announced shutdown.',
      },
    }),
    freezeProvider({
      name: 'cerebras',
      tier: 'speed',
      envKey: 'CEREBRAS_API_KEY',
      modelEnv: 'CEREBRAS_MODEL',
      endpoint: 'https://api.cerebras.ai/v1/chat/completions',
      format: 'openai',
      outputTokenParam: 'max_completion_tokens',
      defaultModel: 'gpt-oss-120b',
      contextWindowTokens: 131_072,
      maxOutputTokens: 40_960,
      timeoutMs: 15_000,
      costTier: 'low',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0.35, outputPerMillionUsd: 0.75 },
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['low', 'medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://inference-docs.cerebras.ai/api-reference/models/public-models',
      },
    }),
    freezeProvider({
      name: 'sambanova',
      tier: 'speed',
      envKey: 'SAMBANOVA_API_KEY',
      modelEnv: 'SAMBANOVA_MODEL',
      endpoint: 'https://api.sambanova.ai/v1/chat/completions',
      format: 'openai',
      defaultModel: 'Meta-Llama-3.3-70B-Instruct',
      contextWindowTokens: 131_072,
      maxOutputTokens: 8_192,
      timeoutMs: 18_000,
      costTier: 'unknown',
      costUnits: 2,
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['low', 'medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://docs.sambanova.ai/docs/en/get-started/quickstart',
      },
    }),
    freezeProvider({
      name: 'together',
      tier: 'speed',
      envKey: 'TOGETHER_API_KEY',
      modelEnv: 'TOGETHER_MODEL',
      endpoint: 'https://api.together.xyz/v1/chat/completions',
      format: 'openai',
      defaultModel: 'openai/gpt-oss-120b',
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_768,
      timeoutMs: 18_000,
      costTier: 'low',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.60 },
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['low', 'medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://docs.together.ai/docs/serverless/models',
        note: 'Replaced the retired Llama 3.3 free endpoint.',
      },
    }),
    freezeProvider({
      name: 'mistral',
      tier: 'speed',
      envKey: 'MISTRAL_API_KEY',
      modelEnv: 'MISTRAL_MODEL',
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      format: 'openai',
      defaultModel: 'mistral-large-latest',
      contextWindowTokens: 131_072,
      maxOutputTokens: 8_192,
      timeoutMs: 18_000,
      costTier: 'medium',
      costUnits: 2,
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['low', 'medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'active-alias',
        checkedAt: '2026-07-26',
        source: 'https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request',
        note: 'Operator can pin MISTRAL_MODEL to a dated model for stricter reproducibility.',
      },
    }),
    freezeProvider({
      name: 'gemini',
      tier: 'heavy',
      envKey: 'GEMINI_API_KEY',
      modelEnv: 'GEMINI_MODEL',
      format: 'gemini',
      defaultModel: 'gemini-3.6-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      timeoutMs: 25_000,
      costTier: 'high',
      costUnits: 3,
      pricing: { inputPerMillionUsd: 1.50, outputPerMillionUsd: 7.50 },
      capabilities: ['chat', 'json', 'usage', 'structured-output', 'reasoning'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      supportsSamplingParameters: false,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://ai.google.dev/gemini-api/docs/latest-model',
        note: 'Migrated from gemini-2.0-flash after its 2026-06-01 shutdown.',
      },
    }),
    freezeProvider({
      name: 'deepseek',
      tier: 'heavy',
      envKey: 'DEEPSEEK_API_KEY',
      modelEnv: 'DEEPSEEK_MODEL',
      endpoint: 'https://api.deepseek.com/chat/completions',
      format: 'openai',
      defaultModel: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      timeoutMs: 25_000,
      costTier: 'low',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28 },
      capabilities: ['chat', 'json', 'usage', 'structured-output', 'reasoning'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://api-docs.deepseek.com/news/news260424/',
        note: 'Migrated from deepseek-chat after its 2026-07-24 retirement.',
      },
    }),
    freezeProvider({
      name: 'cohere',
      tier: 'heavy',
      envKey: 'COHERE_API_KEY',
      modelEnv: 'COHERE_MODEL',
      endpoint: 'https://api.cohere.com/v2/chat',
      format: 'cohere',
      defaultModel: 'command-a-plus-05-2026',
      contextWindowTokens: 128_000,
      maxOutputTokens: 65_536,
      timeoutMs: 25_000,
      costTier: 'contract',
      costUnits: 3,
      capabilities: ['chat', 'json', 'usage', 'rag'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://docs.cohere.com/v1/docs/models',
        note: 'Replaced the legacy command-r-plus alias with the current live dated Command A+ model.',
      },
    }),
    freezeProvider({
      name: 'github',
      tier: 'heavy',
      envKey: 'GITHUB_MODELS_TOKEN',
      modelEnv: 'GITHUB_MODEL',
      endpoint: 'https://models.github.ai/inference/chat/completions',
      format: 'openai',
      defaultModel: 'openai/gpt-4.1',
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 32_768,
      timeoutMs: 25_000,
      costTier: 'account',
      costUnits: 3,
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://docs.github.com/en/rest/models/catalog',
      },
    }),
    freezeProvider({
      name: 'cfai',
      tier: 'heavy',
      bindingKey: 'AI',
      format: 'cfai',
      defaultModel: '@cf/openai/gpt-oss-120b',
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_768,
      timeoutMs: 25_000,
      costTier: 'low',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0.35, outputPerMillionUsd: 0.75 },
      capabilities: ['chat', 'json', 'usage', 'reasoning'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      runtimes: ['worker'],
      lifecycle: {
        status: 'active',
        checkedAt: '2026-07-26',
        source: 'https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/',
      },
    }),
    freezeProvider({
      name: 'ai21',
      tier: 'heavy',
      envKey: 'AI21_API_KEY',
      modelEnv: 'AI21_MODEL',
      endpoint: 'https://api.ai21.com/studio/v1/chat/completions',
      format: 'openai',
      defaultModel: 'jamba-large',
      contextWindowTokens: 256_000,
      maxOutputTokens: 4_096,
      timeoutMs: 25_000,
      costTier: 'medium',
      costUnits: 2,
      capabilities: ['chat', 'usage', 'rag'],
      eligibleRiskClasses: ['medium', 'high'],
      independentVerifierEligible: true,
      supportsJsonMode: false,
      lifecycle: {
        status: 'active-alias',
        checkedAt: '2026-07-26',
        source: 'https://docs.ai21.com/reference/jamba-1-6-api-ref',
        note: 'Migrated from the retired Jurassic completion endpoint.',
      },
    }),
    freezeProvider({
      name: 'openrouter',
      tier: 'heavy',
      envKey: 'OPENROUTER_API_KEY',
      modelEnv: 'OPENROUTER_MODEL',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      format: 'openai',
      defaultModel: 'openrouter/free',
      contextWindowTokens: 200_000,
      maxOutputTokens: 8_192,
      timeoutMs: 25_000,
      costTier: 'free-variable',
      costUnits: 1,
      pricing: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
      capabilities: ['chat', 'json', 'usage', 'router-metadata'],
      eligibleRiskClasses: ['medium'],
      independentVerifierEligible: false,
      extraHeaders: Object.freeze({
        'HTTP-Referer': 'https://market-terminal.wyjjdyxzsc.workers.dev',
        'X-Title': 'Market Terminal',
        'X-OpenRouter-Metadata': 'enabled',
      }),
      lifecycle: {
        status: 'best-effort-router',
        checkedAt: '2026-07-26',
        source: 'https://openrouter.ai/docs/guides/routing/routers/free-router',
        note: 'Not approved as an independent high-risk verifier because the serving host and model vary.',
      },
    }),
    freezeProvider({
      name: 'huggingface',
      tier: 'heavy',
      envKey: 'HF_API_KEY',
      modelEnv: 'HF_MODEL',
      endpoint: 'https://router.huggingface.co/v1/chat/completions',
      format: 'openai',
      defaultModel: 'openai/gpt-oss-120b:fastest',
      contextWindowTokens: 131_072,
      maxOutputTokens: 16_384,
      timeoutMs: 25_000,
      costTier: 'router-variable',
      costUnits: 2,
      capabilities: ['chat', 'json', 'usage', 'structured-output'],
      eligibleRiskClasses: ['medium'],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'best-effort-router',
        checkedAt: '2026-07-26',
        source: 'https://huggingface.co/docs/inference-providers/tasks/chat-completion',
        note: 'Not approved as an independent high-risk verifier because the serving host is brokered.',
      },
    }),
    freezeProvider({
      name: 'nebius',
      tier: 'heavy',
      envKey: 'NEBIUS_API_KEY',
      modelEnv: 'NEBIUS_MODEL',
      endpoint: 'https://api.studio.nebius.com/v1/chat/completions',
      format: 'openai',
      defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
      timeoutMs: 25_000,
      costTier: 'unknown',
      costUnits: 3,
      capabilities: ['chat'],
      eligibleRiskClasses: [],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'disabled-unverified',
        checkedAt: '2026-07-26',
        source: 'https://docs.nebius.com/',
        note: 'The legacy hosted Studio endpoint could not be verified in current official service documentation.',
      },
    }),
    freezeProvider({
      name: 'octoai',
      tier: 'heavy',
      envKey: 'OCTOAI_API_KEY',
      format: 'retired',
      defaultModel: null,
      timeoutMs: 0,
      costTier: 'retired',
      costUnits: 0,
      capabilities: [],
      eligibleRiskClasses: [],
      independentVerifierEligible: false,
      lifecycle: {
        status: 'retired',
        checkedAt: '2026-07-26',
        note: 'The obsolete text.octoai.run fallback is disabled rather than silently attempted.',
      },
    }),
  ]);

  const PROVIDER_BY_NAME = new Map(PROVIDERS.map((provider) => [provider.name, provider]));
  const ACTIVE_STATUSES = new Set(['active', 'active-alias', 'best-effort-router']);

  function getProvider(name) {
    return PROVIDER_BY_NAME.get(String(name || '').toLowerCase()) || null;
  }

  function isActive(provider) {
    return Boolean(provider && ACTIVE_STATUSES.has(provider.lifecycle.status));
  }

  function resolveModel(provider, env = {}) {
    if (!provider) return null;
    return (provider.modelEnv && env[provider.modelEnv]) || provider.defaultModel || null;
  }

  function isConfigured(provider, env = {}) {
    if (!provider || !isActive(provider)) return false;
    if (provider.bindingKey) return Boolean(env[provider.bindingKey]);
    return Boolean(provider.envKey && env[provider.envKey]);
  }

  function isEligibleForTask(provider, options = {}) {
    if (!isActive(provider)) return false;
    if (options.runtime && !provider.runtimes.includes(options.runtime)) return false;
    if (options.tier && provider.tier !== options.tier) return false;
    if (options.riskClass && !provider.eligibleRiskClasses.includes(options.riskClass)) return false;
    if (options.independentVerifier && !provider.independentVerifierEligible) return false;
    return true;
  }

  function listProviders(options = {}) {
    return PROVIDERS.filter((provider) => {
      if (options.includeInactive) {
        if (options.runtime && !provider.runtimes.includes(options.runtime)) return false;
        if (options.tier && provider.tier !== options.tier) return false;
        return true;
      }
      return isEligibleForTask(provider, options);
    });
  }

  function createProviderHealthState() {
    return new Map();
  }

  function healthEntry(state, providerName) {
    if (!state.has(providerName)) {
      state.set(providerName, {
        attempts: 0,
        successes: 0,
        failures: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureReason: '',
        cooldownUntil: null,
      });
    }
    return state.get(providerName);
  }

  function recordProviderAttempt(state, providerName, at = Date.now()) {
    const entry = healthEntry(state, providerName);
    entry.attempts += 1;
    entry.lastAttemptAt = new Date(at).toISOString();
  }

  function recordProviderSuccess(state, providerName, at = Date.now()) {
    const entry = healthEntry(state, providerName);
    entry.successes += 1;
    entry.lastSuccessAt = new Date(at).toISOString();
    entry.lastFailureReason = '';
  }

  function recordProviderFailure(state, providerName, reason, at = Date.now()) {
    const entry = healthEntry(state, providerName);
    entry.failures += 1;
    entry.lastFailureAt = new Date(at).toISOString();
    entry.lastFailureReason = String(reason || 'provider_error').replace(/\s+/g, ' ').slice(0, 160);
  }

  function recordProviderCooldown(state, providerName, until) {
    const entry = healthEntry(state, providerName);
    const value = Number(until);
    entry.cooldownUntil = Number.isFinite(value) ? new Date(value).toISOString() : null;
  }

  function providerHealthSnapshot(provider, state, options = {}) {
    const entry = state.get(provider.name) || {};
    const cooldownUntil = options.cooldownUntil || entry.cooldownUntil || null;
    return {
      name: provider.name,
      tier: provider.tier,
      lifecycleStatus: provider.lifecycle.status,
      configured: Boolean(options.configured),
      requestedModel: options.requestedModel || provider.defaultModel || null,
      attempts: entry.attempts || 0,
      successes: entry.successes || 0,
      failures: entry.failures || 0,
      lastAttemptAt: entry.lastAttemptAt || null,
      lastSuccessAt: entry.lastSuccessAt || null,
      lastFailureAt: entry.lastFailureAt || null,
      lastFailureReason: entry.lastFailureReason || '',
      cooldownUntil,
      cooling: Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now()),
      deprecationNote: provider.lifecycle.note || '',
    };
  }

  const api = {
    AI_PROVIDER_REGISTRY_SCHEMA_VERSION,
    PROVIDERS,
    getProvider,
    isActive,
    resolveModel,
    isConfigured,
    isEligibleForTask,
    listProviders,
    createProviderHealthState,
    recordProviderAttempt,
    recordProviderSuccess,
    recordProviderFailure,
    recordProviderCooldown,
    providerHealthSnapshot,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.MarketTerminalAiProviderRegistry = api;
})();
