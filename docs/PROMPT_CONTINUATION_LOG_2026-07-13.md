# Market Terminal Prompt Continuation Log

This file is a portable handoff for continuing work on another account. It records the prompts supplied in this task, the authoritative repository instructions, completed checkpoints, verification evidence, and remaining work. It should be read together with [CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md](/Users/krishivjain/Desktop/claude projects/market-terminal/docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md).

## Prompt History

### User prompt 1

> Read `MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md` completely before making changes.
>
> Execute the entire prompt autonomously against this repository. Begin with repository inspection, production-state verification, competitive capability research, the three parity matrices, and the Codex-to-Claude handoff document.
>
> Do not ask me to run commands, approve routine decisions, reduce scope, select the next phase, or confirm whether you should continue. Use sound engineering judgment, fix material defects as you find them, preserve working functionality, and continue through implementation, testing, documentation, deployment verification, and checkpoint commits.
>
> Do not stop after producing an audit or roadmap. Implement working vertical slices. Maintain the parity matrices and Claude handoff after every checkpoint. Never fabricate data, mark placeholders as complete, or claim parity without test and deployment evidence.
>
> Begin now.

### User prompt 2

> continue

### User prompt 3

> create a log with all prompts that were given so it can continue on other account

## Authoritative Prompt Sources

- Full master prompt: [MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md](/Users/krishivjain/Desktop/claude projects/market-terminal/MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md)
- Repository operating instructions: [AGENTS.md](/Users/krishivjain/Desktop/claude projects/market-terminal/AGENTS.md)
- Claude project instructions: [CLAUDE.md](/Users/krishivjain/Desktop/claude projects/market-terminal/CLAUDE.md)
- Project README and current-state reference: [README.md](/Users/krishivjain/Desktop/claude projects/market-terminal/README.md)
- Original project prompt/reference: [prompt.md](/Users/krishivjain/Desktop/claude projects/market-terminal/prompt.md)

The source files above are intentionally referenced rather than duplicated here so the continuation log cannot silently diverge from the authoritative instructions.

## Non-Negotiable Constraints

- Work autonomously through implementation, tests, documentation, deployment verification, and checkpoint commits.
- Use `git push origin main` for production deployment. Do not run `wrangler deploy` manually.
- Bump the frontend cache-buster in `public/index.html` on every deploy.
- Preserve working functionality and do not revert unrelated user changes.
- Do not fabricate data, evidence, parity, production state, or completion.
- Maintain the three parity matrices and the Claude handoff at each checkpoint.
- Treat source URLs, freshness, confidence, and degraded states as first-class evidence.
- Local development uses `npm start`; production URL is `https://market-terminal.wyjjdyxzsc.workers.dev`.

## Completed Work

The following production-oriented vertical slices were implemented and deployed:

- Shared API contract registry and structured API errors in `shared/api-contract.js`.
- Shared evidence normalization and provenance handling in `shared/evidence-core.js`.
- Deterministic candlestick analysis fallback in `shared/candle-analysis-core.js`.
- Express/Worker route parity for price action, candles, map events, weather, flights, and webcams.
- Deprecated `/api/intel/candle` alias with deprecation headers.
- JSON `404`, `405`, and websocket `426` contract behavior.
- Admin protection for diagnostics and push testing.
- Push subscription validation and idempotent subscribe/unsubscribe behavior.
- Security headers for local API responses, Worker responses, and Cloudflare static assets.
- RSS/news provenance preservation, including `sourceUrl`, freshness, status, source count, evidence IDs, and evidence records.
- Trusted server-built chat context; clients no longer submit arbitrary analysis context.
- Frontend URL allowlisting and safer DOM rendering in terminal, intelligence, and map views.
- SRI for the `globe.gl` CDN asset.
- Cache-buster updated to `20260713b`.
- Replaced the unreliable X syndication sentiment path with a deterministic, source-attributed market-sentiment composite. Production verification for this checkpoint is pending deployment.
- Unit tests for API contracts, evidence helpers, and candle analysis.
- Expanded smoke tests covering local and production endpoint contracts.

## Verification Evidence

Local verification completed:

- `node --check server.js` passed.
- `npm test` passed: 9 unit tests and 21 smoke checks.
- New local routes returned JSON instead of SPA HTML.
- Negative contract checks returned JSON `405`, `426`, and `404` as expected.
- Local security headers were present on `/` and API responses.
- In-app browser verification showed the Market Terminal page, live ticker, AAPL quote panel, chart canvas, and graceful sentiment degradation. Browser console errors and warnings were empty during the check.

Production verification completed:

- `npm run test:prod` passed all 28 production smoke checks.
- `/api/intel/candles` returned JSON.
- `/api/intel/candle` returned JSON with `Deprecation: true`.
- Invalid method, websocket-without-upgrade, unknown API, diagnostics, and test-push checks returned the expected structured responses.
- News intelligence payloads included source URLs and evidence metadata.
- Malformed push subscriptions returned `400 invalid_subscription`.
- Production `/` and API responses carried CSP, Permissions-Policy, Referrer-Policy, `X-Content-Type-Options`, `X-Frame-Options`, and `Cross-Origin-Resource-Policy` headers after the static asset header fix.

## Checkpoints

- `aa4f85b` — `Harden API parity and evidence fallbacks`
- `ff58850` — `Add static asset security headers`
- `cb27ef4` — `Record production verification evidence`

All three commits were pushed to `origin/main`. The working tree is clean except for unrelated untracked files listed below.

## Remaining Work

These items are intentionally not marked complete:

- Expand quant-engine unit coverage beyond the candlestick fallback engine.
- Continue modular decomposition of the large `server.js` and `worker.js` files.
- Re-run the full production smoke suite after any subsequent deployment.
- Update this log and the Claude handoff after every future checkpoint commit.

## Unrelated Untracked Files

Do not stage or remove these without explicit user instruction:

- `MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.md`
- `MARKET_TERMINAL_TOTAL_PLATFORM_CODEX_MASTER_PROMPT.txt`
- `worker-startup.cpuprofile`

The master prompt files are untracked but are the authoritative prompt artifacts referenced above.

## Resume Procedure

1. Read this file and [CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md](/Users/krishivjain/Desktop/claude projects/market-terminal/docs/CODEX_HANDOFF_TO_CLAUDE_2026-07-13.md).
2. Read the full master prompt and the repository instruction files listed under “Authoritative Prompt Sources”.
3. Run `git status --short --branch` and inspect any changes before editing.
4. Run `npm test`; use `npm run test:prod` after any production deployment.
5. Choose the next material remaining work item using engineering judgment; do not claim parity until tests and production evidence support it.
6. Commit, push to `origin/main`, verify production, then append the new checkpoint and evidence to this log and the Claude handoff.
