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
- Checkpoint commits:
  - `aa4f85b` `Harden API parity and evidence fallbacks`
  - `ff58850` `Add static asset security headers`
