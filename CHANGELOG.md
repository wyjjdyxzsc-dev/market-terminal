# Changelog

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
