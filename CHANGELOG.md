# Changelog

## 2026-07-16

- Added `shared/ai-task-policy-core.js`, a shared Express/Worker registry for AI task risk, provider allowlists, evidence freshness/diversity requirements, deterministic citation validation, output constraints, and structured abstention metadata.
- Rebuilt high-risk supply-chain, deep-dive, investment-report, situation, instability, price-action, and current-market chat paths so unavailable evidence or policy-approved providers produce explicit research-withheld responses instead of unsupported relationships, country scores, recommendations, prices, or options constructions.
- Kept generic educational chat on the speed tier while current-market and high-risk tasks require the heavy tier; client-supplied authoritative chat context remains rejected.
- Added safe evidence-policy UI states across terminal, deep-dive, report, situation-room, map, globe, and chat surfaces.
- Added eight AI-policy unit cases and expanded smoke assertions. Local verification passed `24/24` unit tests and `28/28` smoke contracts.
- Bumped all frontend cache-busters to `20260716a` for the source deployment.
- Deployed source checkpoint `5a10b79`: production served all seven `20260716a` asset markers, the production smoke suite passed `31/31`, and targeted routes confirmed safe abstention/constraint behavior plus grounded cited output where policy inputs were satisfied.
- Interactive production-browser verification loaded AAPL at a live quote, rendered a non-zero chart, switched all seven tabs, displayed the supply-chain evidence-required state, and reported no console warnings/errors. Screenshot capture timed out, so no screenshot artifact is claimed.
- Bumped all frontend cache-busters to `20260716b` for the production-evidence deployment.

## 2026-07-15

- Added `shared/map-provenance-core.js`, a versioned source/freshness catalog covering every Leaflet layer and infrastructure response.
- Added provenance envelopes to map APIs in both Express and the Worker without changing the existing map payload fields.
- Brought local earthquake and active-fire responses into the Worker-compatible `{ cached, points }` shape and aligned their refresh targets.
- Added safe map-panel disclosure of data class, current status, primary source, cache state, refresh target, and an honest snapshot or served time.
- Added map-provenance unit coverage and smoke assertions. Local verification passed: syntax checks, `16/16` unit tests, and `23/23` smoke checks; optional keyed/network routes were explicitly skipped.
- Deployed source checkpoint `a25e6be`: production served `app.js?v=20260715b` and `mapintel.js?v=20260715b`; `npm run test:prod` passed `29/29` with only the allowed weather-provider skip. Targeted production routes returned the 34-entry catalog plus live, hybrid, and curated layer envelopes.
- Bumped the frontend cache-buster to `20260715c` for this production-evidence documentation deployment.

## 2026-07-13

- Revision author: OpenAI Codex
- Status: production-verified checkpoint complete
- Added live audit, parity, licensing, and Claude handoff documents for the total-platform revision.
- Verified baseline production and local behavior before implementation.
- Added shared API contract, evidence normalization, and deterministic candle-analysis modules under `shared/`.
- Restored local runtime parity for frontend-used API routes and enforced structured JSON `404`/`405`/`426` behavior.
- Protected push-test and diagnostics endpoints behind `ADMIN_API_TOKEN` and added stricter push-subscription validation.
- Hardened frontend rendering and URL handling in terminal/intel/map flows.
- Expanded `npm test` to run unit tests plus a 21-route local smoke suite, and added browser verification evidence for the local app.
- Bumped the frontend cache-buster to `20260713a` and added SRI for the `globe.gl` CDN script.
- Added `public/_headers` and verified security headers on the deployed HTML shell and API responses.
- Replaced unreliable X syndication sentiment with `/api/sentiment/market`, a deterministic benchmark-breadth and attributable-RSS composite with evidence counts, methodology, and degraded coverage disclosure. `/api/sentiment/twitter` is now a deprecated compatibility alias.
- Added shared market-sentiment unit coverage and expanded smoke coverage for the canonical endpoint and alias.
- Bumped the frontend cache-buster to `20260713b`.
- Verified the deployed market-sentiment slice: production served `20260713b`, `npm run test:prod` passed `29/29` on 2026-07-15, and the legacy alias returned its deprecation/successor headers.
- Bumped the frontend cache-buster to `20260715a` for this production-verification documentation deployment.
- Checkpoint commits:
  - `aa4f85b` `Harden API parity and evidence fallbacks`
  - `ff58850` `Add static asset security headers`
  - `e161369` `Add prompt continuation log`
  - `55e014c` `Replace social scraper with market sentiment composite`
