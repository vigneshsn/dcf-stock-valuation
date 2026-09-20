---
id: T01
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

# T01: Added pure calculateROCE/calculateROE functions in server/src/finance.ts with 8 passing unit tests covering normal, zero/negative denominator, and missing-input cases

**Added pure calculateROCE/calculateROE functions in server/src/finance.ts with 8 passing unit tests covering normal, zero/negative denominator, and missing-input cases**

## What Happened

Implemented server/src/finance.ts exporting calculateROCE and calculateROE as pure functions with no I/O or yahoo-finance2 imports. calculateROCE computes ebit/(totalAssets-totalCurrentLiabilities), returning null for null/undefined inputs or non-positive denominator. calculateROE computes netIncome/totalStockholderEquity, returning null for null/undefined inputs or non-positive equity. Added server/src/finance.test.ts using node:test/node:assert covering normal cases, zero denominator, negative denominator, and missing/undefined inputs for both functions (8 test cases total). Added "test": "tsx --test src/finance.test.ts" script to server/package.json.

## Verification

Ran npx tsc --noEmit (clean) and npx tsx --test src/finance.test.ts (8/8 pass) via gsd_exec.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd server && npx tsc --noEmit && npx tsx --test src/finance.test.ts` | 0 | pass | 6849ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

None.
<!-- gsd:state-version=51:0 -->
