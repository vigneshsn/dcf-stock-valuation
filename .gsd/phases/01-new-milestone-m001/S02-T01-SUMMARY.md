---
id: T01
parent: S02
milestone: M001
key_files:
  - server/src/finance.ts
  - server/src/finance.test.ts
  - server/package.json
key_decisions:
  - (none)
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T01: Added pure calculateROCE/calculateROE functions in server/src/finance.ts with 8 passing unit tests covering normal, zero/negative denominator, and missing-input cases.

**Added pure calculateROCE/calculateROE functions in server/src/finance.ts with 8 passing unit tests covering normal, zero/negative denominator, and missing-input cases.**

## What Happened

Created server/src/finance.ts exporting calculateROCE (ebit/(totalAssets-totalCurrentLiabilities), null-guarded on missing inputs and non-positive denominator) and calculateROE (netIncome/totalStockholderEquity, null-guarded similarly). No I/O or yahoo-finance2 imports — pure functions only. Added server/src/finance.test.ts using node:test/node:assert covering normal case, zero denominator, negative denominator, and missing/undefined inputs for both functions. Added "test": "tsx --test src/finance.test.ts" to server/package.json.

## Verification

npx tsc --noEmit clean; npx tsx --test src/finance.test.ts passed 8/8 tests, 0 failures.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd server && npx tsc --noEmit && npx tsx --test src/finance.test.ts` | 0 | pass | 7330ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `server/src/finance.ts`
- `server/src/finance.test.ts`
- `server/package.json`
<!-- gsd:state-version=46:0 -->
