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
- Production after-code-change verification: pending deploy

## Findings

| ID | Severity | Confidence | Area | Affected files/functions | User impact | Evidence | Remediation | Test required | Status | Resolved commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | critical | high | Security | `server.js`, `worker.js`, `/api/test-push` | Public callers can trigger real push notifications | Production `POST /api/test-push` returned `200` and reported delivery to registered devices | Add admin auth, strict POST handling, safe target semantics, and regression coverage | Unauthorized and authorized route tests | implemented-local-awaiting-prod | |
| AUD-002 | critical | high | Runtime parity | `server.js`, `public/app.js`, `public/mapintel.js` | Local development returns HTML for frontend-used API routes, masking broken behavior and invalidating parity | Local probes showed `/api/intel/priceaction`, `/api/intel/candles`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, `/api/map/webcams-live` all returning `200 text/html` | Add missing Express routes and canonical API routing rules | Contract tests on local and Worker | resolved-local-verified | |
| AUD-003 | high | high | API contract | `server.js`, `worker.js` | Unknown `/api/*` and wrong methods do not consistently return JSON `404`/`405` | Local `POST /api/quote` returned HTML error page; unknown `/api/does-not-exist` returned SPA HTML locally | Add canonical route manifest and API-first fallbacks | Contract tests for unknown routes and wrong methods | resolved-local-verified | |
| AUD-004 | high | high | XSS | `public/app.js` `loadPriceAction()` | AI/provider data can reach unsafe HTML sinks | `d.catalysts` and `d.headlines` are inserted via `innerHTML` without escaping | Replace with safe DOM rendering or escaped content builders | DOM-sink regression tests | resolved-local-verified | |
| AUD-005 | high | medium | URL safety | `public/app.js`, `public/intel.js`, `public/mapintel.js` | Provider-controlled URLs may allow unsafe protocols or hostile navigation | Multiple `href` and `src` sinks only escape HTML, not protocols | Add `http/https` allowlist helpers and sanitize URL values | Unsafe URL regression tests | resolved-local-verified | |
| AUD-006 | high | high | Provenance | `server.js`, `worker.js`, news ingestion pipeline | Users cannot verify article origins or freshness reliably | RSS parsing preserves title and source name but drops links in the main intelligence feed | Introduce normalized evidence schema with URL preservation and timestamps | Unit tests for RSS parsing and evidence normalization | implemented-local-awaiting-prod | |
| AUD-007 | high | high | AI accuracy | `server.js`, `worker.js` AI race helpers and task handlers | High-risk analyses can present unsupported claims | Current task handlers still rely on provider race success more than evidence grounding | Add task policy registry, evidence requirements, verifier/abstention behavior | AI evaluation fixtures | open | |
| AUD-008 | high | high | Diagnostics exposure | `worker.js` `/api/ai-status`, `/api/data-status`; `server.js` `/api/debug/providers` | Public users can infer provider inventory and operational state | Production returns provider names and cooldown states; local debug route reveals configuration presence | Remove, redact, or protect diagnostics | Auth and response-shape tests | implemented-local-awaiting-prod | |
| AUD-009 | medium | high | Documentation drift | `README.md`, `CLAUDE.md`, `AGENTS.md`, `prompt.md` | Operators and future agents may use wrong deploy path or miss tests | Docs still say “No tests yet” and mention manual `wrangler deploy` | Reconcile docs to verified behavior and current deployment policy | Documentation review plus command verification | resolved-local-verified | |
| AUD-010 | medium | high | Browser security | `public/index.html`, `server.js`, `worker.js` | CSP and supply-chain controls are incomplete | Third-party assets load from `unpkg.com`; `globe.gl` lacks SRI; no strong response security headers observed in code | Add security headers, SRI where possible, and document remaining external dependencies | Header and HTML assertions | implemented-local-awaiting-prod | |
| AUD-011 | medium | medium | Push subscription validation | `server.js`, `worker.js` | Abuse and malformed subscriptions can enter storage | `/api/subscribe` only checks `endpoint` and, in Worker, `keys` presence | Add schema validation, body checks, idempotence, and endpoint policy | Subscription security tests | implemented-local-awaiting-prod | |
| AUD-012 | medium | medium | Source reliability | `server.js`, `worker.js` X/Twitter sentiment module | Unreliable feed can be presented as live market intelligence | Repo notes already say the syndication source is unreliable; route still exists and production currently responds | Rename, degrade clearly, or replace with multi-source sentiment signals | Source health and UI-state tests | open | |
| AUD-013 | medium | high | Map provenance | `server.js`, `worker.js`, `public/mapintel.js` | Users cannot consistently distinguish live, curated, estimated, or stale infrastructure layers | Many map layers lack first-class provenance metadata and status labeling | Add provenance/status fields and UI display | API schema and UI tests | open | |
| AUD-014 | medium | medium | Quant validation | `public/quant.js` | Mathematical correctness is largely unverified | No reference/unit suite exists for the indicator surface | Add deterministic reference tests and known limitations | Unit tests with fixtures | partially-resolved-local | |
| AUD-015 | low | high | Repository hygiene | local working tree, packaging process | Unsafe exports can include ignored files and local artifacts | Local repo contains `.env`, `.DS_Store`, `.wrangler`, `worker-startup.cpuprofile`, and `node_modules` in workspace | Add safe packaging/export script or procedure; keep ignored artifacts out of tracked state | Script verification | open | |

## Area notes

### Architecture

- `server.js` and `worker.js` are large monoliths and have drifted despite similar intent.
- Incremental modularization is justified for shared contracts, evidence normalization, and security policy.

### Worker/Express parity

- Production Worker is materially ahead of local Express for several frontend-used routes.
- This undermines local debugging, makes smoke coverage optimistic, and hides route regressions.
- Checkpoint 1 introduced a shared API contract manifest plus missing Express parity routes.
- Local parity is now verified; production parity still requires a push and deployed smoke pass.

### Frontend/backend contract

- Frontend references `/api/intel/priceaction`, `/api/intel/candles`, `/api/stocks/stream`, `/api/map/events`, `/api/map/weather`, `/api/map/flights`, and `/api/map/webcams-live`.
- Express does not provide those contracts at baseline.

### Dependencies and supply chain

- `npm audit --omit=dev --json` reported zero current vulnerabilities.
- Runtime still depends on CDN-hosted Leaflet and globe.gl assets.
- Checkpoint 1 added SRI for `globe.gl` and uniform response security headers.

### Deployment and rollback

- Repository guidance and current prompt both indicate GitHub push is the canonical deployment path.
- Production version was observed via cache-busted asset markers, not commit hash headers.
- The updated local asset cache-buster is `20260713a`; production was still on `20260705c` at the end of this checkpoint and must be re-verified after push.
