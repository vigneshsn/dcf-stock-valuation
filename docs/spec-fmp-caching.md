# Spec: FMP caching and call budget

FMP's plan allows 250 calls per day. The app serves long-term investors, so **Data freshness** is measured in days; only the price is kept near-current. Raw FMP responses are cached on disk with long TTLs, shared by every route, and a persisted **Call budget** stops new calls before the limit. Terms are defined in [CONTEXT.md](../CONTEXT.md).

## Decisions

| # | Decision |
| --- | --- |
| 1 | Caching sits inside `fmpGet` (`server/src/fmp.ts`), one JSON file per endpoint + symbol + params in `FMP_CACHE_DIR` (default `server/.cache/fmp`, git-ignored). `/stock` and `/analysis` therefore share one fetch of each endpoint. Derived results keep their in-memory caches, which only save computation. |
| 2 | TTL tiers, each overridable by env var: statements (income, balance sheet, cash flow) 30 days; ratios, profile, peers 7 days; quote 24 h. Flat TTLs, no fiscal-year logic; use Refresh after earnings. |
| 3 | Concurrent requests for the same entry share one in-flight fetch, so a dashboard loading many endpoints on a cold cache pays once. |
| 4 | Empty responses (unknown symbols) are not stored, so a typo does not stick. Expired entries stay on disk (no eviction) and are overwritten by the next successful fetch. |
| 5 | **Call budget**: a UTC-day counter in `usage.json` inside the cache directory. At `FMP_DAILY_LIMIT` (default 240) no new FMP call is made; expired entries are served instead, and with no entry the request fails (429 upstream, 502 to the client). A warning is logged when the limit is reached. Assumes a single server instance. |
| 6 | **Stale** fallback: on 429, 5xx, a network error, or a 402 that is not about the symbol, an expired entry is served instead of an error. Unknown-symbol errors are never masked. |
| 7 | JSON responses built from stale data carry `"stale": true` and `"dataAsOf"` (epoch ms of the oldest stale entry used). They are not kept in the in-memory caches, so fresh data is picked up as soon as it is available. The dashboard shows "Data as of <date>" under the price; there is no blocking banner. |
| 8 | **Refresh**: `?refresh=1` on `/api/stock/:ticker` or any `/api/analysis/:ticker/...` route bypasses the cache for that request and refetches. It still counts against, and is refused by, the Call budget (stale data is served instead). |
| 9 | LLM output (insights, guidance) is already stored on disk per ticker/year/model and never expires; a model change invalidates it. The in-memory layer in front of it rises from 6 h to 24 h (`ANALYSIS_TTL_MS`). `?refresh=1` does not re-run the LLM. |
| 10 | FMP only. IndianAPI behaviour is unchanged except that its in-memory TTL follows the raised `FINANCIALS_TTL_MS` default (24 h). |
| 11 | The Peer set already costs one `/stock-peers` call plus the stock's own cached financials, capped at 5 peers by `selectPeers`; it is fetched by its own endpoint and gets the 7-day tier. |

## Call cost

A cold US ticker costs 5 calls (quote, income, balance sheet, cash flow, ratios) plus profile and, for the Peer set, stock-peers: at most 7. Warm entries cost 0, so 240 calls cover about 35 new tickers a day and unlimited re-visits. Previously the same ticker could cost about 10 calls on every restart or after 5 minutes.

## Configuration

| Variable | Default |
| --- | --- |
| `FMP_CACHE_DIR` | `server/.cache/fmp` |
| `FMP_STATEMENTS_TTL_MS` | 30 days |
| `FMP_PROFILE_TTL_MS` | 7 days |
| `FMP_QUOTE_TTL_MS` | 24 h |
| `FMP_DAILY_LIMIT` | 240 |
| `FINANCIALS_TTL_MS`, `ANALYSIS_TTL_MS` | 24 h |

## Tests

`server/src/test-setup.ts` points `FMP_CACHE_DIR` at a temp directory so tests never touch the real cache. `fmp.test.ts` covers cache hits and shared in-flight fetches, the stale fallback (and that unknown symbols are not masked), and the daily budget.
