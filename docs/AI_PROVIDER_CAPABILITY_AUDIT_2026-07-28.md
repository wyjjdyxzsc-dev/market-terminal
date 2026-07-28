# AI Provider Capability Audit - 2026-07-28

This is an implementation audit of the model providers used by Market Terminal. It records current official model identifiers, runtime eligibility, lifecycle decisions, and the limits of the checkpoint. It is not a claim that every configured account has access to every listed model.

## Outcome

- `shared/ai-provider-registry.js` is the canonical provider inventory for Express and the Worker.
- Obsolete defaults were replaced with current documented model IDs. Unverified or retired endpoints are disabled instead of being attempted silently.
- Generic and lower-risk generation can use a bounded first-valid response race.
- Every current-market or high-risk generated response must pass a second call from a different provider and a different canonical model family. The first valid verifier rejection is authoritative.
- OpenRouter's random free router and Hugging Face's brokered router may serve medium-risk tasks, but cannot independently verify high-risk output because their serving host/model identity is not controlled strongly enough.
- Provider/model identity, calls, token usage or explicit estimates, latency, estimated cost, cost units, verifier outcome, and budget status are returned in the safe policy envelope.

## Provider Registry

| Provider | Tier | Default model | Runtime status | High-risk generator | Independent verifier | Official evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Groq | speed | `openai/gpt-oss-120b` | active | no | no | [models](https://console.groq.com/docs/models), [deprecations](https://console.groq.com/docs/deprecations) |
| Cerebras | speed | `gpt-oss-120b` | active | no | no | [public models](https://inference-docs.cerebras.ai/api-reference/models/public-models) |
| SambaNova | speed | `Meta-Llama-3.3-70B-Instruct` | active documented example | no | no | [quickstart](https://docs.sambanova.ai/docs/en/get-started/quickstart) |
| Together | speed | `openai/gpt-oss-120b` | active | no | no | [serverless models](https://docs.together.ai/docs/serverless/models) |
| Mistral | speed | `mistral-large-latest` | active alias | no | no | [chat API](https://docs.mistral.ai/api) |
| Gemini | heavy | `gemini-3.6-flash` | stable | yes | yes | [model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| DeepSeek | heavy | `deepseek-v4-flash` | active | yes | yes | [V4 release and migration](https://api-docs.deepseek.com/news/news260424/) |
| Cohere | heavy | `command-a-plus-05-2026` | live dated model | yes | yes | [models](https://docs.cohere.com/docs/models) |
| GitHub Models | heavy | `openai/gpt-4.1` | catalogued | yes | yes | [models catalog API](https://docs.github.com/en/rest/models/catalog) |
| Cloudflare Workers AI | heavy | `@cf/openai/gpt-oss-120b` | active Worker binding | yes | yes, except against the same model family | [model and pricing](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) |
| AI21 | heavy | `jamba-large` | active alias | yes | yes | [chat API](https://docs.ai21.com/reference/jamba-1-6-api-ref) |
| OpenRouter | medium only | `openrouter/free` | best-effort random router | no | no | [free-router behavior](https://openrouter.ai/docs/guides/routing/routers/free-router) |
| Hugging Face | medium only | `openai/gpt-oss-120b:fastest` | brokered provider router | no | no | [chat completion](https://huggingface.co/docs/inference-providers/tasks/chat-completion) |
| Nebius legacy Studio | none | legacy value retained for diagnostics | disabled-unverified | no | no | [current Serverless AI model](https://docs.nebius.com/serverless/index) |
| OctoAI legacy text endpoint | none | none | retired/disabled | no | no | Endpoint is not attempted; [NVIDIA's current staff history](https://developer.nvidia.com/blog/author/benhamm/) records the 2024 acquisition. |

## Lifecycle Decisions

- Groq's `llama-3.3-70b-versatile` is deprecated for free/developer usage with an announced 2026-08-16 shutdown; the registry uses the documented replacement `openai/gpt-oss-120b`.
- Gemini `gemini-2.0-flash` was removed from the runtime in favor of stable `gemini-3.6-flash`.
- DeepSeek's `deepseek-chat` and `deepseek-reasoner` aliases were retired after 2026-07-24; the runtime requests `deepseek-v4-flash`.
- Cohere's legacy `command-r-plus` alias is not used; the registry pins the live dated `command-a-plus-05-2026`.
- Together's retired free Llama endpoint was replaced with its documented serverless GPT-OSS model.
- The old AI21 Jurassic completion path was replaced with the current Jamba chat-completions endpoint.
- The legacy Nebius Studio URL and OctoAI URL are disabled until a current, account-compatible adapter can be verified.

## Runtime Controls

| Control | Implementation |
| --- | --- |
| Provider eligibility | Task risk, tier, runtime, lifecycle status, and verifier eligibility are checked against the shared registry. |
| Model independence | Canonicalization detects aliases/hosts serving the same underlying model, including GPT-OSS aliases, so a second host alone does not satisfy independence. |
| Call bounds | Every task has a maximum provider-call count; failed attempts count against it. |
| Token bounds | Input and output estimates are checked before calls; provider-reported usage replaces estimates when available. |
| Cost bounds | Tasks have cost-unit and estimated-USD ceilings. Unknown/contract pricing still consumes conservative cost units. |
| Latency bounds | Provider calls have per-provider timeouts and the full task has a wall-clock budget. A real `Promise.race` timeout covers clients that ignore `AbortSignal`. |
| Failure behavior | High-risk tasks abstain when evidence, generation, identity, independent verification, schema validation, or any budget cannot be satisfied. |
| Health | Attempts, successes, failures, cooldowns, lifecycle notes, requested models, and last failure reasons are exposed only through protected diagnostics. |
| User disclosure | Safe response metadata identifies the actual served generator and verifier models, usage/estimates, latency, cost, and verification outcome without exposing credentials. |

## Evaluation Evidence

- `tests/fixtures/ai-eval-2026-07-26a.json` contains 10 versioned recorded policy cases, including deliberately invalid candidate output and verifier rejection cases.
- `npm run test:ai-eval` measures schema pass rate, evidence precision, unsupported-claim rate, entity/ticker precision, timestamp accuracy, duplicate rate, abstention accuracy, verifier decisions, and latency/token/cost budget compliance.
- The local checkpoint passed all declared thresholds. Candidate metrics intentionally remain below 1.0 where bad candidates are included; accepted-output evidence precision and unsupported-claim controls passed.
- Unit tests cover provider lifecycle defaults, opaque-router exclusion, health state, different-provider/different-model verification, canonical model-family aliases, authoritative verifier rejection, complete verifier coverage of candidate-cited evidence IDs, explicit evaluation-budget observations, affordable-verifier fallback, and fail-closed budgets.

## Limits

- The fixture suite is an offline safety regression suite, not a live-provider quality benchmark or proof of factual correctness.
- An independent model verifier can still make mistakes. It verifies the candidate against the supplied evidence and policy; it is not a substitute for authoritative primary data or human review.
- Provider prices, models, account permissions, retention terms, regional availability, and limits can change. Operators must re-check official documentation and their account terms before enabling a provider.
- No new market-data entitlement is created by using an AI provider. Unsupported research rankings, relationship graphs, options construction, country scores, and trade levels remain withheld.
- Persistent aggregate AI observability, a human-labelled finance/OSINT evaluation corpus, live-provider drift canaries, and calibration measurement remain future work.
