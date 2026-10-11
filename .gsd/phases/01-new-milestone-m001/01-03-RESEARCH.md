## Summary

This slice adds a new Angular route/component that lets a user type an NSE/BSE ticker and see all 8 fundamental metrics rendered live from the existing Express proxy (`GET /api/stock/:ticker`, already returning `{marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield, roce, roe}` per S01/S02). The app is a classic NgModule-based Angular 20 app (not standalone bootstrap), currently with zero HTTP usage anywhere in `src/app` — `HttpClientModule`/`HttpClient` is not yet wired in. The work is a standard "new feature module + service + component + routing entry" task with no novel architecture; errors just need to map the proxy's existing 404/502 status codes to distinct UI states plus a "partial data" per-metric N/A treatment (R006).

The recommended approach: add a `FundamentalsComponent` (standalone, following the same override pattern already used by `DcfCalculatorComponent`/`Tooltip`, i.e. `standalone: true` even though `AppModule` is NgModule-based — Angular supports mixing standalone components into NgModule `imports`), a `StockService` using `HttpClient` to call the proxy, and a new route (e.g. `path: 'fundamentals'`) registered in `app-routing.module.ts`. `HttpClientModule` needs to be added to `AppModule.imports`. Proxy base URL should be a simple constant (e.g. `http://localhost:3000/api/stock`) since there's no `environment.ts` file in this repo currently (no `src/environments` dir found) — introducing one is optional polish, not required for this slice.

## Recommendation

Follow existing local conventions exactly: standalone component + `FormsModule` for the ticker input (mirrors `DcfCalculatorComponent`), inject `HttpClient` in a new `StockService` (mirrors existing `@Injectable()` services like `CsvService`/`DcfHelperService`), and add one router entry. Keep error handling simple and explicit: three UI states — `loading`, `error` (with `errorType: 'not-found' | 'upstream' | 'network'` for distinct messaging + retry button), and `data` (rendered metric grid where each of the 8 fields independently renders its value or "N/A" if `null`). This directly satisfies R006 (partial data shows N/A per-metric, not a whole-dashboard failure) since the proxy already returns `null` for any field it can't compute rather than omitting it or erroring.

## Implementation Landscape

### Key Files

- `src/app/app.module.ts` — Add `HttpClientModule` import; declare/import new standalone `FundamentalsComponent` similar to how `DcfCalculatorComponent` is already imported into the NgModule's `imports` array (standalone components go in `imports`, not `declarations`).
- `src/app/app-routing.module.ts` — Add a new route, e.g. `{path: 'fundamentals', component: FundamentalsComponent}`, alongside existing `''`, `'feedback'`, `'**'` routes.
- `src/app/services/` — New `stock.service.ts`: `@Injectable()` service using `HttpClient.get<StockMetrics>(url)`, returning an Observable, with typed interface matching the proxy's JSON contract exactly (marketCap, currentPrice, week52High, week52Low, peRatio, bookValue, dividendYield, roce, roe — all `number | null`).
- New `src/app/fundamentals/` (or similar) — `fundamentals.component.ts/.html/.css`: ticker input + submit, calls `StockService`, tracks `loading`/`error`/`data` state, renders 8-metric grid with N/A fallback per field.
- `server/src/routes/stock.ts` — Already complete (S01/S02); confirms the exact JSON contract and status codes (200 success, 404 not-found, 502 upstream failure) this slice's error-state UI must map to. No changes expected here.
- `server/src/index.ts` — Confirms `cors()` is already applied and proxy runs on port 3000 (`process.env.PORT || 3000`) — Angular dev server (default 4200) can call it directly since CORS is open.

### Build Order

1. `StockService` + typed interface first (thin, testable, no UI dependency) — proves the HTTP call against the real proxy contract.
2. `FundamentalsComponent` with the three UI states (loading/error/data) and 8-metric grid, wired to `StockService`.
3. Wire `HttpClientModule` into `AppModule` and add the route.
4. Manual/dev verification: run `server/` locally (`npm run dev`/`start` in server, whatever S01 established) and `ng serve`, navigate to the new route, test a known ticker, an invalid ticker, and (if feasible) simulate upstream failure by stopping the server mid-session to hit a network error state.

### Verification Approach

- `ng build` / `ng lint` clean (existing pipeline, unaffected by server/ per D001).
- Component/service unit tests (existing pattern: `.spec.ts` files exist for `dcf-calculator`, `page-not-found`, `xlsx.service`, `tooltip` — follow same Karma/Jasmine convention) covering: successful metrics render, 404 → not-found message, 502/network error → retry banner, and a metrics object with some `null` fields → those specific fields show "N/A" while others render normally.
- Manual check: with `server/` running locally, `ng serve` and navigate to `/fundamentals`, enter `RELIANCE.NS` (or any ticker) and observe rendered card. Given S01's noted sandbox rate-limiting on live Yahoo calls, the proxy's 502 path is the most likely observable result in this environment too — sufficient to prove the error-state UI; a full happy-path visual proof may require an unthrottled network, consistent with S01/S02's documented limitation.

## Constraints

- No `HttpClientModule` currently registered anywhere in the app — must be added in `AppModule.imports` (this is an `NgModule`-based app, `bootstrapApplication`/`provideHttpClient` standalone bootstrap pattern does not apply here).
- No `environment.ts`/`environment.prod.ts` files exist in `src/` — hardcoding `http://localhost:3000` (or a simple exported constant) is acceptable for this milestone; do not introduce Angular environment file build config as in-scope unless trivial.
- Proxy must be running separately (`server/`) for the dashboard to function; there is no proxying/rewrite configured in `angular.json` — this is expected per D001's explicit choice to keep the two apps independent.

## Common Pitfalls

- **Standalone component omitted from `declarations`** — since `DcfCalculatorComponent` already proves the pattern (`standalone: true` component placed in `AppModule.imports`, not `declarations`), follow it exactly for the new component to avoid the classic "component is not part of any NgModule" error.
- **Forgetting to treat `null` fields distinctly from a failed request** — the proxy intentionally returns `200` with some fields `null` (e.g. roce/roe on quoteSummary failure); the UI must render N/A per-field in that case rather than treating any `null` as a whole-response error (this is the direct implementation of R006's "partial data" requirement).
- **CORS** — already handled proxy-side (`cors()` applied globally in `server/src/index.ts`), so no Angular-side proxy config work needed.
