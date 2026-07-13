# Data Entitlement and Licensing Matrix

| Domain | Current source(s) | Authority tier | Licensing / entitlement note | Current project status | Replacement / adapter strategy |
| --- | --- | --- | --- | --- | --- |
| Quotes | Finnhub, TwelveData, FMP, Alpha Vantage, Polygon, Yahoo fallback | mixed | Commercial and free-tier API terms vary; live quality and delay differ | partial | Keep provider adapters isolated and label provider freshness |
| Company profiles / metrics | Finnhub, TwelveData, Alpha Vantage | mixed | Identifier and fundamentals coverage varies by vendor | partial | Normalize output and preserve provider metadata |
| Company news | Finnhub company news | reputable-secondary | Vendor redistribution limits may apply | partial | Preserve URLs and use snippets only |
| Market/world headlines | Publisher RSS feeds, Bing News RSS, Yahoo News RSS, X syndication | mixed | RSS and aggregation licensing differ; avoid storing full text | partial | Normalize metadata only and link to originals |
| Conflict events | GDELT, ACLED public endpoint, UCDP research references | mixed | ACLED/UCDP terms may constrain commercial redistribution and update windows | partial | Adapter-ready with source attribution and coverage labels |
| Earthquakes | USGS | primary | Open public feed with attribution | implemented | Keep direct adapter |
| Natural hazards | NASA EONET, NASA FIRMS, NWS, gpsjam.org | mixed-primary | FIRMS and some derived outputs require compliant use of API key and attribution | partial | Preserve source labels and freshness |
| Flights | ADS-B community feeds, OpenSky | mixed | Terms and availability vary; sensitive-asset precision requires care | partial | Keep viewport-bounded adapters and explicit uncertainty |
| Webcams | Windy | commercial API | Requires configured key and terms-compliant use | partial | Adapter already isolated |
| Push notifications | Browser push services | platform entitlement | Requires user subscription consent and VAPID credentials | partial | Add admin controls and abuse protection |
| Financial-terminal analytics | Open/free data plus internal calculations | mixed | True Bloomberg parity often requires licensed/premium datasets | entitlement-adapter-ready target | Build open-source/open-data defaults with adapter seams |

## 2026-07-13 checkpoint note

- The intelligence pipeline now preserves source URLs, source tiers, timestamps, and reliability labels locally, which is a prerequisite for entitlement-safe linking and honest degraded modes.
- No new licensed or gated datasets were added in this checkpoint.
