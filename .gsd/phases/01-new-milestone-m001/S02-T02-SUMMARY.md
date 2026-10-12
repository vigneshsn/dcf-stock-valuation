---
id: T02
parent: S02
milestone: M001
key_files:
  - (none)
key_decisions:
  - (none)
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T02: Wired quoteSummary-derived roce/roe into GET /api/stock/:ticker with graceful degradation on failure

**Wired quoteSummary-derived roce/roe into GET /api/stock/:ticker with graceful degradation on failure**

## What Happened

server/src/routes/stock.ts imports calculateROCE/calculateROE from ../finance.js and extends StockMetrics with roce/roe fields. After the existing quote() call succeeds and metrics are built, the route calls yahooFinance.quoteSummary(ticker, { modules: ['incomeStatementHistory','balanceSheetHistory'] }) inside its own try/catch that never rethrows — on failure it logs `[upstream error] ${ticker} quoteSummary: ...` and leaves roce/roe as null (initialized null by default). On success it extracts ebit/netIncome from incomeStatementHistory[0] and totalAssets/totalCurrentLiabilities/totalStockholderEquity from balanceSheetHistory[0] via optional chaining, then computes roce/roe with the pure functions from T01. The computed values are included in both the cached and returned metrics object. Existing 404/502 handling for the quote() call is untouched. Verified via tsc --noEmit (exit 0).

## Verification

cd server && npx tsc --noEmit passed with exit code 0, confirming type correctness of the new quoteSummary wiring and StockMetrics extension.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd server && npx tsc --noEmit` | 0 | pass | 5929ms |

## Deviations

None.

## Known Issues

Failure Modes (Q5): quoteSummary call is wrapped in try/catch that logs and degrades roce/roe to null without failing the request, mirroring the existing quote() error-logging pattern; the outer quote() call retains its distinct 404/502 handling. Load Profile (Q6): not applicable — no new runtime load dimension beyond the existing per-request cache-backed upstream call. Negative Tests (Q7): calculation-level negative cases (zero/negative denominators, missing inputs) are covered by finance.test.ts from T01; this task's negative surface (quoteSummary failure) is exercised via the try/catch degrading to null, verified by code inspection and type check rather than a new runtime test.

## Files Created/Modified

None.
<!-- gsd:state-version=115:1 -->
