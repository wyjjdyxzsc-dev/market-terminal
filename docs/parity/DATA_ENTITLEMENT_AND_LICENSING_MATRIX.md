# Data Entitlement and Licensing Matrix

| Domain | Current source(s) | Authority tier | Licensing / entitlement note | Current project status | Replacement / adapter strategy |
| --- | --- | --- | --- | --- | --- |
| Quotes | Finnhub, TwelveData, FMP, Alpha Vantage, Polygon, Yahoo fallback | mixed | Commercial and free-tier API terms vary; live quality and delay differ | partial | Keep provider adapters isolated and label provider freshness |
| Company profiles / metrics | Finnhub, TwelveData, Alpha Vantage | mixed | Identifier and fundamentals coverage varies by vendor | partial | Normalize output and preserve provider metadata |
| Company news | Finnhub company news | reputable-secondary | Vendor redistribution limits may apply | partial | Preserve URLs and use snippets only |
| Market/world headlines | Publisher RSS feeds, Bing News RSS, Yahoo News RSS | mixed | RSS and aggregation licensing differ; avoid storing full text | partial | Normalize metadata only and link to originals |
| Conflict events | GDELT, ACLED public endpoint, UCDP research references | mixed | ACLED/UCDP terms may constrain commercial redistribution and update windows | partial | Adapter-ready with source attribution and coverage labels |
| Earthquakes | USGS | primary | Open public feed with attribution | implemented | Keep direct adapter |
| Natural hazards | NASA EONET, NASA FIRMS, NWS, gpsjam.org | mixed-primary | FIRMS and some derived outputs require compliant use of API key and attribution | partial | Preserve source labels and freshness |
| Flights | ADS-B community feeds, OpenSky | mixed | Terms and availability vary; sensitive-asset precision requires care | partial | Keep viewport-bounded adapters and explicit uncertainty |
| Webcams | Windy | commercial API | Requires configured key and terms-compliant use | partial | Adapter already isolated |
| Push notifications | Browser push services | platform entitlement | Requires user subscription consent and VAPID credentials | partial | Add admin controls and abuse protection |
| Financial-terminal analytics | Open/free data plus internal calculations | mixed | True Bloomberg parity often requires licensed/premium datasets | entitlement-adapter-ready target | Build open-source/open-data defaults with adapter seams |
| AI inference | Groq, Cerebras, SambaNova, Together, Mistral, Gemini, DeepSeek, Cohere, GitHub Models, Cloudflare Workers AI, AI21, OpenRouter, Hugging Face | hosted model services | Model access, retention, training use, regional availability, output rights, prices, and rate limits vary by provider/account terms | partial | Keep credentials server-side, maintain a lifecycle registry, use bounded routing, and complete provider-specific legal/privacy review before broader use |

## 2026-07-13 checkpoint note

- The intelligence pipeline now preserves source URLs, source tiers, timestamps, and reliability labels locally, which is a prerequisite for entitlement-safe linking and honest degraded modes.
- No new licensed or gated datasets were added in this checkpoint.

## 2026-07-16 checkpoint note

- No new licensed or gated dataset was added for the AI evidence-policy checkpoint.
- Supply-chain relationships, actionable investment picks, options-chain-dependent output, and country-risk scores are now explicitly withheld until a terms-compliant verified adapter is connected.
- Existing public headline metadata may support contextual research, but it is not treated as an entitlement for issuer fundamentals, relationship graphs, official threat posture, or calibrated country scoring.

## 2026-07-22 checkpoint note

- No new dataset, feed, or entitlement was added for sector interpretation, company-news impact, candle commentary, or alert eligibility.
- Sector ranks, investment picks, and options construction remain withheld because the project has no licensed research/ranking or options-chain input for those claims.
- Company-news output is bound back to existing canonical headline records and links; candle commentary uses the existing OHLC engine; alert eligibility uses existing evidence metadata. These controls improve claim authority but do not broaden redistribution rights or source coverage.
- Canonical event resolution, independent origin-type corroboration, and issuer-grade research remain adapter gaps rather than inferred entitlements.
- Source commit `20c9252` passed production verification without adding or implying any new entitlement; the checkpoint changes authority and disclosure behavior only.

## 2026-07-28 checkpoint 6 note

- The shared provider registry and independent-verification pipeline add model-service controls, not market-data rights. No new quote, issuer, relationship, options, conflict, or intelligence dataset was added.
- Current official model documentation and runtime lifecycle decisions are recorded in `docs/AI_PROVIDER_CAPABILITY_AUDIT_2026-07-28.md`.
- OpenRouter and Hugging Face are excluded from independent high-risk verification because their routing identity is brokered or variable. Nebius's legacy hosted Studio endpoint and OctoAI's obsolete endpoint are disabled.
- Token, call, latency, estimated-cost, and conservative cost-unit budgets constrain service use. These are engineering guardrails, not a substitute for provider-specific terms, privacy, retention, regional, or regulated-use review.
- Local tests verify the controls. No production entitlement or live-provider quality claim is made until the managed deployment and production probes complete.
