---
id: T04
parent: S03
milestone: M001
key_files:
  - playwright.config.ts
  - e2e/smoke.spec.ts
  - package.json
key_decisions:
  - Used a single broad regex locator with .first() to keep the smoke test valid whether the live proxy succeeds, 404s, 502s, or network-fails, satisfying the task's pass-regardless-of-backend-state requirement.
duration:
verification_result: mixed
completed_at:
blocker_discovered: false
---

# T04: Added Playwright scaffolding and a smoke test that drives /fundamentals to a terminal state (error or data) via a real browser.

**Added Playwright scaffolding and a smoke test that drives /fundamentals to a terminal state (error or data) via a real browser.**

## What Happened

Installed @playwright/test as a devDependency and Chromium browser binaries. Added playwright.config.ts at repo root with testDir './e2e', a webServer block launching `npx ng serve --port 4200` (reuseExistingServer unless CI), and baseURL http://localhost:4200. Added e2e/smoke.spec.ts which navigates to /fundamentals, fills the ticker input with 'RELIANCE.NS', clicks Search, and asserts a broad regex locator (N/A|not found|failed|retry) becomes visible within 15s, proving the UI reaches a terminal state (success grid or error state) without crashing. Added `e2e:playwright` script to package.json. First run failed due to Playwright strict-mode ambiguity (both the error message paragraph and the Retry button matched the regex) — fixed by adding `.first()` to the locator. Final run against the live proxy returned an upstream failure state ("Upstream data source failed, please retry"), which the test correctly asserts as a valid terminal state.

## Verification

Ran `npx playwright test` end-to-end: Angular dev server auto-started via webServer config, browser navigated to /fundamentals, submitted a ticker, and observed the app reach the upstream-error terminal state, which the assertion matched. Exit code 0, 1 passed.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npm install -D @playwright/test` | 0 | pass | 22912ms |
| 2 | `npx playwright install chromium` | 0 | pass | 1129ms |
| 3 | `npx playwright test (initial)` | 1 | fail-strict-mode-locator | 19894ms |
| 4 | `npx playwright test (after .first() fix)` | 0 | pass | 40663ms |

## Deviations

None.

## Known Issues

Test currently observes the proxy's upstream-failure path live (no live upstream data source reachable in this environment); this is an acceptable terminal state per the task's broad-match design and not a defect in this task's scope.

## Files Created/Modified

- `playwright.config.ts`
- `e2e/smoke.spec.ts`
- `package.json`
<!-- gsd:state-version=115:1 -->
