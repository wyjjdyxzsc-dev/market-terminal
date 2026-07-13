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
