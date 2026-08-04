# Full Audit — 2026-07-13

This document is a live audit ledger. Findings start as `open` and are updated only after direct verification or tests confirm remediation.

## Baseline summary

- Audit date: 2026-07-13
- Starting branch: `main`
- Starting commit: `d394f3b`
- Deployment URL: `https://market-terminal.wyjjdyxzsc.workers.dev`
- Production smoke baseline: `20/20` passed
- Local smoke baseline: `14/14` passed with multiple skips

## Checkpoint 1 summary

- Local code checkpoint date: 2026-07-13
- Local unit suite: `9/9` passed
- Local smoke suite: `21/21` passed
- Manual browser verification: passed against `http://localhost:3000`
  - Quote ribbon and AAPL quote panel loaded in the in-app browser
  - Chart canvas detected with non-zero dimensions
  - Browser console errors/warnings observed during verification: none
- Local security header verification: passed for `/` and `/api/quote?symbol=AAPL`
  - `Content-Security-Policy`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Cross-Origin-Resource-Policy: same-origin`
- Production after-code-change verification:
  - deployed commit `aa4f85b` passed `28/28` production smoke checks
  - follow-up deployed commit `ff58850` verified static-asset security headers on `/`
  - negative route/security probes verified on production:
    - `POST /api/quote` -> `405`
    - `GET /api/stocks/stream` -> `426`
    - `GET /api/ai-status` -> `503`
    - `GET /api/data-status` -> `503`
    - `GET /api/test-push` -> `503`
    - malformed `POST /api/subscribe` -> `400`
    - malformed `POST /api/unsubscribe` -> `400`
  - production intelligence payload verification:
    - `/api/intel/news` returns `sourceUrl`, `status`, `freshness`, `sourceCount`, and `evidence`

## Checkpoint 2 summary

- Source-change commit: `55e014c` (`Replace social scraper with market sentiment composite`)
- Production HTML served `app.js?v=20260713b`, confirming the sentiment implementation was live.
- `npm run test:prod` passed `29/29` checks on 2026-07-15. The weather route produced its explicitly allowed `502` skip; no smoke checks failed.
- Production `GET /api/sentiment/market` at `2026-07-15T12:18:39.910Z` returned `200` with `status: "live"`, `dataMode: "deterministic"`, score `0.298`, five benchmarks, 18 headlines, 13 sources, source-attributed evidence, and disclosed methodology.
- Production `GET /api/sentiment/twitter` returned `200` with `Deprecation: true` and `Link: </api/sentiment/market>; rel="successor-version"`.
- No production browser visual pass is claimed for this checkpoint: the browser bridge could not initialize in the verification session. The page-shell smoke check and cache-busted asset probe passed, while the prior local browser verification remains separate evidence.

## Checkpoint 3 summary

- Source-change commit: `a25e6be` (`Add map provenance contracts`)
- Scope: map provenance and freshness disclosure; production deployment verified on 2026-07-15.
- Added `shared/map-provenance-core.js` with a versioned catalog for all implemented Leaflet layers plus the infrastructure response. Each catalog record distinguishes `live`, `curated`, `hybrid`, `computed`, or `model-derived` data and lists source metadata, cache state, refresh target, usage note, and a real snapshot/served timestamp when available.
- Both runtimes now attach a provenance envelope to `/api/map/layers`, `/api/map/earthquakes`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, `/api/map/fires`, `/api/map/webcams-live`, `/api/map/disease`, `/api/map/gpsjam`, `/api/map/conflict`, and `/api/map/infrastructure` without removing their established data fields.
- Local parity corrections: Express earthquakes now normalize the Worker-compatible USGS all-day point shape; Express fires now normalize FIRMS CSV points and use the same 30-minute refresh target as the Worker.
- The map panel now renders a safe provenance line when a layer is active: data class/status, source link, cache/refresh cadence, and `snapshot` or `served` time. It does not invent an upstream timestamp where none was provided.
- Local targeted probe: `/api/map/layers` returned `200` with `provenance.kind: "layer-catalog"` and 34 catalog entries; `/api/map/earthquakes` returned `200` with a layer envelope; `/api/map/conflict` returned `200` with the `conflictZones` envelope. The unconfigured FIRMS route returned its expected `502` in local development.
- Local verification: syntax checks for `server.js`, `worker.js`, `public/mapintel.js`, and `shared/map-provenance-core.js` passed; `npm run test:unit` passed `16/16`; the local smoke suite passed `23/23` with only documented optional-provider skips.
- Production verification: HTML served `app.js?v=20260715b` and `mapintel.js?v=20260715b`; `npm run test:prod` passed `29/29` with only the explicitly allowed weather-provider `502` skip. Targeted production probes returned a 34-entry `layer-catalog`, a `live` earthquakes envelope (265 points at probe time), a `hybrid` conflict envelope, a `live` fires envelope, and a `curated` infrastructure envelope. Each carried source metadata and `servedAt`; cache state reflected the actual response.
- No visual-browser pass is claimed for this checkpoint. The in-app browser bridge could not initialize and the `agent-browser` CLI was unavailable; page-shell smoke, deployed asset confirmation, API contracts, and JavaScript syntax validation passed instead.

## Checkpoint 4 summary

- Checkpoint date: 2026-07-16. Source commit `5a10b79` is production verified.
- Added `shared/ai-task-policy-core.js` with a shared policy schema (`2026-07-15a`) for task risk, approved provider tiers/names, evidence freshness and source-diversity gates, required inputs, deterministic citation validation, constrained outputs, and structured abstentions.
- Express and Worker now apply that policy to price action, supply chain, deep dive, investment report, situation room, instability scoring, and chat. Policy schema versions are included in high-risk cache keys so pre-policy cached analyses cannot be served as compliant output.
- Supply-chain edges, investment picks, and country scores are withheld until verified adapters exist. Deep-dive output is `Not Rated` and cannot carry a fair value, target, entry, stop, exact options construction, strike, expiry, or IV claim. Price-action and situation routes abstain when evidence, citations, or an approved heavy provider are unavailable.
- Chat validates role, length, and message count, discards client-supplied authoritative context, and builds quote/headline context on the backend. Generic educational chat uses the speed pool; current-market questions require trusted fresh evidence, allowed citations, and a heavy-policy provider.
- The UI now renders explicit grounded/withheld notices with source count, source links, as-of time, verifier label, and disclaimer across deep dive, report, situation, price action, map/globe risk, supply chain, and chat.
- Local verification: all modified JavaScript parsed; `npm ci --no-audit --no-fund` completed; `npm audit --omit=dev` reported zero vulnerabilities; Wrangler `4.111.0` bundled the exact source successfully with `deploy --dry-run`; `npm run test:unit` passed `24/24`; the local smoke suite passed `28/28`, with optional key/network routes reported only as documented skips. Targeted probes returned policy schema `2026-07-15a`, empty unsupported relationships/picks/countries, constrained deep-dive output, and seven `20260716a` asset references.
- Local runtime note: macOS had offloaded Desktop-backed project dependencies as dataless files. Source directories were hydrated with `brctl`, and the exact working tree was mirrored to `/tmp/market-terminal-verify` for stable execution. This is environment evidence, not a source or application change.
- Production verification: all seven asset references served `20260716a`; `npm run test:prod` passed `31/31` with only the explicitly allowed weather-provider skip. Targeted deployed probes confirmed policy schema `2026-07-15a` for all guarded routes, empty supplier/customer edges, empty investment picks, empty country scores, `Not Rated` deep-dive output, a grounded situation response citing five allowed evidence IDs, and grounded speed-tier generic chat.
- Interactive production-browser verification: the shell loaded AAPL at a live quote, rendered a `718x495` chart canvas, switched all seven top-level tabs to their expected views, showed the supply-chain evidence-required state, and produced no console warnings/errors. Screenshot capture timed out, so no screenshot artifact is claimed.
- AUD-007 is only partially resolved. The deterministic gate verifies evidence age, source diversity, allowed citation IDs, and safe fallback behavior, but it is not an independent claim-level model verifier. Sector analysis, company-news impact, candle commentary, alert prioritization, model/version telemetry, cost budgets, and a measured AI evaluation harness remain open.

## Checkpoint 5 summary

- Checkpoint date: 2026-07-22. Source commit `20c9252` is production verified.
- Policy schema `2026-07-22a` covers sector analysis, company-news impact, candle commentary, and breaking-alert prioritization in addition to the production-verified checkpoint 4 tasks.
- Sector analysis now requires fresh, trusted, source-diverse evidence, a policy-approved heavy provider, root citations, and per-sector citations. The output constraint always removes ranks, scores, stock picks, implied-volatility labels, and options strategies; all 11 sectors remain visible with `N/A` where evidence is absent.
- Company-news impact now requires cited heavy-tier interpretation. Backend evidence binding replaces model-supplied title, publisher, URL, timestamp, ticker, and company identity fields with canonical records and drops uncited items. If policy gates fail, canonical headlines remain visible but impact is `not rated`.
- Candle commentary no longer calls any AI provider. The shared OHLC engine is the sole authority for patterns, observed levels, signal, trend, and momentum, and the policy metadata identifies `deterministic-ohlc-pattern-engine`.
- Alert priority no longer trusts model output. Eligibility requires breaking language in bound source headlines, evidence no older than 180 minutes, at least two distinct source domains, and one trusted source. Worker alert state and all affected cache keys are schema-versioned so older AI-prioritized payloads cannot survive the change.
- Frontend labels now describe the actual evidence-gated behavior. Sector ranks/scores show `N/A`, company sources are linked, and alert cards disclose corroboration count.
- Local verification: `29/29` unit tests passed; the expanded 33-check smoke suite passed all 28 contracts available without keys, with only documented optional-route skips; targeted probes confirmed two policy abstentions, 11 unranked sectors, zero picks, deterministic candles, zero uncorroborated alerts, and no high-priority news items.
- Security/build verification: the compatible `body-parser` lockfile update resolved GHSA-v422-hmwv-36x6; `npm audit --omit=dev` returned zero vulnerabilities; Wrangler `4.113.0` bundled 14 assets at 345.24 KiB raw / 86.75 KiB gzip with `deploy --dry-run` only.
- Interactive local-browser verification rendered the sector, AAPL watchlist, and alert guardrail states and reported no warnings/errors. All seven asset references use `20260722a`.
- Production verification: managed deployment served all seven `20260722a` references; `npm run test:prod` passed `33/33` with only the allowed weather-provider `502` skip. Targeted routes confirmed grounded-or-abstained policy envelopes at schema `2026-07-22a`, 11 unranked sectors, zero picks or unspecified recommendation fields, canonical lowercase-AAPL identity/evidence handling, deterministic candles, and no ineligible alerts.
- Interactive production-browser verification rendered 11 `N/A` sector ranks/scores with policy disclosure, a safe lowercase-AAPL watchlist fallback, and the guarded alert state with no console warnings/errors. A fresh-data browser reconfirmation completed on 2026-07-26; no screenshot artifact is claimed.
- AUD-007 remains only partially resolved because the deterministic citation check is not an independent claim-level verifier. Provider/model-version telemetry, token/cost enforcement, measured golden evaluations, and remaining prompt inventory are open.

## Checkpoint 6 summary

- Checkpoint date: 2026-07-28. Source commit `919f1b9` is production verified.
- Added `shared/ai-provider-registry.js` as the Express/Worker source of truth for current model IDs, context/output limits, provider format, lifecycle status, runtime/task eligibility, conservative cost units, documented pricing, and bounded health diagnostics.
- Replaced obsolete defaults with current documented routes/models, including Groq GPT-OSS 120B, Gemini 3.6 Flash, DeepSeek V4 Flash, Cohere Command A+, Together GPT-OSS, and AI21 Jamba chat. The legacy Nebius Studio and OctoAI paths are disabled rather than silently attempted.
- Added `shared/ai-verification-core.js`. Current-market and high-risk generated tasks execute a generator followed by a claim/evidence verifier from a different provider and a different canonical model family. Canonicalization detects the same underlying model across aliases/hosts. The first valid rejection is authoritative, a pass must cover every candidate-cited evidence ID, and any missing independence, invalid schema/citations, timeout, or exhausted call/token/cost/latency budget fails closed. Pre-call token/known-price projections are bounded, while an unaffordable verifier is skipped in favor of a later independent provider that still fits.
- Provider failures count against call/cost budgets. Real wall-clock timeout races cover providers that ignore abort signals. Response policy metadata reports actual requested/served generator and verifier models, provider calls, reported usage or explicit estimates, latency, estimated USD, conservative cost units, and budget status.
- Added `shared/ai-evaluation-core.js`, `tools/run-ai-eval.js`, and the versioned 10-case fixture `tests/fixtures/ai-eval-2026-07-26a.json`. Metrics cover accepted and candidate schema/evidence precision, unsupported claims, entity/ticker identity, timestamps, duplicates, abstentions, verifier decisions/rejections, and budget compliance. Missing budget observations fail closed instead of being coerced to zero.
- The evaluation is explicitly an offline policy-safety regression, not a live-provider benchmark or factual-accuracy proof. Independent model verification remains fallible and does not replace authoritative data or human review.
- Corrected chat intent so educational questions such as P/E definitions do not become current-market requests solely because they contain the word `price`. Express and Worker use the same classifier. Fixed the chat UI scope error that rendered a successful answer and then a false network-error bubble; browser verification now observes one AI bubble and one policy note.
- Local verification: `45/45` unit tests passed; the AI evaluation passed all declared thresholds; all 28 API contracts available in the keyless local environment passed; `npm audit --omit=dev` found zero vulnerabilities; syntax checks passed; Wrangler `4.114.0` bundled 14 assets at 399.10 KiB raw / 96.89 KiB gzip with `deploy --dry-run`; targeted policy probes and desktop/mobile browser checks passed with no warnings/errors.
- Managed deployment evidence: source commits `8a8b980`, `4ffe15a`, and `919f1b9` reached production through `main`. The first `8a8b980` run exposed four stale KV policy envelopes and passed `29/33`; this was treated as a material defect. Commit `4ffe15a` moved policy/cache schema to `2026-07-28a`, isolating those envelopes, and both the cold-namespace run and final source commit `919f1b9` passed `33/33`, with only the allowed weather-provider `502` skip.
- Production authority probes: sector and situation generation abstained after rejected verification; broad current-market chat abstained after verifier-stage failure; company, price-action, deep-dive, report, instability, and supply-chain routes abstained before generation when their evidence/input gates failed. Deterministic candles remained accepted with zero provider calls, and educational chat completed through the generic speed tier. No generated high-risk/current-market response was accepted, so this checkpoint proves fail-closed behavior but does not provide positive live high-risk quality evidence.
- Interactive production verification: all seven `20260728b` assets loaded at desktop and mobile widths with no horizontal overflow or console warnings/errors. The sector and deep-dive surfaces remained withheld, educational chat rendered one answer and one policy note with actual runtime identity, and the active chat context correctly showed `AAPL` after source commit `919f1b9`. Screenshot capture timed out, so no screenshot artifact is claimed.
- AUD-007 is substantially improved and production verified for the implemented controls, but remains partially resolved pending live-provider drift/quality canaries, a human-labelled finance/OSINT claim corpus, calibration measurement, and persistent aggregate observability. No professional-terminal or intelligence-product parity is claimed.

## Checkpoint 7 summary

- Checkpoint date: 2026-07-30. Source commits `febefb3` and `90c191b` are production verified through the managed deployment path.
- Live diagnosis showed generic educational chat working, but identified three availability defects: redirect URLs hid reputable company publishers, company AI routes omitted Finnhub's existing company-news feed, and generator retries could consume the budget needed by the mandatory independent verifier.
- Added `shared/company-evidence-core.js`, ticker resolution for company-name requests, and combined RSS/Finnhub evidence for company impact, deep dive, current-market chat, and price action. Known publisher aliases apply only behind recognized redirect/aggregator hosts; unrelated domains cannot inherit a trusted label.
- Evidence, task-policy/cache, and verification schemas moved to `2026-07-30a`, isolating stale abstention envelopes. Price-action prompts now request required evidence IDs.
- Verified generation reserves an independent provider/model verifier inside remaining call/cost limits. Worker high-risk generation uses deterministic registry order rather than rotating weaker candidates ahead of the known pair.
- Runtime metadata now retains bounded failed-attempt telemetry and safe failure codes. Backend and frontend disclosure distinguishes missing provider pairs, schema/evidence generation failures, verifier rejection/unavailability, and budget exhaustion.
- Lower-risk Express and Worker races share a 4,000-token output ceiling. Per-minute throttles now use a short cooldown rather than the daily/quota cooldown. The first deployed NEWS probe revealed that the prior non-empty validator accepted one generated card from 60 inputs; schema/cache `2026-07-30b` now requires a useful six-card batch or serves the canonical source-linked degraded fallback.
- Core production evidence: source commit `febefb3` served all seven `20260730a` assets and passed `33/33` contracts. Targeted probes confirmed 14 AAPL/Apple company evidence records, bounded attempt telemetry, educational Groq completion, and fail-closed high-risk generation/verification. No positive high-risk acceptance is claimed.
- Follow-up evidence: `50/50` unit tests, all 10 offline AI evaluation thresholds, `31/31` available local contracts, zero known dependency vulnerabilities, syntax checks, and Wrangler `4.115.0` dry-run bundling at 408.24 KiB raw / 98.96 KiB gzip passed. Production served all seven `20260730b` assets, passed `33/33`, and returned 12 linked enriched NEWS cards on normal and forced-fresh probes. The browser rendered the 12-card feed and a clearly disclosed verifier-unavailable chat abstention with no console errors.
- No parity row changes. Local high-risk routes still abstain by design because only Groq is configured; at least two eligible heavy providers from different canonical model families are required.

## Checkpoint 8 summary

- Checkpoint date: 2026-08-04. Deep Dive source commits `9370cc3` and `953c0ea` are production verified.
- Root cause: company evidence was merged purely by recency, allowing one high-volume Finnhub/Yahoo domain to occupy the full 16-record limit. Deep Dive then failed its source-diversity gate before any provider call, bypassed the resilient quote pool, and rendered an empty abstention fallback.
- Added shared deterministic dossier schema `2026-08-04a`, source-balanced company headline selection, pooled quote routing in both runtimes, schema-isolated caches, and a provenance-first UI. Safe AI abstention now removes only the optional narrative, not quote/fundamental/analyst/evidence utility.
- The strict smoke contract requires a usable pooled quote, non-empty deterministic sections, provenance, and safe `Not Rated`/`Avoid`/`N/A` fields. New unit tests cover useful dossier construction, no-fabrication missing-input behavior, market-cap units, and source reservation.
- Source commit `9370cc3` served all seven `20260804a` assets, passed `33/33` production contracts, and returned useful AAPL/Apple/MSFT dossiers with three source domains. Available AI generation could not complete independent verification and remained safely withheld.
- Those production probes exposed a second defect: uncached Apple/MSFT responses blocked 32-37 seconds on optional AI after the deterministic dossier was ready. Source commit `953c0ea` splits the cache/API paths, returns the dossier first, runs `ai=1` verification in the UI background, and ignores stale query completions. It served all seven `20260804b` assets, passed `33/33`, and returned fresh AAPL/Apple/MSFT dossiers in 1.06-1.35 seconds. The browser showed pending-to-withheld disclosure while preserving data on desktop and mobile with no overflow or console errors.
- Local Finnhub WebSocket startup/retry behavior was also corrected: connections are subscription-driven and repeated closes use bounded exponential backoff rather than an idle five-second loop.
- No capability row, entitlement, or positive high-risk model-quality claim is asserted. Optional AAPL verification took 27.7 seconds separately and was withheld because no independent verifier completed.

## Checkpoint 9 summary

- Checkpoint date: 2026-08-04. The screenshot-observed ticker/options completeness repair is locally verified; managed production verification is pending.
- Root cause 1: the Worker `/api/ticker` route bypassed `getQuoteCached()` and called Finnhub directly for all seven symbols. It converted each throttle/error into a successful zero-valued item, then cached that degraded array, while Deep Dive continued to show valid pooled quotes.
- Root cause 2: the deterministic dossier had real quote, fundamental, analyst, and news inputs but presented its safety boundary as `STOCK —/100 Not Rated`. It also had no options-chain adapter, so `OPTIONS —/100 Avoid` conflated absent market data with a non-recommendation policy.
- `shared/ticker-core.js` now normalizes pooled quotes and merges source-attributed last-good values. Express retains them in memory; the Worker retains them in KV for 24 hours. A versioned cache key isolates the old all-zero arrays.
- `shared/options-chain-core.js` normalizes a bounded Nasdaq at-the-money response into returned row/expiry counts, nearest strike, call/put market, volume/open interest, and returned-row put/call ratios. No IV, Greeks, payoff model, or trade recommendation is inferred.
- Deep Dive schema `2026-08-04b` adds a clearly labelled equity dataset coverage score and deterministic options snapshot. Investment merit, valuation, targets, entries, stops, and options construction remain withheld.
- Local validation passed `58/58` unit tests, all offline AI thresholds, `32/32` available smoke contracts, zero-vulnerability audit, Wrangler `4.118.0` dry-run at 439.96 KiB raw / 105.44 KiB gzip, live all-seven ticker and AAPL/SPCX probes, and desktop/mobile browser checks without overflow or console errors.
- No professional real-time options entitlement, every-stock options availability, IV/Greeks coverage, recommendation quality, or parity-row upgrade is claimed by this local checkpoint.

## Findings

| ID | Severity | Confidence | Area | Affected files/functions | User impact | Evidence | Remediation | Test required | Status | Resolved commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | critical | high | Security | `server.js`, `worker.js`, `/api/test-push` | Public callers can trigger real push notifications | Production `POST /api/test-push` returned `200` and reported delivery to registered devices | Add admin auth, strict POST handling, safe target semantics, and regression coverage | Unauthorized and authorized route tests | resolved-production-verified | ff58850 |
| AUD-002 | critical | high | Runtime parity | `server.js`, `public/app.js`, `public/mapintel.js` | Local development returns HTML for frontend-used API routes, masking broken behavior and invalidating parity | Local probes showed `/api/intel/priceaction`, `/api/intel/candles`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, `/api/map/webcams-live` all returning `200 text/html` | Add missing Express routes and canonical API routing rules | Contract tests on local and Worker | resolved-production-verified | aa4f85b |
| AUD-003 | high | high | API contract | `server.js`, `worker.js` | Unknown `/api/*` and wrong methods do not consistently return JSON `404`/`405` | Local `POST /api/quote` returned HTML error page; unknown `/api/does-not-exist` returned SPA HTML locally | Add canonical route manifest and API-first fallbacks | Contract tests for unknown routes and wrong methods | resolved-production-verified | aa4f85b |
| AUD-004 | high | high | XSS | `public/app.js` `loadPriceAction()` | AI/provider data can reach unsafe HTML sinks | `d.catalysts` and `d.headlines` are inserted via `innerHTML` without escaping | Replace with safe DOM rendering or escaped content builders | DOM-sink regression tests | resolved-local-verified | |
| AUD-005 | high | medium | URL safety | `public/app.js`, `public/intel.js`, `public/mapintel.js` | Provider-controlled URLs may allow unsafe protocols or hostile navigation | Multiple `href` and `src` sinks only escape HTML, not protocols | Add `http/https` allowlist helpers and sanitize URL values | Unsafe URL regression tests | resolved-local-verified | |
| AUD-006 | high | high | Provenance | `server.js`, `worker.js`, news ingestion pipeline | Users cannot verify article origins or freshness reliably | RSS parsing preserves title and source name but drops links in the main intelligence feed | Introduce normalized evidence schema with URL preservation and timestamps | Unit tests for RSS parsing and evidence normalization | resolved-production-verified | aa4f85b |
| AUD-007 | high | high | AI accuracy | `server.js`, `worker.js`, shared AI policy/registry/verification/evaluation cores | High-risk analyses can present unsupported claims | Policy-bound generated tasks require evidence/citations, a different-provider/different-model verifier, bounded calls/tokens/cost/latency, and runtime disclosure; deterministic tasks retain deterministic authority. Source commit `919f1b9` passed local evaluation/contracts, `33/33` deployed contracts, targeted runtime probes, and production browser disclosure checks. Live high-risk attempts failed closed, so positive verifier quality remains unproven | Add live-provider drift canaries, a human-labelled finance/OSINT claim corpus, calibration metrics, and persistent aggregate observability | Unit/evaluation fixtures, local/production contracts, targeted runtime probes, browser disclosure checks | partially-resolved-production-verified | 919f1b9 |
| AUD-008 | high | high | Diagnostics exposure | `worker.js` `/api/ai-status`, `/api/data-status`; `server.js` `/api/debug/providers` | Public users can infer provider inventory and operational state | Production returns provider names and cooldown states; local debug route reveals configuration presence | Remove, redact, or protect diagnostics | Auth and response-shape tests | resolved-production-verified | aa4f85b |
| AUD-009 | medium | high | Documentation drift | `README.md`, `CLAUDE.md`, `AGENTS.md`, `prompt.md` | Operators and future agents may use wrong deploy path or miss tests | Docs still say “No tests yet” and mention manual `wrangler deploy` | Reconcile docs to verified behavior and current deployment policy | Documentation review plus command verification | resolved-committed | aa4f85b |
| AUD-010 | medium | high | Browser security | `public/index.html`, `server.js`, `worker.js` | CSP and supply-chain controls are incomplete | Third-party assets load from `unpkg.com`; `globe.gl` lacks SRI; no strong response security headers observed in code | Add security headers, SRI where possible, and document remaining external dependencies | Header and HTML assertions | resolved-production-verified | ff58850 |
| AUD-011 | medium | medium | Push subscription validation | `server.js`, `worker.js` | Abuse and malformed subscriptions can enter storage | `/api/subscribe` only checks `endpoint` and, in Worker, `keys` presence | Add schema validation, body checks, idempotence, and endpoint policy | Subscription security tests | resolved-production-verified | aa4f85b |
| AUD-012 | medium | medium | Source reliability | `server.js`, `worker.js`, `shared/market-sentiment-core.js` | Unreliable social scraping can be presented as live market intelligence | X syndication was removed from the sentiment and world-news paths; a deterministic benchmark/RSS composite now exposes source counts, evidence, methodology, and degraded coverage | Keep benchmark and RSS inputs attributable; maintain coverage tests and production verification | Unit, local smoke, production smoke, and UI-state tests | resolved-production-verified | 55e014c |
| AUD-013 | medium | high | Map provenance | `server.js`, `worker.js`, `public/mapintel.js`, `shared/map-provenance-core.js` | Users cannot consistently distinguish live, curated, estimated, or stale infrastructure layers | Map layers now have a versioned source/freshness catalog and safe active-layer disclosure; source snapshots remain absent when an upstream does not provide one | Keep per-feature citations and source timestamps as future data-source work | API schema, unit tests, local smoke, and production smoke | resolved-production-verified | a25e6be |
| AUD-014 | medium | medium | Quant validation | `public/quant.js` | Mathematical correctness is largely unverified | No reference/unit suite exists for the indicator surface | Add deterministic reference tests and known limitations | Unit tests with fixtures | partially-resolved-local | |
| AUD-015 | low | high | Repository hygiene | local working tree, packaging process | Unsafe exports can include ignored files and local artifacts | Local repo contains `.env`, `.DS_Store`, `.wrangler`, `worker-startup.cpuprofile`, and `node_modules` in workspace | Add safe packaging/export script or procedure; keep ignored artifacts out of tracked state | Script verification | open | |
| AUD-016 | low | high | Dependency security | `package-lock.json`, transitive `body-parser` | A malformed limit configuration could disable request-size enforcement in an affected dependency version | `npm audit --omit=dev` reported GHSA-v422-hmwv-36x6; the compatible lockfile upgrade removed the advisory, a second audit returned zero findings, and source commit `20c9252` passed production contracts | Keep the patched lockfile and verify clean install/audit in deployment checkpoints | `npm audit --omit=dev` | resolved-production-verified | 20c9252 |
| AUD-017 | high | high | AI availability | company evidence ingestion, provider order/budgets, lower-risk output limits | AI features can abstain before valid evidence reaches the model, exhaust verifier budget, or degrade because provider output is truncated/rate-limited | Source commits `febefb3` and `90c191b` passed local gates, `33/33` deployed contracts, company/provider probes, useful NEWS batch probes, and browser disclosure; no generated high-risk acceptance occurred | Keep the useful-batch smoke contract and provider/evidence telemetry in every future deployment gate | Unit, local/production contracts, targeted runtime probes, browser disclosure | resolved-production-verified | 90c191b |
| AUD-018 | high | high | Deep Dive availability | `shared/deep-dive-core.js`, company evidence merge, Deep Dive quote path/UI | A successful HTTP response appears broken when evidence loses diversity, direct quote access fails, AI abstains into empty sections, or optional verification blocks the ready dossier | Schema `2026-08-04a` builds the source-backed dossier; commits `9370cc3` and `953c0ea` passed all assets, `33/33` production contracts, fresh 1.06-1.35 second data-first probes, and desktop/mobile pending-to-withheld checks | Keep deterministic and optional-AI cache/API paths separate and retain the strict smoke/browser gates | Unit, strict local/production contract, targeted probes, desktop/mobile browser | resolved-production-verified | 953c0ea |
| AUD-019 | high | high | Ticker availability | Worker `/api/ticker`, Express ticker parity, frontend tape | A direct Finnhub throttle becomes a cached all-zero tape even while pooled quotes remain available elsewhere | Both runtimes now use the canonical pool, source/freshness fields, versioned cache isolation, and last-good fallback; strict local seven-symbol contract and browser tape pass | Deploy through the managed path and repeat strict ticker API/browser checks | Unit, strict local/production ticker contract, desktop/mobile browser | resolved-local-production-pending | pending |
| AUD-020 | medium | high | Deep Dive data semantics | `shared/options-chain-core.js`, `shared/deep-dive-core.js`, Deep Dive cards | Available equity inputs look absent because a recommendation-shaped card says `—/100`; optionable stocks show `Avoid` because no chain adapter exists | Schema `2026-08-04b` labels equity coverage as coverage, adds a bounded source-linked Nasdaq chain snapshot, and keeps unavailable IV/Greeks/trade models explicit; AAPL/SPCX API and browser checks pass locally | Deploy and verify optionable plus non-optionable/failure states without changing recommendation authority | Unit, strict local/production Deep Dive contract, targeted probes, desktop/mobile browser | resolved-local-production-pending | pending |

## Area notes

### Architecture

- `server.js` and `worker.js` are large monoliths and have drifted despite similar intent.
- Incremental modularization is justified for shared contracts, evidence normalization, and security policy.

### Worker/Express parity

- Production Worker is materially ahead of local Express for several frontend-used routes.
- This undermines local debugging, makes smoke coverage optimistic, and hides route regressions.
- Checkpoint 1 introduced a shared API contract manifest plus missing Express parity routes.
- Local and production parity are now verified for the covered route surface.

### Frontend/backend contract

- Frontend references `/api/intel/priceaction`, `/api/intel/candles`, `/api/stocks/stream`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, and `/api/map/webcams-live`.
- Express does not provide those contracts at baseline.

### Dependencies and supply chain

- `npm audit --omit=dev --json` reported zero current vulnerabilities.
- Runtime still depends on CDN-hosted Leaflet and globe.gl assets.
- Checkpoint 1 added SRI for `globe.gl` and uniform response security headers.
- Checkpoint 2 added `public/_headers` so Workers static assets now carry the same security headers as API responses in production.

### Deployment and rollback

- Repository guidance and current prompt both indicate GitHub push is the canonical deployment path.
- Production version was observed via cache-busted asset markers, not commit hash headers.
- The checkpoint 1 asset cache-buster `20260713a` was confirmed live in production.
- The checkpoint 2 asset cache-buster `20260713b` was confirmed live in production before its production smoke suite.
- The checkpoint 3 source deployment served cache-buster `20260715b` and passed production verification. The follow-up evidence deployment uses `20260715c`.
