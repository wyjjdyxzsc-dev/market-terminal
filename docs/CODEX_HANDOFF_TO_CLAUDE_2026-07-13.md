This work was performed by OpenAI Codex without Claude’s involvement. This document exists so Claude can resume the project with complete context and without guessing what changed.

# Status

- Handoff status: checkpoint 6 source commit `919f1b9` production verified; residual evaluation/observability and broader platform parity work remains
- Research dates: baseline 2026-07-13; AI-provider capability refresh 2026-07-28
- Deployment URL: `https://market-terminal.wyjjdyxzsc.workers.dev`

# Starting state

- Starting branch: `main`
- Starting commit: `d394f3b`
- Starting remote: `origin` pointed at the GitHub repository for `wyjjdyxzsc-dev/market-terminal`
- Working tree at start:
  - untracked `AGENTS.md`
  - untracked `MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md`
  - untracked `MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt`
  - untracked `worker-startup.cpuprofile`
- Node runtime observed locally: `v26.0.0`
- Wrangler config at start:
  - `main = "worker.js"`
  - `compatibility_date = "2024-11-01"`
  - `compatibility_flags = ["nodejs_compat"]`
  - assets binding `ASSETS`
  - KV binding `MT_KV`
  - AI binding `AI`
- Frontend cache-buster observed in source and production HTML: `20260705c`

# Initial audit findings

## Confirmed baseline defects

- Express and Worker runtime drift is real.
  - Worker implements `/api/stocks/stream`, `/api/intel/priceaction`, `/api/intel/candles`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, and `/api/map/webcams-live`.
  - Express does not implement those routes and falls through to SPA HTML for several frontend-used `/api/*` paths.
- Express unknown `/api/*` routes return the SPA shell or HTML framework errors instead of structured JSON `404` or `405`.
- Express still exposes `/api/intel/candle` while Worker and frontend expect `/api/intel/candles`.
- `/api/test-push` is unauthenticated and production-reachable.
  - During baseline verification, production returned `200` and attempted delivery to registered devices.
- Worker diagnostics endpoints expose operational detail publicly.
  - `/api/ai-status` and `/api/data-status` are public in production.
  - Express exposes `/api/debug/providers` locally without auth.
- XSS risk exists in `public/app.js` `loadPriceAction()` because AI/provider strings are rendered into `innerHTML` without escaping.
- Multiple URL sinks render external/provider-controlled URLs without protocol allowlisting.
- RSS parsing currently drops source URLs in the shared headline/news pipeline, which weakens provenance.
- Current AI architecture still uses first-valid-JSON race behavior for high-risk analytical tasks.
- Docs are stale and contradictory:
  - `README.md`, `AGENTS.md`, and `CLAUDE.md` still mention `wrangler deploy` and “no tests yet”.
  - `package.json` and repository state include a smoke suite.
- Local Git configuration included an embedded credential in the remote URL; this is local state, not tracked repository content, but should be scrubbed before handoff if operationally safe.

## Baseline verification results

- Production smoke suite at start:
  - `npm run test:prod` passed `20/20`
- Local smoke suite at start:
  - `npm test` passed `14/14` with multiple keyed routes skipped because they returned `500`
- Production route spot checks:
  - `/api/intel/priceaction?symbol=AAPL` -> `200 application/json`
  - `/api/intel/candles?symbol=AAPL&range=1D` -> `200 application/json`
  - `/api/intel/candle?symbol=AAPL&range=1D` -> `404 application/json`
  - `/api/map/events` -> `200 application/json`
  - `/api/map/weather` -> `502 application/json`
  - `/api/map/flights?...` -> `200 application/json`
  - `/api/map/webcams-live` -> `200 application/json`
  - `/api/does-not-exist` -> `404 application/json`
- Local route spot checks:
  - `/api/intel/priceaction?symbol=AAPL` -> `200 text/html`
  - `/api/intel/candles?symbol=AAPL&range=1D` -> `200 text/html`
  - `/api/map/events` -> `200 text/html`
  - `/api/map/weather` -> `200 text/html`
  - `/api/map/flights?...` -> `200 text/html`
  - `/api/map/webcams-live` -> `200 text/html`
  - `/api/does-not-exist` -> `200 text/html`

# Architecture and data-flow changes

- Added `shared/api-contract.js`
  - canonical route registry for Express and Worker
  - deprecated alias mapping for `/api/intel/candle -> /api/intel/candles`
  - structured JSON error payload helper
  - protected-route and websocket-upgrade metadata
- Added `shared/evidence-core.js`
  - normalized evidence records with source URL preservation, timestamps, publisher/source tiers, freshness labels, cluster helpers, and safe URL canonicalization
- Added `shared/candle-analysis-core.js`
  - deterministic candlestick-pattern engine extracted as a shared pure module
  - used as the fallback when AI is unavailable or when 1D intraday OHLC falls back to 5D daily candles
- Added `shared/market-sentiment-core.js`
  - independent benchmark-breadth and financial-headline-lexicon composite used by Express and Worker
- Express and Worker now share the same route-contract semantics:
  - structured JSON `404`
  - structured JSON `405` with `Allow`
  - websocket `426` for `/api/stocks/stream`
  - protected admin routes for diagnostics and push testing
- News/intelligence ingestion now carries source/evidence metadata end to end.

# Security changes

- Added uniform security headers locally and in Worker JSON responses:
  - `Content-Security-Policy`
  - `Permissions-Policy`
  - `Referrer-Policy`
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Cross-Origin-Resource-Policy`
- Added SRI + `crossorigin="anonymous"` for the `globe.gl` CDN script in [public/index.html](/Users/krishivjain/Desktop/claude projects/market-terminal/public/index.html).
- Added admin gate for:
  - `/api/test-push`
  - `/api/ai-status`
  - `/api/data-status`
  - `/api/debug/providers`
- Added strict push-subscription validation:
  - endpoint scheme and hostname allowlist
  - key presence and base64url checks
  - idempotent subscription add/remove behavior
- Removed unsafe `innerHTML` rendering in the price-action view and tightened frontend URL allowlisting in terminal/intel/map flows.

# Canonical API contract changes

- Canonical route: `/api/intel/candles`
- Deprecated alias retained with explicit headers:
  - `Deprecation: true`
  - `Link: </api/intel/candles>; rel="successor-version"`
- Added previously missing Express routes used by the frontend:
  - `/api/intel/priceaction`
  - `/api/intel/candles`
  - `/api/map/events`
  - `/api/map/weather`
  - `/api/map/flights`
  - `/api/map/webcams-live`
- Added Express API catch-all so unknown `/api/*` routes no longer fall through to the SPA shell.
- Added lightweight local websocket implementation for `/api/stocks/stream` to match frontend expectations during local development.
- Added canonical `GET /api/sentiment/market` with transparent benchmark/news evidence and a deprecated `GET /api/sentiment/twitter` alias.

# AI-provider and prompt changes

- Chat route no longer accepts arbitrary client-supplied context.
  - Server now builds trusted context from current quote/news state.
- Intel/news flows now enrich items with:
  - `source`
  - `sourceUrl`
  - `timestamp`
  - `updatedAt`
  - `sourceCount`
  - `status`
  - `freshness`
  - `evidenceIds`
  - `evidence`
  - `confidence`
- `/api/intel/candles` now has a deterministic fallback path:
  - if 1D intraday OHLC is unavailable, it falls back to 5D daily candles
  - if the AI pool is unavailable, it returns a deterministic local pattern analysis
  - degraded responses explicitly disclose fallback behavior
- `shared/ai-provider-registry.js` now owns model IDs, lifecycle status, task/runtime eligibility, context/output limits, conservative cost units, documented pricing, and provider health metadata for both runtimes.
- High-risk and current-market generation now runs sequentially through `shared/ai-verification-core.js`: one bounded generator call, followed by a different-provider/different-canonical-model verifier. A valid verifier rejection is authoritative and missing independence fails closed.
- Policy envelopes expose safe actual runtime metadata: requested/served models, reported token usage or estimates, calls, latency, estimated cost, cost units, verifier status, and budget status.
- `shared/ai-evaluation-core.js` and `tests/fixtures/ai-eval-2026-07-26a.json` provide an offline policy-safety regression suite. They are not represented as live model-quality or factual-accuracy evidence.

# Data-source additions and removals

- Preserved RSS source URLs and publisher metadata through the intelligence pipeline.
- Replaced X/Twitter sentiment ingestion with the independent deterministic market-sentiment composite. X was also removed from the broader world-headline aggregation path.

# UI changes

- [public/app.js](/Users/krishivjain/Desktop/claude projects/market-terminal/public/app.js)
  - safe DOM rendering in `loadPriceAction()`
  - `safeHttpUrl()` and `escHtml()` helpers
  - safer news/profile URL handling
- [public/intel.js](/Users/krishivjain/Desktop/claude projects/market-terminal/public/intel.js)
  - newsroom cards now render source/freshness/evidence metadata
  - chat client sends trusted `symbol` only, not arbitrary context
  - safer outbound links
- [public/mapintel.js](/Users/krishivjain/Desktop/claude projects/market-terminal/public/mapintel.js)
  - webcam/player URLs and images protocol-sanitized
- [public/index.html](/Users/krishivjain/Desktop/claude projects/market-terminal/public/index.html)
  - cache-buster bumped to `20260713b` for the market-sentiment deploy
  - `globe.gl` script now carries SRI
- [public/_headers](/Users/krishivjain/Desktop/claude projects/market-terminal/public/_headers)
  - Cloudflare static-asset security headers for production HTML/assets

# Environment variables, secrets, bindings, migrations, and configuration

- Existing environment-variable names observed:
  - `FINNHUB_API_KEY`
  - `FINNHUB_API_KEY_2`
  - `FINNHUB_API_KEY_3`
  - `FINNHUB_API_KEY_4`
  - `FINNHUB_API_KEY_5`
  - `TWELVEDATA_KEY`
  - `FMP_KEY`
  - `ALPHAVANTAGE_KEY`
  - `POLYGON_KEY`
  - `GROQ_API_KEY`
  - `GEMINI_API_KEY`
  - `OPENROUTER_API_KEY`
  - `CEREBRAS_API_KEY`
  - `TOGETHER_API_KEY`
  - `MISTRAL_API_KEY`
  - `SAMBANOVA_API_KEY`
  - `DEEPSEEK_API_KEY`
  - `COHERE_API_KEY`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT`
  - `WINDY_KEY`
  - `FIRMS_MAP_KEY`
  - `AI_PARALLEL`
  - `GROQ_MODEL`
  - `PORT`
- New variables introduced:
  - `ADMIN_API_TOKEN`

# Exact files changed

- Code/runtime:
  - `server.js`
  - `worker.js`
  - `shared/api-contract.js`
  - `shared/evidence-core.js`
  - `shared/candle-analysis-core.js`
  - `shared/market-sentiment-core.js`
  - `public/app.js`
  - `public/intel.js`
  - `public/mapintel.js`
  - `public/index.html`
  - `package.json`
  - `public/_headers`
  - `tests/smoke.js`
  - `tests/api-contract.test.js`
  - `tests/evidence-core.test.js`
  - `tests/candle-analysis-core.test.js`
  - `tests/market-sentiment-core.test.js`
- Documentation/operating artifacts:
  - `README.md`
  - `prompt.md`
  - `CLAUDE.md`
  - `AGENTS.md`
  - `CHANGELOG.md`
  - `docs/FULL_AUDIT_2026-07-13.md`
  - `docs/parity/CLEAN_ROOM_IMPLEMENTATION_LOG.md`
  - `docs/parity/DATA_ENTITLEMENT_AND_LICENSING_MATRIX.md`
  - `docs/parity/WORLD_MONITOR_CAPABILITY_MATRIX.md`
  - `docs/parity/WAR_MONITOR_CAPABILITY_MATRIX.md`
  - `docs/parity/FINANCIAL_TERMINAL_CAPABILITY_MATRIX.md`
  - `config/capabilities/world-monitor.json`
  - `config/capabilities/war-monitor.json`
  - `config/capabilities/financial-terminal.json`

# Tests added and commands run

## Commands run before code changes

- `git status --short --branch`
- `git log --oneline --decorate -n 20`
- `npm run test:prod`
- `npm start`
- `npm test`
- targeted local and production route probes
- `npm audit --omit=dev --json`

## Results so far

- `npm run test:prod` -> pass
- `npm test` -> pass with skips
- `npm audit --omit=dev --json` -> `0` known vulnerabilities

## Commands run after code changes

- `node --check server.js`
- `npm test`
- targeted local probes for:
  - `/api/intel/priceaction`
  - `/api/intel/candles`
  - `/api/intel/candle`
  - `/api/map/events`
  - `/api/map/weather`
  - `/api/map/flights`
  - `/api/map/webcams-live`
  - `/api/quote` with `POST`
  - `/api/stocks/stream`
  - `/api/ai-status`
  - `/api/data-status`
- local header verification for `/` and `/api/quote?symbol=AAPL`
- in-app browser verification against `http://localhost:3000`

## Post-change results

- `npm test` -> pass
  - unit tests: `9/9`
  - smoke tests: `21/21`
- local API contract probes:
  - `/api/intel/priceaction?symbol=AAPL` -> `200 application/json`
  - `/api/intel/candles?symbol=AAPL&range=1D` -> `200 application/json`
  - `/api/intel/candle?symbol=AAPL&range=1D` -> `200 application/json` with deprecation header
  - `/api/map/events` -> `200 application/json`
  - `/api/map/weather` -> `502 application/json` when NWS rejects upstream request
  - `/api/map/flights?...` -> `200 application/json`
  - `/api/map/webcams-live` -> `502 application/json` without `WINDY_KEY`
  - `POST /api/quote` -> `405 application/json`
  - `GET /api/stocks/stream` -> `426 application/json`
  - `GET /api/ai-status` -> `503 application/json` without `ADMIN_API_TOKEN`
  - `GET /api/data-status` -> `503 application/json` without `ADMIN_API_TOKEN`
- local browser verification:
  - page title `Market Terminal`
  - quote ribbon rendered
  - AAPL quote panel rendered
  - chart canvas present with non-zero dimensions
  - browser console warnings/errors observed: none
- production smoke after deploy:
  - `npm run test:prod` -> `28/28` passed on deployed commit `aa4f85b`
- production targeted verification:
  - `/api/intel/candles?symbol=AAPL&range=1D` -> `200 application/json`
  - `/api/intel/candle?symbol=AAPL&range=1D` -> `200 application/json` with deprecation header
  - `POST /api/quote` -> `405 application/json`
  - `GET /api/stocks/stream` -> `426 application/json`
  - `GET /api/ai-status` -> `503 application/json`
  - `GET /api/data-status` -> `503 application/json`
  - `GET /api/test-push` -> `503 application/json`
  - malformed `POST /api/subscribe` -> `400 application/json`
  - malformed `POST /api/unsubscribe` -> `400 application/json`
  - `/api/intel/news` -> production payload includes `sourceUrl`, `status`, `freshness`, `sourceCount`, and `evidence`
  - `/` and `/api/quote?symbol=AAPL` -> production security headers verified after follow-up commit `ff58850`
- checkpoint 2 local verification:
  - `npm run test:unit` -> `13/13` passed
  - syntax checks passed for `server.js`, Worker module mode, `public/app.js`, and `shared/market-sentiment-core.js`
  - local `/api/sentiment/market` returned `200` with deterministic, source-attributed coverage fields
- checkpoint 2 production verification:
  - production HTML served `app.js?v=20260713b` for deployed commit `55e014c`
  - `npm run test:prod` -> `29/29` passed on 2026-07-15; `/api/map/weather` produced its allowed `502` skip
  - `/api/sentiment/market` at `2026-07-15T12:18:39.910Z` -> `200` with `status: "live"`, `dataMode: "deterministic"`, score `0.298`, five benchmarks, 18 headlines, 13 sources, evidence, and methodology
  - `/api/sentiment/twitter` -> `200` with `Deprecation: true` and `Link: </api/sentiment/market>; rel="successor-version"`

# Production deployment and smoke-test evidence

- Production HTML responded with:
  - status `200`
  - `cf-cache-status: HIT`
  - asset versions `style.css?v=20260705c` and `app.js?v=20260705c`
- Production smoke suite passed against `https://market-terminal.wyjjdyxzsc.workers.dev`
- Post-change production verification completed.
- Production cache-busters observed live: `20260713a` for checkpoint 1 and `20260713b` for checkpoint 2.

# Decisions rejected and why

- Big-bang rewrite rejected.
  - The prompt requires incremental, test-protected modularization.
- Manual `wrangler deploy` rejected for production deployment.
  - Repository instructions and the master prompt require using the canonical GitHub-to-Cloudflare path to avoid drift.
- Any claim of clean parity or “10/10 complete” rejected.
  - Current code and evidence do not support that claim.

# 2026-07-13 checkpoint 2: deterministic market sentiment

- Replaced X syndication ingestion with `shared/market-sentiment-core.js`.
- Added canonical `GET /api/sentiment/market` in Express and Worker.
- Preserved `GET /api/sentiment/twitter` only as a deprecated alias with `Deprecation: true` and a successor link.
- The composite uses quote-pool changes for SPY, QQQ, DIA, IWM, and available VIX data, plus source-attributed RSS headlines.
- Response fields disclose `benchmarkCount`, `headlineCount`, `sourceCount`, `benchmarks`, `evidence`, `methodology`, `dataMode: "deterministic"`, and `status: "live"|"degraded"`.
- Removed X from the broader world-headline aggregation path.
- Local verification completed:
  - `npm run test:unit` -> `13/13` passed
  - syntax checks passed for `server.js`, Worker module mode, `public/app.js`, and the shared module
  - local `/api/sentiment/market` returned `200` with 4 benchmarks, 18 headlines, 7 sources, evidence, and `status: "live"`
  - local deprecated alias returned `Deprecation: true` and a successor link
- Production verification completed on 2026-07-15:
  - production HTML served `app.js?v=20260713b` after the `55e014c` push
  - `npm run test:prod` passed `29/29`; `/api/map/weather` was an explicitly allowed `502` skip
  - canonical payload at `2026-07-15T12:18:39.910Z` was `live` and `deterministic`, with score `0.298`, five benchmarks, 18 headlines, 13 sources, attributable evidence, and methodology
  - deprecated alias returned its `Deprecation: true` and successor `Link` headers
  - production visual browser verification is not claimed for this checkpoint because the browser bridge could not initialize; the page-shell smoke check and asset-version probe passed.

# 2026-07-15 checkpoint 3: map provenance and freshness disclosure

- Added `shared/map-provenance-core.js`, an original shared schema with a `2026-07-15` versioned catalog covering every implemented Leaflet layer plus the infrastructure response.
- The schema intentionally distinguishes `live`, `curated`, `hybrid`, `computed`, and `model-derived` layers. It carries primary-source metadata, authority tier, cache state, configured refresh target, a usage note, and only the source-snapshot/served timestamps actually available to the runtime.
- Express and Worker map payloads retain their established fields and add `provenance` for the layer catalog, earthquakes, natural events, weather alerts, flights, fires, webcams, disease, GPS interference, conflict, and infrastructure.
- Corrected local map-runtime drift:
  - earthquakes now use the Worker-compatible normalized USGS all-day point payload and 15-minute refresh target
  - FIRMS CSV is normalized to the Worker-compatible point payload and uses the same 30-minute refresh target
- `public/mapintel.js` captures the catalog and live endpoint envelopes. Active-layer rows safely render class/status, primary source, cache/refresh cadence, and either an available source snapshot or the truthful response served time. No upstream timestamp is invented.
- New tests: `tests/map-provenance-core.test.js` verifies classification, complete Leaflet-layer catalog coverage, source-note presence, and response-shape preservation. `tests/smoke.js` now asserts map catalog and earthquake provenance contracts.
- Local verification completed on 2026-07-15:
  - `node --check server.js`, Worker module syntax, `node --check public/mapintel.js`, and `node --check shared/map-provenance-core.js` passed
  - `npm run test:unit` passed `16/16`
  - local smoke against `http://localhost:3201` passed `23/23`; keyed/network-dependent routes reported only their documented skips
  - targeted local probe returned a 34-entry `layer-catalog`, a `layer` envelope for earthquakes, and a `conflictZones` envelope for conflict; the unconfigured FIRMS path returned its expected `502`
- Production verification completed for source commit `a25e6be` on 2026-07-15:
  - production HTML served `app.js?v=20260715b` and `mapintel.js?v=20260715b`
  - `npm run test:prod` passed `29/29`; `/api/map/weather` was the explicitly allowed upstream `502` skip
  - targeted production responses returned the 34-entry `layer-catalog`, a `live` earthquakes envelope (265 points at probe time), a `hybrid` conflict envelope, a `live` fires envelope, and a `curated` infrastructure envelope, each with source metadata and a served time
  - production visual browser verification is still not claimed. The browser bridge failed to initialize and the `agent-browser` CLI was unavailable in this session; that limitation is deliberate evidence, not a pass.

# 2026-07-16 checkpoint 4: AI evidence policy and safe abstention

- Added `shared/ai-task-policy-core.js` and loaded it in both runtimes. Policy schema `2026-07-15a` records task risk, approved provider tier/names, required evidence/input thresholds, maximum evidence age, schema intent, corroboration/verifier flags, cache TTL, latency budget, disclaimer, and abstention behavior.
- Provider execution now honors the policy allowlist. Generic educational chat uses the speed tier; current-market chat and high-risk analytical tasks require approved heavy providers and do not silently fall back to speed models.
- Evidence preparation normalizes current source records, rejects stale or insufficient inputs, requires source diversity/trusted sources where configured, builds an evidence-ID allowlist, treats source text as untrusted data, and rejects model responses with missing or out-of-allowlist citations.
- High-risk route behavior:
  - supply chain returns no supplier/customer edges until a verified relationship adapter exists
  - investment report returns no actionable picks until verified market and issuer evaluation inputs exist
  - instability returns no country scores or markers until a verified country-risk source exists
  - deep dive is `Not Rated`; score, fair value, target, entry, stop, options chain, strike, DTE, and IV construction are unavailable
  - price action makes no causal attribution without qualifying current evidence and allowed citations
  - situation room returns unknown posture fields when evidence or the heavy provider policy cannot be satisfied
  - chat ignores arbitrary browser context, validates messages, and constructs trusted quote/headline context on the backend
- High-risk cache keys include `AI_TASK_POLICY_SCHEMA_VERSION`, preventing legacy ungrounded values from being mistaken for policy-compliant cached responses.
- Frontend changes expose explicit `EVIDENCE-GATED RESEARCH` or `RESEARCH WITHHELD` states in terminal, deep dive, report, situation, supply chain, chat, map, and globe views. Source count, source links, as-of time, deterministic verifier label, reason, and disclaimer are rendered through escaped/allowlisted values.
- Tests added in `tests/ai-task-policy-core.test.js` cover policy controls, fresh/trusted/diverse evidence, citation allowlists, abstention, stale evidence, prompt-injection-looking evidence, constrained deep-dive output, generic chat, and backend-owned chat context. `tests/smoke.js` asserts the policy envelope and safe output contract for all affected routes.
- Local verification completed on 2026-07-16:
  - clean dependency installation from `package-lock.json` completed with `npm ci --no-audit --no-fund`
  - `npm audit --omit=dev` reported zero known vulnerabilities
  - Wrangler `4.111.0` bundled the exact Worker and 14 public assets successfully with `deploy --dry-run`; no manual deployment was performed
  - syntax checks passed for both runtimes, all modified frontend modules, the shared policy, and tests
  - `npm run test:unit` passed `24/24`
  - local smoke against the exact working tree passed `28/28`; optional upstream/key failures remained documented skips
  - targeted probes confirmed schema `2026-07-15a`, explicit abstention reasons, empty unsupported edges/picks/country scores, speed-tier generic chat, `Not Rated` deep-dive output, and disabled valuation/trade/options fields
  - the local shell served all seven frontend asset references at cache version `20260716a`
- Environment note: macOS had made Desktop-backed dependency/source files dataless. The files were hydrated and the exact working tree was mirrored to `/tmp/market-terminal-verify` for stable runtime verification. No temporary runtime file is part of the checkpoint.
- Production verification completed for source commit `5a10b79` on 2026-07-16:
  - production HTML served all seven frontend asset references at `20260716a`
  - `npm run test:prod` passed `31/31`; weather was the explicitly allowed upstream `502` skip
  - all guarded routes returned policy schema `2026-07-15a`
  - supply chain returned zero supplier/customer edges, investment report returned zero picks, and instability returned zero country scores
  - deep dive returned `Not Rated`, null score, `Avoid` options bias, and no valuation/trade levels
  - situation returned a grounded heavy-tier response with five allowed evidence IDs; generic educational chat returned a grounded speed-tier response without pretending to cite current evidence
  - interactive in-app browser verification loaded a live AAPL quote, a `718x495` chart, all seven tab views, the supply-chain withheld state, and no console warnings/errors
  - screenshot capture timed out, so no screenshot artifact is claimed
- Scope limit: this is a material partial remediation, not full AI-accuracy completion. The deterministic evidence/citation check is not an independent claim-level model verifier. Sector analysis, company-news impact, candle commentary, alert prioritization, remaining prompt inventory, provider/model-version metadata, enforced token/cost budgets, and measured evaluation metrics remain open.

# 2026-07-22 checkpoint 5: remaining analysis and alert authority

- Policy schema `2026-07-22a` adds four shared tasks in Express and the Worker:
  - sector analysis requires fresh, trusted, source-diverse evidence plus a heavy-tier response whose overall and per-sector citations stay inside the backend allowlist
  - company-news impact requires a heavy-tier cited interpretation; the backend replaces model identity/source/time fields with canonical evidence records and drops uncited items
  - candle commentary is exclusively produced by the deterministic OHLC pattern engine; a provider can no longer replace the calculated pattern, level, trend, or momentum output
  - breaking-alert eligibility is exclusively deterministic and requires source-bound breaking language, evidence no older than three hours, two distinct source domains, and at least one trusted source
- Sector constraints always remove ranks, scores, stock picks, implied-volatility labels, and options construction. Unsupported sectors remain visible as `N/A` with an explicit insufficient-evidence explanation.
- Company-news fallback preserves canonical source headlines and links while marking impact `not rated` when the evidence or approved heavy provider is insufficient.
- Model-supplied `priority: high` is ignored. News items become high priority only after `intel.alert-prioritization` returns `eligible`; persisted Worker alert state is policy-schema-versioned so legacy AI-prioritized alerts are not served.
- Affected news, sector, company, candle, and alert cache/state keys include the policy schema version.
- Frontend sector, watchlist, deep-dive, supply-chain, and alert claims now describe the evidence-gated behavior. Sector ranks/scores render `N/A`, company evidence links are clickable, and eligible alert cards disclose corroborating-source count.
- Dependency hardening upgraded the compatible `body-parser` lockfile entry after `npm audit` identified GHSA-v422-hmwv-36x6.
- Local verification completed on 2026-07-22:
  - `npm run test:unit` passed `29/29`
  - expanded smoke coverage contains 33 checks; the keyless local run passed all 28 available contracts with only documented key/network skips
  - targeted probes returned sector and company abstentions at schema `2026-07-22a`, 11 unranked sectors, zero sector picks, deterministic candles, zero uncorroborated alerts, and no AI-elevated news items
  - `npm audit --omit=dev` reported zero known vulnerabilities after the lockfile update
  - Wrangler `4.113.0` bundled the Worker and 14 assets successfully with `deploy --dry-run` at 345.24 KiB raw / 86.75 KiB gzip; no manual deployment was performed
  - all seven frontend references use cache version `20260722a`
  - an interactive local browser pass rendered the sector withheld state, `N/A` scores across all 11 sectors, an AAPL watchlist fallback with canonical source links, the corroboration-gated alerts state, and no console warnings/errors
- Production verification for source commit `20c9252`:
  - `git push origin HEAD:main` completed and the managed GitHub-to-Cloudflare deployment served all seven `20260722a` asset references
  - `npm run test:prod` passed `33/33`; `/api/map/weather` was the explicitly allowed upstream `502` skip
  - targeted deployed probes returned schema `2026-07-22a`; grounded heavy-tier sector output had 11 unranked sectors, zero picks, and no unspecified recommendation fields; lowercase `aapl` resolved to `AAPL` with canonical-or-withheld company evidence; candle output was deterministic; no ineligible alert entered the high-priority or persisted-alert paths
  - interactive production-browser verification rendered all 11 `N/A` sector ranks/scores with evidence disclosure, the safe lowercase-AAPL watchlist fallback, and the guarded alert state; all seven source cache markers loaded and console/errors were empty
  - browser behavior was reconfirmed on 2026-07-26 against fresh production data; no screenshot artifact is claimed
- Post-verification evidence deployment: all seven frontend references are bumped to `20260726a` in this documentation checkpoint.
- Scope limit: this closes the four named policy-inventory gaps but does not provide an independent claim-level verifier, provider/model-version telemetry, cost budgets, golden AI evaluation metrics, issuer-grade sector datasets, or professional terminal parity.

# 2026-07-28 checkpoint 6: provider lifecycle, budgets, telemetry, and independent verification

- Added `shared/ai-provider-registry.js` with schema `2026-07-26a`.
  - Current official defaults are recorded for five speed providers and eight active heavy/medium providers.
  - Groq, Gemini, DeepSeek, Cohere, Together, and AI21 legacy defaults were migrated.
  - OpenRouter and Hugging Face are not eligible as independent high-risk verifiers because serving identity is variable/brokered.
  - The legacy Nebius hosted Studio and OctoAI paths are disabled.
  - Protected health snapshots retain attempts, successes/failures, cooldowns, requested model, lifecycle note, and bounded failure reason.
- Added `shared/ai-verification-core.js`.
  - Each task receives explicit input/output/call/latency/cost-unit/estimated-USD budgets.
  - Failed calls consume call and cost budgets.
  - Provider usage is normalized when supplied; otherwise the response identifies a token estimate.
  - High-risk tasks require a generator plus a verifier from another provider and canonical model family.
  - Model canonicalization detects aliases such as Cloudflare and hosted GPT-OSS variants, so host diversity alone cannot satisfy model independence.
  - The first valid rejection is authoritative. If no independent verifier passes, the route abstains.
  - A passing verifier must enumerate every evidence ID cited anywhere in the candidate. Selection skips unaffordable candidates while continuing to a later independent provider that fits, and known-price/token projections are checked before each call.
  - A real wall-clock timeout race bounds clients that do not honor `AbortSignal`.
- Updated policy/cache schema `2026-07-28a`; the revision isolates final runtime envelopes from stale KV entries created under the in-progress `2026-07-26a` policy namespace.
  - All generated current-market/high-risk tasks require independent verification.
  - Deterministic candles and deterministic alert eligibility remain zero-model tasks.
  - Safe policy metadata carries actual generator/verifier identities, usage, latency, cost, and budget result.
  - `attachPolicy()` fails closed if a high-risk caller tries to attach output without verified runtime metadata.
- Added `shared/ai-evaluation-core.js`, `tools/run-ai-eval.js`, and `tests/fixtures/ai-eval-2026-07-26a.json`.
  - The 10 recorded cases measure schema handling, evidence precision, unsupported claims, entity/ticker identity, timestamp accuracy, duplicates, abstentions, verifier decisions/rejections, and token/cost/latency budgets.
  - Missing or non-numeric budget observations fail the evaluation instead of being coerced to zero.
  - The deliberately invalid candidates keep candidate metrics below perfect while accepted-output safety thresholds pass.
  - This is an offline regression suite, not a live-provider benchmark, independent fact-check, or proof of financial accuracy.
- Corrected two browser-visible chat defects.
  - A shared classifier keeps conceptual P/E/market-risk questions on the generic educational policy unless the query has explicit current/decision/instrument intent.
  - The AI chat IIFE now has access to the runtime formatter, and metadata-render errors cannot be mislabeled as network failures. The checked flow renders exactly one AI bubble and one policy note.
  - The terminal now exposes its normalized active-symbol context to the intelligence panel; chat uses that public bridge instead of the nonexistent `window.state`, and emits/consumes a `marketsymbolchange` event.
- Frontend policy disclosures identify generated/verified/rejected model paths and bounded runtime totals in chat, deep dive, situation, and price-action surfaces.
- Current local evidence:
  - `npm run test:unit` passed `45/45`
  - `npm run test:ai-eval` passed every declared threshold across 10 versioned cases
  - local smoke passed all 28 contracts available without optional keys
  - targeted generic chat returned task `intel.chat`, an explicit no-provider abstention, zero calls, and verifier `not-required`
  - deterministic candles and guarded analysis routes retained their expected authority envelopes
  - `npm audit --omit=dev` found zero vulnerabilities
  - syntax checks passed for Express, Worker module mode, and the changed frontend/shared files
  - Wrangler `4.114.0` dry-run bundled 14 assets at 399.10 KiB raw / 96.89 KiB gzip; no manual deployment occurred
  - desktop sectors/deep dive, mobile sectors, and educational chat were exercised in the in-app browser; chat had one response/one policy note, showed active context `AAPL`, and browser warnings/errors were empty
- Production verification:
  - source commits `8a8b980`, `4ffe15a`, and `919f1b9` deployed through `main` using the managed GitHub-to-Cloudflare path
  - the initial `8a8b980` production run passed `29/33`; four guarded routes returned stale in-progress KV policy envelopes. This was treated as a material defect, not an allowed skip
  - commit `4ffe15a` advanced the policy/cache schema to `2026-07-28a`, isolating incompatible envelopes. The cold-namespace run and final `919f1b9` run passed `33/33`, with only the documented weather-provider `502` skip
  - production probes found sector and situation generation abstaining after verifier rejection, broad current-market chat abstaining after verifier-stage failure, and company/price-action/deep-dive/report/instability/supply-chain routes abstaining before generation when evidence or required inputs were insufficient
  - deterministic candles remained accepted with zero provider calls; generic educational chat completed through a speed-tier provider with bounded runtime disclosure
  - no generated high-risk/current-market response was accepted during the probes. This verifies fail-closed deployment behavior, not positive live-provider quality
  - desktop `1440x1000` and mobile `390x844` browser checks loaded all seven `20260728b` assets without horizontal overflow or console warnings/errors. Sectors and deep dive remained safely withheld; educational chat rendered one response and one policy note with actual runtime identity; active chat context showed `AAPL`
  - mobile screenshot capture timed out, so no screenshot artifact is claimed
- Detailed current-model evidence and limitations are in `docs/AI_PROVIDER_CAPABILITY_AUDIT_2026-07-28.md`.

# 2026-07-30 checkpoint 7: AI availability and company-evidence repair

- Live diagnosis separated three failure classes instead of treating AI as globally offline:
  - generic educational chat and several evidence-rich high-risk routes could reach configured providers
  - AAPL current-market/company/deep-dive requests failed their evidence gate because Finnhub/Bing redirect hosts hid the actual publisher domain and the AI evidence path did not consume Finnhub company news
  - the local `.env` has Groq but no heavy providers, so generated current-market/high-risk tasks must abstain because they cannot form an independent generator/verifier pair
- Added `shared/company-evidence-core.js` and wired it into Express and the Worker. Ticker-backed company requests combine Bing/Yahoo RSS with Finnhub company news, while company-name requests resolve a ticker before fetching evidence. Chat, company impact, deep dive, and price action now use this company-specific evidence path.
- Evidence schema `2026-07-30a` attributes known publishers behind recognized Finnhub/news-aggregator redirect hosts. The alias cannot override an unrelated article domain, preventing a publisher label from upgrading an arbitrary URL.
- Task-policy/cache and verification schemas moved to `2026-07-30a`, which isolates old company-route abstentions and identifies the new runtime semantics.
- Verified tasks now preserve one independent verifier inside the remaining provider-call and cost budget before spending on another generator. Worker high-risk tasks retain deterministic reliability order instead of rotating a weak generator ahead of the known generator/verifier pair.
- Runtime policy metadata exposes bounded failed-attempt records and safe failure codes. Backend reasons and frontend disclosure distinguish unavailable provider pairs, generation schema/evidence failure, verifier rejection, verifier unavailability, and budget exhaustion.
- Price-action prompts now request the `evidenceIds` that validation already required. Price action also receives company-specific evidence instead of filtering a generic news pool for ticker text.
- Lower-risk Express/Worker races now share a 4,000-output-token ceiling. Per-minute limits receive a short cooldown; explicit daily/quota exhaustion retains the longer cooldown.
- Local verification:
  - `50/50` unit tests passed, including redirect-bound publisher authority, hostile-domain non-upgrade, Finnhub normalization, verifier-budget reservation, and failure-reason cases
  - all thresholds passed for the unchanged 10-case offline AI safety fixture suite
  - local smoke passed `31/31` available contracts; fire, weather, and webcams remained documented optional key/network skips
  - the initial local NEWS probe returned 12 AI-enriched source-linked items with zero degraded fallbacks
  - targeted AAPL current-market chat reached 10 trusted evidence records and returned the explicit two-heavy-provider requirement with zero model calls; company and deep-dive routes reached 14/16 evidence records and two distinct sources before correctly abstaining locally
  - `npm audit --omit=dev` reported zero vulnerabilities
  - Wrangler `4.115.0` dry-run bundled 14 assets; no manual deployment occurred
  - an in-app local browser check rendered one user message, one abstention response, the explicit provider-pair reason, available evidence links, and no console warnings/errors
- Core production verification:
  - source commit `febefb3` deployed through the managed GitHub-to-Cloudflare path and served all seven `20260730a` references
  - `npm run test:prod` passed `33/33`, with only the documented weather-provider `502` skip
  - AAPL and Apple company probes resolved to `AAPL / Apple Inc` with 14 evidence records across two sources; deep dive reached 16 records, price action six, sectors 28, and situation analysis 60
  - educational chat completed through Groq; generated current-market/high-risk attempts failed generation/verification or were rejected, with bounded attempts and specific failure codes disclosed
  - no generated high-risk/current-market response was accepted, so no positive live-provider factual-quality claim is made
- Production-discovered NEWS follow-up:
  - the first deployed NEWS probe returned one non-degraded card from 60 input headlines because the old validator accepted any non-empty result; this was treated as a material defect
  - NEWS schema/cache `2026-07-30b` requires six enriched cards when six inputs exist, isolates the old cache entry, and falls back to canonical source-linked degraded items
  - local follow-up verification passed `50/50` unit tests, all offline thresholds, `31/31` available contracts, zero-vulnerability audit, syntax checks, and Wrangler `4.115.0` dry-run bundling at 408.24 KiB raw / 98.96 KiB gzip
  - a local undersized model batch was rejected and replaced by 14 source-linked degraded cards; all seven source references now use `20260730b`
- Final follow-up production verification:
  - source commit `90c191b` deployed through the managed path and served all seven `20260730b` references
  - the strengthened smoke suite passed `33/33`, with only the documented weather-provider `502` skip
  - normal and forced-fresh `/api/intel/news` probes each returned 12 non-degraded cards, all with canonical source links and evidence IDs; the previous one-card result cannot satisfy the deployed contract
  - the browser rendered all 12 NEWS articles and their evidence links. Current-market AAPL chat reached GitHub generation, then safely abstained when independent verification was unavailable; the UI disclosed two calls, 2,764 tokens, 28,458 ms, four cost units, and the failure stage
  - browser console errors/warnings were empty. No positive high-risk acceptance, new entitlement, or parity-row upgrade is claimed
- The final documentation-only deployment uses all seven `20260801a` cache references.

# Unresolved risks and technical debt

- The repository still has very large `server.js` and `worker.js` monoliths.
- High-risk generated workflows now have an independent model check, but no model verifier proves truth. Live-provider drift canaries, a human-labelled finance/OSINT claim corpus, calibration measurement, and persistent aggregate observability are still missing.
- Quant coverage now exists only for the new candlestick fallback engine, not the broader 40-indicator surface.
- Map source snapshots are not universally supplied by upstreams. The new UI differentiates a provided snapshot from response-served time, but per-feature citations and direct upstream timestamps remain future data-source work.

# Final branch, commits, tags, and working-tree state

- Current branch: `main`
- Checkpoint commits:
  - `aa4f85b` — `Harden API parity and evidence fallbacks`
  - `ff58850` — `Add static asset security headers`
  - `e161369` — `Add prompt continuation log`
  - `55e014c` — `Replace social scraper with market sentiment composite`
  - `a25e6be` — `Add map provenance contracts`
  - `5a10b79` — `Gate high-risk AI outputs with evidence policies`
  - `c062cf2` — `Record AI policy production verification`
  - `20c9252` — `Constrain remaining AI analysis and alerts`
  - `8a8b980` — `Verify high-risk AI outputs independently`
  - `4ffe15a` — `Isolate AI policy cache envelopes`
  - `919f1b9` — `Share active symbol with AI chat`
  - `febefb3` — `Restore AI evidence and provider reliability`
  - `90c191b` — `Require useful AI news batches`
- Push/deploy:
  - `git push origin main` completed for all listed source checkpoint commits through `90c191b`
  - source commits `febefb3` and `90c191b` are production verified on `https://market-terminal.wyjjdyxzsc.workers.dev`

# Recommended next step for Claude

- Next recommended step:
  - add live-provider drift canaries, a human-reviewed finance/OSINT claim corpus, calibration/quality metrics, and persistent aggregate observability
  - continue quant reference coverage and modular decomposition without weakening the abstention or independent-verification contracts
  - treat licensed/professional data and event-grade intelligence gaps as explicit adapters, not inferred or model-generated parity
