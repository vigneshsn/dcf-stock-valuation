# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Display core valuation metrics (Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, Dividend Yield) for a user-searched NSE/BSE ticker
- Class: core-capability
- Status: active
- Description: Display core valuation metrics (Market Cap, Current Price, 52-Week High/Low, Stock P/E, Book Value, Dividend Yield) for a user-searched NSE/BSE ticker
- Why it matters: These are the baseline fundamental-analysis numbers needed to evaluate a company at a glance
- Source: user
- Primary owning slice: M001/S01
- Validation: unmapped

### R004 — Backend proxy (Node/Express) fetches Yahoo Finance data server-side using the yahoo-finance2 package, avoiding browser CORS restrictions
- Class: integration
- Status: active
- Description: Backend proxy (Node/Express) fetches Yahoo Finance data server-side using the yahoo-finance2 package, avoiding browser CORS restrictions
- Why it matters: Yahoo Finance's unofficial API does not send CORS headers, so direct browser calls from Angular will fail
- Source: inferred
- Primary owning slice: M001/S01
- Validation: unmapped

### R005 — Proxy caches per-ticker responses in-memory for approximately 5 minutes to reduce repeated calls to the unofficial upstream API
- Class: operability
- Status: active
- Description: Proxy caches per-ticker responses in-memory for approximately 5 minutes to reduce repeated calls to the unofficial upstream API
- Why it matters: Reduces throttling/rate-limit risk against an unsupported, undocumented upstream API
- Source: user
- Primary owning slice: M001/S01
- Validation: unmapped

### R006 — Gracefully handle invalid ticker, upstream API failure/timeout, and partial/missing financial data without crashing the dashboard
- Class: failure-visibility
- Status: active
- Description: Gracefully handle invalid ticker, upstream API failure/timeout, and partial/missing financial data without crashing the dashboard
- Why it matters: Unofficial upstream API has no SLA; schema drift, rate limiting, and missing fields are expected occurrences, not edge cases
- Source: user
- Primary owning slice: M001/S03
- Validation: unmapped

## Validated

### R002 — Compute and display ROCE (Return on Capital Employed) derived from live financial data (EBIT, capital employed) since no free API returns it directly for Indian stocks
- Class: core-capability
- Status: validated
- Description: Compute and display ROCE (Return on Capital Employed) derived from live financial data (EBIT, capital employed) since no free API returns it directly for Indian stocks
- Why it matters: ROCE is a key capital-efficiency metric used in fundamental analysis and explicitly requested
- Source: user
- Primary owning slice: M001/S02
- Validation: calculateROCE unit-tested in finance.test.ts (normal, zero/negative-denominator, missing-input cases); wired into GET /api/stock/:ticker via quoteSummary

### R003 — Compute and display ROE (Return on Equity) derived from live financial data (net income, shareholder equity)
- Class: core-capability
- Status: validated
- Description: Compute and display ROE (Return on Equity) derived from live financial data (net income, shareholder equity)
- Why it matters: ROE is a key profitability metric used in fundamental analysis and explicitly requested
- Source: user
- Primary owning slice: M001/S02
- Validation: calculateROE unit-tested in finance.test.ts (normal, zero/negative-denominator, missing-input cases); wired into GET /api/stock/:ticker via quoteSummary

### R007 — Unit tests cover the ROCE and ROE calculation logic specifically, since this is custom-derived logic not provided directly by any API
- Class: quality-attribute
- Status: validated
- Description: Unit tests cover the ROCE and ROE calculation logic specifically, since this is custom-derived logic not provided directly by any API
- Why it matters: Derived financial math is the most bug-prone part of the feature and has no upstream validation to lean on
- Source: user
- Primary owning slice: M001/S02
- Validation: 8 passing node:test unit tests in server/src/finance.test.ts covering normal, zero-denominator, negative-denominator, and missing-input cases for both ROCE and ROE

## Deferred

### R008 — Management-quality assessment via annual report analysis is explicitly deferred to a future milestone
- Class: anti-feature
- Status: deferred
- Description: Management-quality assessment via annual report analysis is explicitly deferred to a future milestone
- Why it matters: Qualitative annual-report analysis is a distinct, larger scope of work best tackled separately
- Source: user
- Validation: unmapped

## Out of Scope

### R009 — Multi-company watchlist/grid view is explicitly out of scope for this milestone
- Class: anti-feature
- Status: out-of-scope
- Description: Multi-company watchlist/grid view is explicitly out of scope for this milestone
- Why it matters: User confirmed single-company lookup is sufficient for now; avoids added UI/storage complexity
- Source: user
- Validation: n/a

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
| --- | --- | --- | --- | --- | --- |
| R001 | core-capability | active | M001/S01 | none | unmapped |
| R002 | core-capability | validated | M001/S02 | none | calculateROCE unit-tested in finance.test.ts (normal, zero/negative-denominator, missing-input cases); wired into GET /api/stock/:ticker via quoteSummary |
| R003 | core-capability | validated | M001/S02 | none | calculateROE unit-tested in finance.test.ts (normal, zero/negative-denominator, missing-input cases); wired into GET /api/stock/:ticker via quoteSummary |
| R004 | integration | active | M001/S01 | none | unmapped |
| R005 | operability | active | M001/S01 | none | unmapped |
| R006 | failure-visibility | active | M001/S03 | none | unmapped |
| R007 | quality-attribute | validated | M001/S02 | none | 8 passing node:test unit tests in server/src/finance.test.ts covering normal, zero-denominator, negative-denominator, and missing-input cases for both ROCE and ROE |
| R008 | anti-feature | deferred | none | none | unmapped |
| R009 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 4
- Mapped to slices: 4
- Validated: 3 (R002, R003, R007)
- Unmapped active requirements: 0
