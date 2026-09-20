# MT2-5 NEXUS — Public-Company Universe + Supply-Chain Intelligence Graph

Status: approved, moving to implementation plan
Date: 2026-09-20
Owner authorization: MT2-5 NEXUS only. Do not begin MT2-6 through MT2-13.

## Mission

Rebuild "Supply Chain" (currently a permanently-abstaining stub) into a canonical
public-company intelligence graph:

1. Canonical public-company universe.
2. One node for every company in every onboarded listed-company universe (US, India).
3. Evidence-backed relationships between companies and critical dependencies.
4. Measurable coverage.
5. Relationship ratings (deterministic, evidence-derived — never an AI-invented score).
6. Sector / geography / facility integration with ATLAS.
7. A scalable graph/API/UI architecture for future checkpoints (LAUNCHPAD, WORLDWIRE,
   ORACLE, LEDGER, SENTINEL) to consume.

This is infrastructure, not a hand-curated showcase. No cherry-picked subset of the
registry — every active, listed company in an onboarded market must exist as a node.

## Current state (baseline, verified by repo survey 2026-09-20)

- `SUPPLYCHAIN_SYSTEM` prompt exists (`server.js:1422`, `worker.js:1180`) but is never
  sent to a provider.
- `fetchSupplyChain()` (`server.js:1777-1799`, `worker.js:1658`) hardcodes
  `verifiedRelationships: false` and always returns `policyAbstention(...)` with empty
  suppliers/customers/peers.
- Route `GET /api/intel/supplychain` (`server.js:3746`, `worker.js:3632`) is wired but
  always returns the abstention.
- UI `loadSupplyChain()`/`renderSupplyChain()` (`public/intel.js:633-830`) renders the
  abstention reason and never a graph.
- `extensions.supplyChain: 'reserved:MT2-5 NEXUS'` already appears in map-entity payload
  (`server.js:4153`, `worker.js:2973`) — this checkpoint is the intended replacement.
- `shared/atlas-snapshot.js` already ships a generated 4,039-company Wikidata (CC0)
  dataset for NYSE/NASDAQ/NSE/BSE with HQ/geo, built by `tools/atlas-build-snapshot.js`.
  It is a real but incomplete base (Wikidata ticker/exchange coverage is crowdsourced,
  not exhaustive).
- `shared/market-core.js` `parseInstrument()` defines the canonical identity format
  `MARKET:EXCHANGE:SYMBOL` (no provider suffix) — this is the ID scheme NEXUS reuses for
  every graph node.
- `shared/ai-task-policy-core.js` already has an `intel.supply-chain` policy
  (`riskClass:'high'`, heavy provider tier, `requiredEvidenceTypes`, independent
  verifier, `requireEvidenceIds:true`) — currently unused because `fetchSupplyChain`
  never calls it with real inputs. NEXUS activates this policy for tier-2 relationships.
- `shared/atlas-core.js` `createCompanyGeoLink()` is the existing evidence-linked
  company↔location join record shape; `LAYERS` has `industry-sites` /
  `energy-infrastructure` stubs (`renders:false`) explicitly noted as pending NEXUS
  ingestion.
- `shared/api-contract.js` `ROUTES` is the single source of truth both runtimes must
  match; KV cache convention is `cache:{key}` with per-feature TTLs (`TTL.NEWS = 900s`
  for intel-class routes).

## Scope decisions (owner-approved)

- **Markets**: US + India (both onboarded TWINCORE markets). India relationship
  evidence will be structurally thinner (no XBRL-equivalent, no options data) — this is
  disclosed via coverage metrics, not hidden.
- **Registry completeness**: SEC EDGAR `company_tickers.json` (free, keyless,
  exhaustive CIK+ticker+name for every SEC-registered NYSE/NASDAQ/AMEX issuer) is the
  authoritative US base. Official NSE + BSE equity listing CSVs are the authoritative
  India base. Every entry becomes a node regardless of enrichment match — cross-walked
  to the existing Wikidata `atlas-snapshot.js` dataset by ticker+exchange for
  geo/sector where a match exists (`enrichment: 'geo-linked'`), else `'node-only'`.
  Coverage metrics report enrichment tiers honestly rather than claiming uniform depth.
- **Relationship sourcing, tiered**:
  - **Tier 1 — structured, highest confidence**: SEC XBRL `companyfacts` per CIK,
    filtered to `srt:MajorCustomersAxis`/`CustomerAxis` dimensional members on
    concentration-risk concepts. Member labels fuzzy-matched against the registry;
    unmatched members are dropped, never stored as a guessed edge. US-only, expected
    sparse (many filers anonymize members).
  - **Tier 2 — AI-extracted, cited**: activates the existing `intel.supply-chain`
    policy in `ai-task-policy-core.js` (heavy provider tier, independent verifier,
    `requireEvidenceIds`). No citation → abstain (same behavior Deep Dive already has).
    Scoped to companies in `market-core.js`'s existing `indexSymbols`/`benchmarks`
    (S&P-class US + Nifty-class India) as the "meaningful subset" with real edges for
    this checkpoint; full registry still gets nodes regardless.
  - **Tier 3 — structured, ownership only**: Wikidata `P127`/`P749` parent/subsidiary,
    labeled `relation: 'ownership'`, kept distinct from supply-chain dependency edges.
- **Relationship rating**: deterministic, derived from `{tier, sourceCount, recency}` →
  numeric `confidence` (0-1) + label `strength: 'confirmed'|'reported'|'inferred'`.
  Never an AI-assigned arbitrary score.
- **Closure bar**: full registry (every SEC-registered US + NSE/BSE India company as a
  node) + tier-1/tier-3 edges wherever they exist + tier-2 edges for the index-
  membership subset + graph UI replacing the stub + ATLAS cross-links live +
  production-verified (unit tests, smoke contracts, browser pass) like prior
  checkpoints.

## Architecture

Follows the ATLAS pattern exactly — generated sourced snapshot + pure core model + live
API augmentation + frontend consumption. No new datastore (KV + generated `shared/*.js`
module, consistent with the rest of the codebase).

### New files

- `tools/nexus-build-registry.js` — generator (forks `tools/atlas-build-snapshot.js`
  pattern): fetches SEC `company_tickers.json` + NSE/BSE listing CSVs, cross-walks to
  `atlas-snapshot.js` Wikidata companies by ticker+exchange, fetches SEC XBRL
  `companyfacts` for concentration-risk facts (tier 1), fetches Wikidata `P127`/`P749`
  (tier 3), writes `sources{}` provenance block, emits `shared/nexus-snapshot.js`.
  `--verify` flag for spot-checking a sample, matching the ATLAS tool's convention.
- `shared/nexus-snapshot.js` — **generated, do not hand-edit**. Versioned
  (`nexusSnapshotVersion`), contains the company registry (nodes) and structured
  relationship edges (tiers 1 and 3).
- `shared/nexus-core.js` — pure model, no DOM, mirrors `atlas-core.js` conventions:
  `createCompanyNode()`, `createRelationshipEdge()` (validated/frozen, requires
  `{sourceId, targetId, relation, tier, evidence[], confidence, strength}`),
  `computeConfidence({tier, sourceCount, recency})`, `filterGraph()` (bbox-style bounded
  traversal — depth/fanout caps), `registryCoverage()` (coverage metrics),
  `nexusCacheKey()`.
- Tier-2 AI extraction reuses `ai-task-policy-core.js`'s existing `intel.supply-chain`
  policy; no new policy needed, only real inputs (`verifiedRelationships` computed from
  actual evidence availability rather than hardcoded `false`).

### API routes (added to `shared/api-contract.js` `ROUTES`, both runtimes)

- `GET /api/nexus/company?id=&market=` — node detail + coverage badge + relationships.
- `GET /api/nexus/relationships?id=&type=` — edges for one company, with evidence.
- `GET /api/nexus/graph?id=&depth=` — bounded-depth/fanout neighborhood for the graph
  view (same latency guard pattern as ATLAS's entity-drawer 1.5s bound).
- `GET /api/nexus/registry?query=&sector=&market=` — search + coverage stats.
- Existing `/api/intel/supplychain` route is retired in favor of `/api/nexus/company`;
  `DEPRECATED_ALIASES` in `api-contract.js` maps the old path forward.
- KV cache under `cache:nexus:*`, TTLs consistent with existing `TTL` conventions
  (registry/relationship data is closer to `TTL.MAP` = 24h; live augmentation shorter).

### UI (`public/intel.js`, new `public/nexus.js` renderer mirroring `deepdive.js`)

Replaces the dead Supply Chain stub. Company search → node detail (registry data +
coverage badge, enrichment tier shown) → relationship list with evidence citations
(same visual language as Deep Dive's evidence rows, tier/strength/confidence labeled) →
bounded force-graph visualization of the direct neighborhood. Bidirectional ATLAS
links: NEXUS node → `createCompanyGeoLink` → ATLAS geo entity; ATLAS's existing
`openSecurity()` path continues to drill into the Terminal/Deep Dive and now also into
NEXUS.

### Testing

- Unit tests for `nexus-core.js` (node/edge validation, confidence computation, graph
  bounding) mirroring `tests/atlas-core` coverage style.
- Smoke contract additions in `tests/smoke.js` for the new routes (existence, schema,
  degraded-state honesty) — both `npm test` (local) and `npm run test:prod`.
- Browser pass: registry search, a node with tier-1 evidence, a node with tier-2
  evidence, a node with no relationships (honest empty state), ATLAS cross-link both
  directions.

## Explicitly out of scope for this checkpoint

- MT2-6 through MT2-13 (owner directive: stop after NEXUS closure).
- Any market beyond US/India.
- Fabricated or AI-guessed relationships without a citation — abstention is preferred
  over invented data, same standard as Deep Dive/Sentiment.
- A new datastore (D1/SQL) — deferred unless a future checkpoint's scale requires it.
