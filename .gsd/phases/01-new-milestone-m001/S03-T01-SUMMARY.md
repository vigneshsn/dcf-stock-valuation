---
id: T01
parent: S03
milestone: M001
key_files:
  - src/app/models/stock-metrics.ts
  - src/app/services/stock.service.ts
  - src/app/app.module.ts
key_decisions:
  - StockService does not catch HTTP errors internally; errors bubble to subscribers for UI-layer state mapping (T02).
duration:
verification_result: mixed
completed_at:
blocker_discovered: false
---

# T01: Added StockService with typed getStock() HTTP call to the Express proxy and registered HttpClientModule in AppModule.

**Added StockService with typed getStock() HTTP call to the Express proxy and registered HttpClientModule in AppModule.**

## What Happened

Created src/app/models/stock-metrics.ts exporting the StockMetrics interface with all 9 fields (marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield, roce, roe) typed number|null. Created src/app/services/stock.service.ts as an @Injectable({providedIn:'root'}) StockService injecting HttpClient, with getStock(ticker) returning Observable<StockMetrics> via a GET to `http://localhost:3000/api/stock/{ticker}`; no error handling in the service itself so the component layer can map 404/502/network failures. Added HttpClientModule import and to AppModule's imports array so HttpClient is available app-wide. Deviation: `npx ng build --configuration production` failed because angular.json has no 'production' configuration defined (pre-existing repo state, unrelated to this task); verified instead with the default `npx ng build`, which succeeded.

## Verification

Ran `npx ng build` (default config, since 'production' config does not exist in this repo's angular.json) — compiled successfully with StockService and HttpClientModule included, exit code 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx ng build --configuration production` | 127 | fail (no such config in angular.json - pre-existing, not caused by this task) | 5991ms |
| 2 | `npx ng build` | 0 | pass | 31049ms |

## Deviations

Used `npx ng build` instead of `npx ng build --configuration production` since the repo's angular.json has no 'production' configuration defined; this is a pre-existing project condition unrelated to this task's changes.

## Known Issues

None. HTTP error handling (404/502/network mapping) is intentionally deferred to T02 (FundamentalsComponent), per plan.

## Files Created/Modified

- `src/app/models/stock-metrics.ts`
- `src/app/services/stock.service.ts`
- `src/app/app.module.ts`
<!-- gsd:state-version=91:0 -->
