## Summary

S02 extends the existing `/api/stock/:ticker` route (built in S01) to add computed `roce` and `roe` fields. `yahoo-finance2`'s `quote()` call (used in S01) does not return balance-sheet/income-statement data, so this requires a second upstream call via `yahooFinance.quoteSummary(ticker, { modules: ['incomeStatementHistory', 'balanceSheetHistory', 'financialData'] })`. That module exposes: `incomeStatementHistory.incomeStatementHistory[0].ebit` and `.netIncome` (most recent annual period), `balanceSheetHistory.balanceSheetStatements[0].totalStockholderEquity` and (`totalAssets` − `totalCurrentLiabilities`) for capital employed, and `financialData.returnOnEquity`/`returnOnAssets` as a possible pre-computed fallback (not capital-employed-based, so ROCE must still be derived manually; Yahoo does not expose ROCE directly for any market).

ROCE = EBIT / Capital Employed, where Capital Employed = Total Assets − Total Current Liabilities (standard definition). ROE = Net Income / Total Stockholder Equity. Both should be expressed as ratios (e.g. 0.18) or percentages consistently with existing fields — recommend keeping raw ratio (not ×100) to match `dividendYield`'s existing convention, and let the UI (S03) format as %.

Recommendation: extract calculation logic into a small pure function module (`server/src/finance.ts`) so it can be unit tested independent of the HTTP/network layer, per R007. Fetch `quoteSummary` alongside `quote` in the route handler (parallel `Promise.all`), merge results into the existing `StockMetrics` interface with two new nullable fields, and cache the merged object using the same cache module from S01 (single cache entry per ticker covering all 8 metrics — simpler than two separate cache keys).

## Recommendation

Add a pure, unit-testable `calculateROCE(ebit, totalAssets, totalCurrentLiabilities)` and `calculateROE(netIncome, totalStockholderEquity)` in `server/src/finance.ts`, returning `null` on missing/invalid inputs (zero or negative denominator) rather than throwing. Wire these into `stock.ts` by calling `yahooFinance.quoteSummary(ticker, { modules: ['incomeStatementHistory', 'balanceSheetHistory'] })` in parallel with the existing `quote()` call, extracting the first (most recent annual) entry from each statement array. Extend the cached/returned JSON with `roce` and `roe` (number | null). Reuse S01's existing 404/502 error-handling pattern — if `quoteSummary` fails but `quote` succeeds, degrade gracefully by returning `roce: null, roe: null` rather than failing the whole request (matches milestone success criterion: "partial data shows N/A per-metric").

## Implementation Landscape

### Key Files

- `server/src/routes/stock.ts` — extend `StockMetrics` interface with `roce`/`roe`; add `quoteSummary` call in parallel with `quote()`; merge into cached response. Existing try/catch pattern around `quote()` should be mirrored (or wrapped together) for `quoteSummary` but must not abort the whole response — only null out roce/roe on failure.
- `server/src/finance.ts` (new) — pure calculation functions: `calculateROCE(ebit: number|null|undefined, totalAssets: number|null|undefined, totalCurrentLiabilities: number|null|undefined): number|null` and `calculateROE(netIncome: number|null|undefined, totalStockholderEquity: number|null|undefined): number|null`. No I/O, no yahoo-finance2 imports — keeps it trivially unit-testable.
- `server/src/finance.test.ts` (new) — unit tests per R007, covering: normal case with known inputs, zero/negative denominator (should return null, not Infinity/NaN), missing/undefined inputs (return null).
- `server/src/cache.ts` — no changes needed; existing generic `get`/`set` reused as-is for the extended `StockMetrics` shape.
- `server/package.json` — needs a test runner added (none currently present); recommend `node --test` with `tsx` (already a devDependency) via `tsx --test src/**/*.test.ts`, avoiding a new dependency (jest/vitest) for a 2-function test file.

### Yahoo Finance quoteSummary field mapping

- EBIT: `quoteSummary.incomeStatementHistory.incomeStatementHistory[0].ebit`
- Net Income: `quoteSummary.incomeStatementHistory.incomeStatementHistory[0].netIncome`
- Total Stockholder Equity: `quoteSummary.balanceSheetHistory.balanceSheetStatements[0].totalStockholderEquity`
- Total Assets: `quoteSummary.balanceSheetHistory.balanceSheetStatements[0].totalAssets`
- Total Current Liabilities: `quoteSummary.balanceSheetHistory.balanceSheetStatements[0].totalCurrentLiabilities` (present in schema per statement, standard Yahoo field)
- All fields are typed `number | null` after yahoo-finance2's typebox validation/transform (raw `{raw: number}` shapes are unwrapped automatically) — no manual `.raw` unwrapping needed in application code, matches what S01 already relies on for `quote()` fields.

### Build Order

1. Write `finance.ts` + `finance.test.ts` first (pure logic, no network dependency) — proves the ROCE/ROE math against known inputs without needing live Yahoo access, sidestepping the sandbox rate-limiting problem documented in S01's summary.
2. Add `node --test` script to `server/package.json`, run tests to green.
3. Wire `quoteSummary` call into `stock.ts`, extend `StockMetrics`, merge fields into response and cache entry.
4. Manual/live verification against `/api/stock/RELIANCE.NS` is expected to hit the same Yahoo rate-limiting seen in S01 in this sandbox — do not block slice completion on a live 200; rely on unit tests + code review of the merge/error-handling logic, consistent with how S01 closed out.

### Verification Approach

- `cd server && npx tsc --noEmit` — 0 errors.
- `cd server && npx tsx --test src/finance.test.ts` (or equivalent `node --test` config) — all ROCE/ROE unit tests pass, covering normal, zero-denominator, and missing-input cases.
- `curl localhost:PORT/api/stock/RELIANCE.NS` — expect `roce`/`roe` keys present in JSON (null is acceptable given sandbox rate-limiting; the key server-side contract to verify by code review is that quoteSummary failure doesn't 502 the whole request when `quote()` succeeded).

## Constraints

- Sandbox network rate-limits calls to Yahoo Finance (confirmed repeatedly in S01) — do not rely on a live 200 with real numeric ROCE/ROE as the primary proof; unit-test the pure calculation functions instead, and treat live verification as best-effort/follow-up.
- No test runner currently configured in `server/package.json`; must add one (recommend built-in `node --test` via `tsx` rather than introducing jest/vitest, keeping deps minimal for a proxy server).

## Common Pitfalls

- **Division by zero / negative capital employed** — some distressed companies report negative equity or current-liabilities-exceeding-assets; must guard against division by zero and return `null`, not `Infinity`/`NaN`, which would break JSON serialization expectations (`JSON.stringify(Infinity)` → `null` silently, `NaN` → `null` too, but relying on that is fragile — explicit guard is clearer and testable).
- **quoteSummary throwing while quote succeeds** — must not let a `quoteSummary` failure produce a 502 for the whole endpoint if `quote()` already succeeded; roce/roe should degrade to `null` per the milestone's "partial data shows N/A per-metric" success criterion.
- **Annual vs quarterly statement arrays** — use `incomeStatementHistory` (annual) not `incomeStatementHistoryQuarterly` for ROCE/ROE to match typical fundamental-analysis conventions (annual figures), and take index `[0]` as most recent.
