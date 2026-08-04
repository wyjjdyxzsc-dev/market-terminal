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
- The checkpoint passed all declared thresholds across `45/45` unit tests and the 10-case offline evaluation. Candidate metrics intentionally remain below 1.0 where bad candidates are included; accepted-output evidence precision and unsupported-claim controls passed.
- Unit tests cover provider lifecycle defaults, opaque-router exclusion, health state, different-provider/different-model verification, canonical model-family aliases, authoritative verifier rejection, complete verifier coverage of candidate-cited evidence IDs, explicit evaluation-budget observations, affordable-verifier fallback, and fail-closed budgets.

## Production Evidence

- Source commits `8a8b980`, `4ffe15a`, and `919f1b9` deployed through the managed GitHub-to-Cloudflare path. The first run against `8a8b980` passed `29/33` because four pre-final KV envelopes shared the in-progress policy namespace. Commit `4ffe15a` moved policy/cache schema to `2026-07-28a`; the cold-namespace run and final `919f1b9` run passed `33/33`, with only the allowed weather-provider `502` skip.
- Targeted production probes observed bounded provider/runtime metadata. Sector and situation generation abstained after rejected verification, broad current-market chat abstained after verifier-stage failure, and other high-risk routes abstained before generation when evidence/input gates failed. Deterministic candles used zero model calls; generic educational chat completed through a speed-tier provider.
- No generated high-risk/current-market response was accepted during these probes. The evidence demonstrates deployed fail-closed behavior, not positive live-provider factual quality or verifier accuracy.
- Desktop and mobile production browser checks loaded all seven `20260728b` asset markers without horizontal overflow or console warnings/errors. Sector/deep-dive output remained withheld, educational chat rendered one answer and one policy note with its served runtime, and the active symbol context displayed `AAPL`.

## 2026-07-30 Availability Repair

- A live investigation found that the production AI pool was not globally offline: educational chat completed through Groq, while sector and situation routes had previously completed a Gemini/GitHub generator-verifier path. Company-focused routes were losing qualifying evidence behind Finnhub/Bing redirect hosts, and broad/current-market generation could spend its budget before the preferred independent pair completed.
- Evidence, task-policy/cache, and verification schemas are now `2026-07-30a`. Company evidence combines RSS with normalized Finnhub company news, and known publisher labels can supply authority only when the URL is a recognized redirect host.
- Verified generation reserves one independent verifier within call/cost limits before another generator attempt. Worker high-risk routing uses registry reliability order, and safe runtime metadata includes bounded failed-attempt records and failure codes.
- Lower-risk races use a shared 4,000-token output ceiling. This was selected from observed behavior: 2,000 produced failed strict-JSON generation for the NEWS workload, while 8,000 exceeded the configured account's tokens-per-minute request ceiling. Per-minute capacity errors now receive the short cooldown instead of being mistaken for daily exhaustion.
- Local evidence passed `50/50` unit tests, all 10 offline evaluation thresholds, `31/31` available API contracts, zero-vulnerability audit, Worker dry-run bundling, targeted route probes, and an interactive browser check. Local current-market/high-risk tasks accurately abstained because the environment has only Groq and therefore cannot form an independent heavy-provider pair.
- Source commit `febefb3` deployed through the managed path, served all seven `20260730a` assets, and passed `33/33` production contracts. Targeted production probes reached 14 company-evidence records for AAPL/Apple, 16 for deep dive, six for price action, 28 for sectors, and 60 for situation analysis. Educational chat completed through Groq; generated current-market/high-risk attempts either failed generation/verification or were rejected by the verifier. No generated high-risk response was accepted, so these probes verify fail-closed behavior rather than positive factual quality.
- The first deployed NEWS probe returned one non-degraded card from 60 input headlines. The previous validator accepted any non-empty batch, so this was treated as a material defect rather than successful enrichment. Source commit `90c191b` deployed NEWS schema/cache `2026-07-30b`, requiring at least six enriched cards when six inputs are available, evicting the incompatible cache, and otherwise returning the canonical source-linked degraded fallback. The deployment served all seven `20260730b` assets and passed `33/33`; both normal and forced-fresh probes returned 12 linked enriched cards. The production browser rendered all 12 and the current-market chat showed a bounded GitHub generation plus verifier-unavailable abstention with no console errors.

## Limits

- The fixture suite is an offline safety regression suite, not a live-provider quality benchmark or proof of factual correctness.
- An independent model verifier can still make mistakes. It verifies the candidate against the supplied evidence and policy; it is not a substitute for authoritative primary data or human review.
- Provider prices, models, account permissions, retention terms, regional availability, and limits can change. Operators must re-check official documentation and their account terms before enabling a provider.
- No new market-data entitlement is created by using an AI provider. Unsupported research rankings, relationship graphs, options construction, country scores, and trade levels remain withheld.
- Persistent aggregate AI observability, a human-labelled finance/OSINT evaluation corpus, live-provider drift canaries, and calibration measurement remain future work.

## 2026-08-04 Deep Dive Availability Boundary

- The observed Deep Dive incident was not evidence that every AI provider was offline. The route lost source diversity before generation, bypassed the quote pool, and exposed an empty fallback; the local environment also still has only Groq and therefore cannot form a valid high-risk generator/verifier pair.
- Schema `2026-08-04a` makes the quote/fundamental/analyst/evidence dossier deterministic and leaves only the optional narrative under the provider registry and independent-verification pipeline. No provider model, eligibility, price, or lifecycle entry changed in this checkpoint.
- Source commit `9370cc3` served all seven `20260804a` assets, passed `33/33` production contracts, and returned useful targeted dossiers. Those probes exposed 32-37 second uncached optional-AI waits, so source commit `953c0ea` returns deterministic data first and requests `ai=1` separately. It served all seven `20260804b` assets, passed `33/33`, returned fresh defaults in 1.06-1.35 seconds, and disclosed pending-to-withheld behavior in the browser. Optional AAPL verification took 27.7 seconds and no independent verifier completed; none of this is positive live high-risk output-quality evidence.

## 2026-08-04 Market-Data Completeness Boundary

- Checkpoint 9 changes no AI provider, model, eligibility, verifier, token, latency, or cost policy. It prevents AI abstention from being visually conflated with missing deterministic market data.
- Equity coverage and normalized options rows retain deterministic authority. The optional narrative cannot overwrite those fields when generation or verification abstains.
- Local `58/58` unit, offline AI threshold, strict contract, and browser checks confirmed that listed options data remains visible while the high-risk narrative stays withheld. Source commit `ebacf62` then served all seven `20260804d` assets, passed `34/34`, and reproduced the same SPCX state in production. This is not positive model-quality evidence, a recommendation, or a relaxation of independent verification.
