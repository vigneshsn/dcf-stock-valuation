# M001: New milestone M001

This draft was captured automatically from structured question responses.
Use it so `/gsd` can resume the in-flight milestone discussion.

## Captured Question Round — 2026-09-19T19:50:38.866Z

### Market / Exchange

Which market are these stocks from? This determines which free API is viable.

- **Indian stocks (NSE/BSE) (Recommended)** — Use yfinance-style unofficial API with .NS/.BO tickers; ROCE/ROE need derivation from financial statements since no free API returns them directly.
- **US stocks** — Use Alpha Vantage or Financial Modeling Prep free tier; ROCE/ROE still need derivation from raw financials, not directly provided.
- **Both / market-agnostic** — Design ticker input to be exchange-flexible; likely still land on Yahoo Finance unofficial data as the common denominator.

**Selected:** Indian stocks (NSE/BSE) (Recommended)

## Captured Question Round — 2026-09-19T19:51:36.930Z

### Dashboard Scope

Is this a single-company lookup (enter a ticker, see its metrics) or a watchlist of multiple companies at once?

- **Single company lookup (Recommended)** — User enters/searches one NSE/BSE ticker at a time, dashboard shows that company's metrics. Simpler to build, matches DCF calculator's existing single-company pattern.
- **Watchlist / multiple companies** — User maintains a list of tickers and sees a table/grid of metrics across companies. More UI work, more API calls, needs local watchlist storage.

**Selected:** Single company lookup (Recommended)

### ROCE/ROE Sourcing

Since no free API returns ROCE/ROE directly for Indian stocks, how should we get them?

- **Derive from financial statements (Recommended)** — Fetch raw financials (EBIT, capital employed, net income, equity) from Yahoo Finance and compute ROCE = EBIT/Capital Employed and ROE = Net Income/Equity ourselves.
- **Defer ROCE/ROE for now** — Show only what's directly returned by the API (Market Cap, Price, 52wk, P/E, Book Value, Div Yield) and skip ROCE/ROE for this milestone, revisit later.

**Selected:** Derive from financial statements (Recommended)

## Captured Question Round — 2026-09-19T19:54:24.845Z

### API Access Layer

How should the Angular app reach Yahoo Finance's unofficial API given likely CORS restrictions?

- **Add a small backend proxy (Recommended)** — Add a minimal Node/Express (or similar) backend that proxies requests to Yahoo Finance and does the ROCE/ROE math server-side. Clean, reliable, but adds a new deployable service and changes this from a pure static Angular app.
- **Use a public CORS proxy service** — Route requests through a public CORS-bypass proxy (e.g. corsproxy.io, allorigins.win). No backend to build/host, but depends on a third-party proxy's uptime and is not production-grade.
- **Serverless function proxy** — Use a serverless function (Vercel/Netlify/Cloudflare Worker) as the proxy instead of a full backend. Similar to option 1 but lighter-weight to deploy alongside a static frontend.

**Selected:** Add a small backend proxy (Recommended)

## Captured Question Round — 2026-09-19T19:54:52.959Z

### Backend Proxy Setup

Where should the backend proxy live?

- **Separate /server folder in same repo (Recommended)** — New folder e.g. /server at repo root with its own package.json, run separately from `ng serve` during dev (two processes).
- **Separate repo** — A new standalone repo entirely, deployed and versioned independently of the Angular frontend.

**Selected:** Separate /server folder in same repo (Recommended)

### Data Freshness

Should the proxy cache responses, or always fetch live from Yahoo Finance?

- **No caching — always live (Recommended)** — Every dashboard load/search hits the proxy which hits Yahoo Finance live. Simple, always fresh, but hits unofficial API more often (risk of throttling).
- **Short in-memory cache (e.g. 5 min)** — Proxy caches each ticker's response in memory for a few minutes to reduce repeated calls to Yahoo Finance and reduce throttling risk.

**Selected:** Short in-memory cache (e.g. 5 min)

## Captured Question Round — 2026-09-19T19:56:02.800Z

### Error Handling Depth

Want to go deep on error handling, or should I apply sensible defaults given the architecture above?

- **Apply sensible defaults (Recommended)** — Invalid ticker shows a clear "not found" message, upstream failures show a retry-able error banner, missing fields (e.g. no ROCE data available) show "N/A" per-metric rather than failing the whole dashboard.
- **Go deep on error handling** — Walk through specific failure scenarios (rate limiting, partial data, timeout duration, retry policy) in detail before locking this in.

**Selected:** Apply sensible defaults (Recommended)

## Captured Question Round — 2026-09-19T19:57:23.392Z

### Definition of Done

What's the testing/verification bar for this milestone?

- **Manual verification only (Recommended)** — Manual verification: enter a few known NSE tickers (e.g. RELIANCE, TCS, INFY), confirm all 8 metrics display correctly and match known real-world values approximately. No automated test suite required for this milestone.
- **Manual + unit tests for ROCE/ROE math** — Manual verification plus a handful of automated unit tests for the ROCE/ROE calculation logic specifically, since that's custom derived logic most prone to bugs.

**Selected:** Manual + unit tests for ROCE/ROE math

## Captured Question Round — 2026-09-19T19:57:50.605Z

### Depth Check

Did I capture the depth right?

- **Yes, you got it (Recommended)** — Proceed to requirements and roadmap.
- **Not quite — let me clarify** — I'll explain what's missing or wrong before we proceed.

**Selected:** Yes, you got it (Recommended)
