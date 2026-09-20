# Project Meridian — STATE (recovery capsule)

PROJECT: Market Terminal 2.0 — Project Meridian
CHECKPOINT: MT2-4 ATLAS — geographic market-intelligence foundation
STATUS: PASS — CLOSED 2026-09-21. Deployed 898eb88 → 24b51df (assets 20260921b); test:prod 60/60 then
  57/57 (Finnhub-search throttle skips); production browser pass desktop + mobile incl. TSMC →
  NYSE:TSM → Terminal. OWNER acceptance not yet recorded; POCKET WKWebView pass not claimed (B-033).
PREVIOUS: MT2-3 TWINCORE — PASS (cd28830). POCKET side-track — PASS.
CANONICAL LOCAL PATH: /Users/krishivjain/Developer/market-terminal (non-iCloud clone of
  origin/main, created this checkpoint; .env, owner files and ios/Config/Local.xcconfig copied).
  The iCloud copy at ~/Desktop/claude projects/market-terminal is untouched and must not be used
  for engineering (B-001/B-023). The local run mirror ~/Library/Developer/market-terminal-run is
  superseded by the canonical path.
ROUTE: claude-opus-5 / SERIAL / bypass-permissions — re-derived for MT2-4 (MIXED); sufficient.
GIT: branch main; start HEAD cd28830; ATLAS commit(s) on top. Assets 20260921a (ten synchronized
  refs — atlas.js added). Untracked owner files preserved.
OBJECTIVE: rebuild the map from a visualization into a sourced geographic intelligence system:
  GeoEntity / MapLayer / CompanyGeoLink / GeoEvent, reusable map API, clustering, search, detail
  drawer, company → security path, provenance and coverage truth, NEXUS/LAUNCHPAD/WORLDWIRE seams.
DONE: iCloud relocation; roadmap corrected (ATLAS=MT2-4 … CONVERGENCE=MT2-13); map audit with
  root causes; dataset licence research (D-010); tools/atlas-build-snapshot.js (Wikidata CC0
  companies for NSE/BSE/NYSE/Nasdaq + reference verification, Natural Earth PD ports/airports,
  WRI GPPD CC BY 4.0 plants) → shared/atlas-snapshot.js (4,039 companies, 1,081 ports, 847
  airports, 1,653 plants, 55 reference points 53 verified); shared/atlas-core.js (+20 tests incl.
  the six negative controls and a 50k stress test); /api/map/{atlas,entities,entity,search,
  geoevents} in server.js and worker.js (parity); public/atlas.js (registry panel, server
  clustering below z7, viewport fetch, search, drawer, company → Terminal / Deep Dive via
  window.MarketTerminal.openSecurity, market emphasis, mobile collapse); retired invented
  geometry + TeleGeography ingestion + Infrastructure canvas; keyless OSM dark tiles with
  attribution (B-015 fixed); aircraft layer proxy-only (B-003 fixed); smoke +12 contracts (56/56
  local); unit 116/116; ai-eval pass; Wrangler dry-run 2.2 MB / 385 KB gzip; local browser pass
  desktop + mobile portrait/landscape, US and INDIA emphasis, search → drawer → Terminal.
OPEN: B-001/B-023 (owner: old iCloud copy remains), B-002, B-004 (legacy timers), B-016…B-019,
  B-021, B-022, B-024…B-027, B-028…B-033. CLOSED this checkpoint: B-003, B-015.
NEXT EXACT ACTION: none. MT2-4 is closed. MT2-5 NEXUS requires explicit OWNER authorization
  (entry: ATLAS closed — satisfied; a DECISIONS record on the listed-company universe and
  relationship evidence model). Owner-side: archive the frozen iCloud copy (B-001/B-023);
  optional POCKET map pass on the phone (B-033).
