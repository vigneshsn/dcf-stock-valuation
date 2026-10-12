---
id: S02
parent: M001
milestone: M001
provides:
  - Extended /api/stock/:ticker JSON contract adding roce and roe fields (numeric or null)
requires:
  - slice: S01
    provides: Express route GET /api/stock/:ticker, yahoo-finance2 call pattern, in-memory cache
affects:
  - S03
key_files: []
key_decisions:
  - ROCE/ROE calculation kept as pure functions with no yahoo-finance2 imports, enabling deterministic unit testing independent of upstream API
  - quoteSummary failures degrade roce/roe to null without failing the whole request, consistent with S01's partial-data resilience pattern
patterns_established:
  - (none)
observability_surfaces:
  - none
drill_down_paths:
  []
duration: ""
verification_result: passed
completed_at: 2026-09-20T10:55:20.128Z
blocker_discovered: false
---

# S02: ROCE and ROE derivation

**GET /api/stock/:ticker now also returns computed roce/roe fields, derived server-side from quoteSummary income/balance-sheet data via pure, unit-tested calculation functions with graceful null degradation on failure.**

## What Happened

T01 added pure calculateROCE(ebit, totalAssets, totalCurrentLiabilities) and calculateROE(netIncome, totalStockholderEquity) functions in server/src/finance.ts, with no I/O dependencies, plus 8 node:test unit tests in finance.test.ts covering normal, zero-denominator, negative-denominator, and missing-input cases — all passing. T02 wired these into the existing GET /api/stock/:ticker route: after the existing quote() call succeeds, the route now also calls yahooFinance.quoteSummary with incomeStatementHistory and balanceSheetHistory modules inside its own try/catch that never fails the request — on failure it logs and sets roce/roe to null, mirroring the existing upstream error-logging pattern. On success it extracts EBIT/net income/equity/assets/liabilities via optional chaining and computes roce/roe, merging them into the cached and returned StockMetrics object. Existing 404/502 handling for the primary quote() call is unchanged.

## Verification

cd server && npx tsc --noEmit passed with 0 errors; npx tsx --test src/finance.test.ts ran 8 tests, 8 passed, 0 failed, covering normal/zero/negative/missing-input cases for both calculateROCE and calculateROE.

## Requirements Advanced

None.

## Requirements Validated

- R002 — calculateROCE pure function unit-tested and wired into live route via quoteSummary
- R003 — calculateROE pure function unit-tested and wired into live route via quoteSummary
- R007 — 8 passing node:test cases in finance.test.ts covering normal/zero/negative/missing-input scenarios

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None.

## Known Limitations

None.

## Follow-ups

None.

## Files Created/Modified

- `server/src/finance.ts` — Pure ROCE/ROE calculation functions, no I/O
- `server/src/finance.test.ts` — 8 unit tests covering normal, zero/negative-denominator, and missing-input cases
- `server/package.json` — Added test script: tsx --test src/finance.test.ts
- `server/src/routes/stock.ts` — Extended StockMetrics with roce/roe, wired quoteSummary call with graceful null degradation
<!-- gsd:state-version=108:1 -->
