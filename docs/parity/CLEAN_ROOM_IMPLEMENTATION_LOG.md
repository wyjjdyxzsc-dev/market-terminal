# Clean-Room Implementation Log

This file records how parity work is implemented without copying protected code, assets, prompts, schemas, or tests from external products.

## Rules

- Research source: public product sites, public docs, official app listings, and public release/support pages.
- Forbidden source material for implementation:
  - World Monitor AGPL source code, prompts, assets, tests, schemas, and styles
  - proprietary Bloomberg Terminal content, entitlements, trade dress, and documentation not publicly available
  - any paid or gated War Monitor internals
- Allowed parity target: independently implemented workflows and outcomes.

## 2026-07-13 baseline

- World Monitor research used:
  - `https://www.worldmonitor.app/`
  - `https://www.worldmonitor.app/docs/data-sources`
  - public GitHub repository metadata only for license and surface confirmation, not code porting
- War Monitor research used:
  - `https://war-monitor.com/`
  - public Google Play listing for `com.onuraltun.warmonitor`
  - `https://war-monitor.com/methodology`
- Bloomberg research used:
  - `https://professional.bloomberg.com/products/bloomberg-terminal/`
  - `https://professional.bloomberg.com/products/`
  - `https://professional.bloomberg.com/products/data/data-connectivity/server-api/`
  - `https://professional.bloomberg.com/products/bloomberg-terminal/portfolio-analytics/`
  - `https://professional.bloomberg.com/products/bloomberg-terminal/research/`
  - `https://professional.bloomberg.com/products/bloomberg-terminal/news/`
  - `https://professional.bloomberg.com/products/trading/order-management-system/`

## Implementation notes

- The existing project already contains independent vanilla JS, Express, and Worker implementations.
- Planned shared abstractions:
  - normalized evidence records
  - canonical API contract manifest
  - task-policy registry for AI risk classes
- No external source code has been copied into this repository during this revision.

## 2026-07-13 checkpoint 1

- Implemented from internal clean-room logic:
  - `shared/api-contract.js`
  - `shared/evidence-core.js`
  - `shared/candle-analysis-core.js`
- The deterministic candlestick fallback reuses local math/pattern logic from this repository’s own `public/quant.js` concepts rather than any external product behavior or source.
- Public-product research informed capability goals, provenance expectations, and deployment posture only; no external prompts, tests, code, schemas, or UI assets were copied.

## 2026-07-13 checkpoint 2

- Re-scoped the unreliable X syndication sentiment workflow to an independent deterministic market-sentiment composite.
- The implementation uses this project’s own benchmark breadth calculation and financial-headline lexicon in `shared/market-sentiment-core.js`.
- Attributable RSS evidence and quote-provider labels are retained in the API payload; no external social-media code, prompts, schemas, assets, or tests were copied.
- The legacy `/api/sentiment/twitter` path is retained only as a documented deprecation alias to `/api/sentiment/market`.
- Production verification on 2026-07-15 confirmed the independently implemented route through the `29/29` production smoke suite and a live payload containing five benchmarks, 18 headlines, 13 sources, evidence, and disclosed methodology.

## 2026-07-15 checkpoint 3

- Implemented `shared/map-provenance-core.js` as an original project-local schema and browser disclosure pattern; no external map code, prompts, schemas, styles, or tests were copied.
- Public source names and URLs are retained only as attribution metadata for existing project feeds and curated reference data. The schema distinguishes public live feeds, curated project references, hybrid augmentation, browser-computed overlays, and model-derived risk views rather than reproducing any external product taxonomy.
- Local Express normalization was based on this repository's Worker response shape and existing map consumers, not external source code. Production verification is intentionally recorded separately after deployment.
- Production verification for source commit `a25e6be` completed on 2026-07-15: deployed assets served `20260715b`, the production smoke suite passed `29/29`, and targeted map payloads showed the independent 34-entry catalog and provenance envelopes. No external code or protected product material was introduced during the deployment evidence pass.

## 2026-07-16 checkpoint 4

- Implemented `shared/ai-task-policy-core.js`, policy-aware provider routing, abstention envelopes, and evidence-policy UI states from original project-local logic.
- Public competitor capability descriptions informed only the desired outcomes of evidence grounding, uncertainty, and safe research workflows. No external prompt, model policy, response schema, code, test, protected UI, or proprietary scoring method was copied.
- The checkpoint adds no new licensed dataset. Where verified relationship, issuer evaluation, options-chain, or country-risk inputs do not exist, the original implementation emits an explicit empty/withheld result rather than simulating competitor coverage.
- Local verification passed `24/24` unit tests and `28/28` smoke contracts. Source commit `5a10b79` then passed `31/31` production checks while serving `20260716a`; no new parity claim is made beyond the independently implemented safety workflow.

## 2026-07-22 checkpoint 5

- Extended the project-local task-policy design to sector interpretation, company-news impact, deterministic candle commentary, and deterministic alert eligibility. The implementations were derived from this repository's existing evidence records, OHLC engine, news adapters, and push pipeline.
- Sector rankings, stock picks, options construction, model-authored alert priority, and uncited company-news facts are removed or withheld. This is an original authority-boundary design, not a reproduction of competitor prompts, ranking systems, alert logic, schemas, or user interfaces.
- The alert gate checks project-normalized source evidence for recency, trust, source diversity, and bounded breaking-event language. It does not claim canonical event resolution or competitor-equivalent corroboration.
- No new external code, proprietary prompt, protected asset, test, or licensed dataset was copied. Local verification passed `29/29` unit tests and all 28 smoke contracts available in the keyless environment; source commit `20c9252` then passed `33/33` production contracts and interactive browser verification. No new parity claim is made.

## 2026-07-28 checkpoint 6

- Implemented an original project-local provider lifecycle registry, bounded execution telemetry, and sequential generator/verifier pipeline. The verifier uses a different provider and canonical model family, and high-risk tasks abstain if independence, evidence, schema, or budget checks fail.
- Public provider documentation informed only current model IDs, declared capabilities, lifecycle decisions, pricing inputs, and routing limitations. No provider prompt, proprietary benchmark, response, hidden policy, competitor code, protected UI, or third-party test was copied.
- Added a versioned offline safety fixture set built from synthetic project-policy cases. It is explicitly not represented as a live model benchmark, factual-quality proof, or competitor evaluation.
- No market-data entitlement or research authority was added. Existing unsupported rankings, picks, trade levels, relationship graphs, options output, and country scores remain withheld.
- Local evidence passed `45/45` unit tests, the 10-case AI evaluation thresholds, all 28 smoke contracts available in the keyless environment, dependency audit, Worker dry-run bundling, and interactive browser checks.
- Source commits `8a8b980`, `4ffe15a`, and `919f1b9` deployed through the managed path. The first production run exposed stale KV policy envelopes; the project-local schema-isolation fix was deployed and final source commit `919f1b9` passed `33/33` deployed contracts plus targeted and browser checks. Live high-risk verifier attempts failed closed, so no positive model-quality or parity claim is made.

## 2026-07-30 checkpoint 7

- Implemented `shared/company-evidence-core.js`, redirect-bound publisher attribution, verifier-budget reservation, provider-attempt disclosure, and provider cooldown/output-limit reconciliation from this repository's own adapters and observed runtime failures.
- The company evidence adapter normalizes Finnhub metadata already licensed/configured by this project. It does not copy external research, full articles, competitor schemas, prompts, ranking logic, tests, or UI.
- Publisher aliases can restore the known source behind a recognized Finnhub/news-aggregator redirect but cannot upgrade an unrelated article domain. This is a project-local evidence-authority rule.
- No competitor research was needed for this repair and no new protected material was consulted. Existing public provider documentation remains limited to the lifecycle audit recorded in checkpoint 6.
- Local evidence passed `50/50` unit tests, all offline AI thresholds, `31/31` available contracts, dependency audit, Worker dry-run bundling, targeted provider/evidence probes, and browser checks. Production verification is pending, and no parity status changes.
