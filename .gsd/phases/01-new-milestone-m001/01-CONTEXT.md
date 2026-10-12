# M001: Fundamentals Dashboard

**Vision:** A user can enter an NSE/BSE stock ticker and instantly see the 8 key fundamental-analysis metrics (Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE) sourced live from Yahoo Finance's free unofficial API, with ROCE/ROE derived server-side since no free API returns them directly for Indian stocks.

## Success Criteria

- User can enter a known NSE/BSE ticker (e.g. RELIANCE.NS, TCS.NS, INFY.NS) and see all 8 metrics rendered with realistic values
- Invalid ticker shows a clear "not found" state, no crash
- Upstream failure shows a retry-able error banner
- Missing/partial financial data shows "N/A" per-metric rather than failing the whole dashboard
- Repeat lookups of the same ticker within ~5 minutes are served from cache, not re-fetched live

## Key Risks / Unknowns

- Yahoo Finance's unofficial API has no SLA — schema can change, rate limits are undocumented, could break anytime
- ROCE calculation depends on reliably getting EBIT and Capital Employed from the same financials payload — field availability/naming may be inconsistent across companies
- Yahoo migrated financial-statement data to `fundamentalsTimeSeries` in 2025; legacy `balanceSheetHistory`/`incomeStatementHistory` modules now return limited data — the proxy must use `fundamentalsTimeSeries`, not the legacy modules
- CORS forces a new backend proxy — first backend component in what was a static Angular app

## Proof Strategy

- Unofficial API schema risk → retired in S01 by successfully calling `quoteSummary()` live for a real ticker and mapping fields to the 6 core metrics
- ROCE/ROE field-availability risk → retired in S02 by successfully deriving both ratios from `fundamentalsTimeSeries` for multiple real tickers and unit-testing the math
- CORS/proxy integration risk → retired in S01 by the Angular app successfully calling the local proxy (not Yahoo Finance directly) end-to-end

## Verification Classes

- Contract verification: unit tests for ROCE/ROE calculation logic (S02)
- Integration verification: proxy successfully calls live Yahoo Finance API and returns mapped JSON (S01); Angular dashboard successfully calls proxy end-to-end (S03)
- Operational verification: cache behavior confirmed (repeat requests within 5 min don't re-hit Yahoo Finance); proxy timeout (~10s) confirmed on simulated slow/down upstream
- UAT / human verification: manual check of known tickers (RELIANCE.NS, TCS.NS, INFY.NS) showing realistic values; manual check of invalid ticker, upstream failure, and partial-data UI states

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 8 metrics display correctly for known tickers (RELIANCE.NS, TCS.NS, INFY.NS)
- ROCE/ROE unit tests pass
- Invalid ticker, upstream failure, and partial-data states all verified manually
- Proxy caching confirmed (repeat requests within 5 min don't re-hit Yahoo Finance)
- The Angular dashboard route is live and reachable, not just the proxy in isolation

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007
- Partially covers: none
- Leaves for later: R008 (management quality analysis — deferred), R009 (watchlist — out of scope)
- Orphan risks: none

## Slices

- [ ] **S01: Proxy foundation + core valuation metrics** `risk:high` `depends:[]`
  > After this: `GET /api/stock/RELIANCE.NS` on a live local Node/Express proxy returns Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, and Dividend Yield as JSON, fetched live from Yahoo Finance via the `yahoo-finance2` package.
- [ ] **S02: ROCE/ROE derivation** `risk:high` `depends:[S01]`
  > After this: the same endpoint also returns computed ROCE and ROE, derived server-side from `fundamentalsTimeSeries` (EBIT, capital employed, net income, equity), with passing unit tests proving the calculation logic against known inputs.
- [ ] **S03: Dashboard UI + error handling** `risk:medium` `depends:[S01,S02]`
  > After this: a new Angular route lets a user type a ticker and see all 8 metrics rendered live from the proxy, with working error states for invalid ticker, upstream failure, and partial data.

## Horizontal Checklist

- [x] Every active R### re-read against new code — still fully satisfied
- [ ] Every D### from prior milestones re-evaluated — N/A, no prior milestones
- [ ] Graceful shutdown / cleanup on termination verified — N/A for this milestone's scope (simple proxy process)
- [ ] Revenue / billing path impact assessed — N/A, no billing
- [ ] Auth boundary documented — N/A, no auth in this milestone (single-user local tool)
- [ ] Shared resource budget confirmed — in-memory cache is single-process, acceptable for this scope
- [x] Reconnection / retry strategy verified for external dependency — retry banner + timeout on Yahoo Finance proxy calls

## Boundary Map

### S01 → S02

Produces:
- Express route `GET /api/stock/:ticker` returning JSON: `{ marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield }`
- Established pattern for calling `yahoo-finance2` and mapping its response fields to this app's contract
- In-memory cache keyed by ticker with ~5 min TTL, reusable by S02's additions

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- Same `/api/stock/:ticker` JSON contract, proxy running locally on a known port
- Error response shapes: 404 for invalid ticker, 502/timeout for upstream failure

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- Extended `/api/stock/:ticker` JSON contract adding `roce` and `roe` fields (numeric or `null` if underlying data unavailable)

Consumes:
- The route and caching structure established in S01
<!-- gsd:state-version=108:1 -->
