## Summary

The repo is a pure Angular 20 frontend (`dcf-stock-valuation`) with no backend at all — no `server/`, no Express, no `yahoo-finance2` dependency currently in `package.json`. This slice must create a new Node/Express proxy from scratch (likely a sibling folder, e.g. `server/`, with its own `package.json`, or a root-level `server.ts`/`server.js` + scripts entry) that exposes `GET /api/stock/:ticker` and returns the 6 core metrics as JSON.

`yahoo-finance2`'s `quote(symbol)` call returns all 6 required fields directly on one object — no need for `quoteSummary` with multiple modules for this slice: `marketCap`, `regularMarketPrice` (current price), `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `trailingPE` (Stock P/E), `bookValue`, and `trailingAnnualDividendYield` (or `dividendYield`, verify exact field name at runtime — Yahoo's schema has shifted between `dividendYield` and `trailingAnnualDividendYield` across versions). For NSE tickers, symbols must be suffixed `.NS` (e.g. `RELIANCE.NS`); BSE uses `.BO`. This matches the ticker format already implied by the roadmap.

Recommend a minimal standalone Express server (TypeScript or plain JS, matching root `tsconfig` conventions since the Angular app is already TS) with a single route module, an in-memory Map-based cache (ticker → {data, timestamp}) with a 5-minute TTL check inline (no external cache lib needed for this scope — R005), and try/catch around `yahooFinance.quote()` to map upstream/lookup failures to proper HTTP status codes (404 for invalid ticker — yahoo-finance2 throws a distinguishable error/empty result for unknown symbols; 502/504 for network/upstream failures) satisfying downstream S03 error-state requirements even though S01 itself only needs to return correct JSON for valid tickers.

## Recommendation

Build a new lightweight Express (TypeScript) server as a separate app (e.g. `server/` directory with its own `package.json`, `tsconfig.json`, running on a distinct port, e.g. 3000) rather than trying to bolt Express into the existing Angular CLI build. Add `express`, `cors`, `yahoo-finance2` as dependencies in that new `server/package.json`. Use `yahooFinance.quote(ticker)` (single call) mapped into the 6-field response contract from the boundary map: `{marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield}`. Implement caching as a simple in-process `Map<string, {data, expiresAt}>` checked before calling Yahoo, satisfying R005 without new infra. This is a light-to-moderate integration: technology (yahoo-finance2) is well-documented and quote() gives everything needed in one shot, but the codebase currently has zero backend scaffolding, so build order matters (scaffold Express app first, prove Yahoo call works standalone, then wire the route + cache + field mapping).

## Implementation Landscape

### Key Files

- `server/package.json` (new) — new Node project; dependencies: `express`, `cors`, `yahoo-finance2`, dev: `typescript`, `ts-node` or `tsx`, `@types/express`, `@types/node`
- `server/tsconfig.json` (new) — standalone TS config for the proxy (CommonJS or ESM per team preference; Node 18+ assumed)
- `server/src/index.ts` (new) — Express app bootstrap, `app.listen(PORT)`, CORS middleware enabled for Angular dev server origin (e.g. `http://localhost:4200`)
- `server/src/routes/stock.ts` (new) — `GET /api/stock/:ticker` handler: check cache → call `yahooFinance.quote(ticker)` → map fields → cache → respond JSON; handle not-found/upstream errors
- `server/src/cache.ts` (new) — simple in-memory TTL cache module (Map-based), ~5 min TTL per R005
- `package.json` (root, existing) — optionally add a root script like `"server": "npm --prefix server run dev"` for convenience, but not required for S01 completion

### Build Order

1. Scaffold `server/` Express + TypeScript project skeleton and confirm `npm start`/`npm run dev` boots and responds on a health-check route (e.g. `GET /health`) — proves the runtime works before touching Yahoo.
2. Add `yahoo-finance2` and prove a raw `yahooFinance.quote('RELIANCE.NS')` call works from a small script or the route directly — this is the highest-risk unknown (unofficial API, no local precedent), so validate it early and standalone before building cache/error-handling around it.
3. Implement the `/api/stock/:ticker` route mapping the quote() response fields to the target contract shape.
4. Add the in-memory cache wrapper around the Yahoo call (TTL ~5 min).
5. Add error handling: unknown/invalid ticker → 404, upstream/network failure → 502/504.

### Verification Approach

- `curl http://localhost:<port>/api/stock/RELIANCE.NS` returns 200 with JSON containing all 6 fields as non-null numbers for a known liquid ticker.
- `curl http://localhost:<port>/api/stock/NOTAREALTICKERXYZ` returns a 404 (or clear error JSON), not a 500/crash.
- Second call to the same ticker within 5 minutes should be noticeably faster / can be verified by adding a temporary log line showing cache hit vs live fetch (removed or left as debug logging).
- No unit tests strictly required for S01 per the roadmap boundary map (unit tests are explicitly called out for S02's ROCE/ROE derivation), but a basic manual/curl-based verification is sufficient here.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Fetching Yahoo Finance fundamentals/quote data | `yahoo-finance2` npm package (`/gadicc/yahoo-finance2`) | Actively maintained (trust 9/10), handles Yahoo's undocumented endpoints, crumb/cookie auth, and schema quirks; `quote()` alone returns marketCap, price, 52wk high/low, trailingPE, bookValue, dividend yield in a single call |
| CORS for browser→proxy calls | `cors` npm middleware | R004 exists specifically because Yahoo has no CORS headers; the Express proxy itself must emit CORS headers for the Angular dev origin, `cors` middleware is the standard low-effort fix |

## Constraints

- No backend currently exists in this repo — this slice creates the first server-side code; keep it isolated in `server/` so it doesn't interfere with the Angular CLI build/lint/test pipeline.
- `yahoo-finance2` is an unofficial/reverse-engineered API — field names and availability can change without notice; treat missing fields defensively per R001 note about partial-data handling (though N/A per-metric UI handling is S03's job, the proxy should still return `null` rather than throwing when a specific field is absent).
- Ticker format requires exchange suffix (`.NS` for NSE, `.BO` for BSE) — must document/assume this in the route contract since the roadmap's example tickers (RELIANCE.NS, TCS.NS, INFY.NS) already use it.

## Common Pitfalls

- **Yahoo API rate-limiting/blocking without warning** — the 5-min in-memory cache (R005) is the primary mitigation; avoid adding retry loops that hammer the upstream on failure.
- **Field name drift between Yahoo API versions** (e.g. `dividendYield` vs `trailingAnnualDividendYield`) — verify actual field name by running a live `quote()` call against a real ticker during build, don't trust docs alone.
- **Treating a legitimately-delisted or malformed ticker the same as a network failure** — `yahoo-finance2` may throw for both cases; the route handler should distinguish "no such symbol" (4xx) from "fetch/network error" (5xx) where possible, since S03 depends on this distinction for its error UI (though full error-state UI work is S03's scope, S01 must produce distinguishable failure signals now).

## Open Risks

- Whether `yahoo-finance2`'s `quote()` reliably returns all 6 fields for Indian (.NS/.BO) tickers specifically (vs. only US tickers) is unverified until tested live — this is the single highest-risk unknown for this slice and should be proven first (Build Order step 2) before further work.
- No existing convention in this repo for where/how a Node backend should live alongside the Angular CLI project (monorepo layout, deployment target, port config) — this is a new architectural decision; recommend documenting the chosen `server/` layout as a decision once implemented for consistency in S02/S03.

## Sources

- yahoo-finance2 official docs and skill file, via Context7 `/gadicc/yahoo-finance2` (quote/quoteSummary field reference, v1→v2 migration notes)
<!-- gsd:state-version=108:1 -->
