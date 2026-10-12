# M001: Fundamentals Dashboard

**Vision:** A user can enter an NSE/BSE stock ticker and instantly see 8 key fundamental-analysis metrics (Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE) sourced live from Yahoo Finance's free unofficial API, with ROCE/ROE derived server-side via a new Node/Express proxy since no free API returns them directly for Indian stocks.

## Success Criteria

- User can enter a known NSE/BSE ticker (e.g. RELIANCE.NS, TCS.NS, INFY.NS) and see all 8 metrics rendered with realistic values
- Invalid ticker shows a clear not-found state, no crash
- Upstream failure shows a retry-able error banner
- Missing/partial financial data shows N/A per-metric rather than failing the whole dashboard
- Repeat lookups of the same ticker within ~5 minutes are served from cache, not re-fetched live

## Slices

- [x] **S01: Proxy foundation and core valuation metrics** `risk:high` `depends:[]`
  > After this: GET /api/stock/RELIANCE.NS on a live local Node/Express proxy returns Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, and Dividend Yield as JSON, fetched live from Yahoo Finance via the yahoo-finance2 package.

- [x] **S02: ROCE and ROE derivation** `risk:high` `depends:[S01]`
  > After this: The same endpoint also returns computed ROCE and ROE, derived server-side from fundamentalsTimeSeries (EBIT, capital employed, net income, equity), with passing unit tests proving the calculation logic against known inputs.

- [x] **S03: Dashboard UI and error handling** `risk:medium` `depends:[S01,S02]`
  > After this: A new Angular route lets a user type a ticker and see all 8 metrics rendered live from the proxy, with working error states for invalid ticker, upstream failure, and partial data.

## Boundary Map

### S01 → S02\nProduces: Express route GET /api/stock/:ticker returning JSON {marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield}; established pattern for calling yahoo-finance2; in-memory cache keyed by ticker (~5 min TTL)\nConsumes: nothing (first slice)\n\n### S01 → S03\nProduces: Same /api/stock/:ticker JSON contract, proxy running locally; error response shapes (404 invalid ticker, 502/timeout upstream failure)\nConsumes: nothing (first slice)\n\n### S02 → S03\nProduces: Extended /api/stock/:ticker JSON contract adding roce and roe fields (numeric or null)\nConsumes: route and caching structure from S01
<!-- gsd:state-version=108:1 -->
