# Spec: Reverse DCF (market-implied growth)

Solve the DCF backwards: given today's price, find the **Implied growth** the market is pricing in, and show it next to what the company actually delivered and what management guided to. Deterministic, no LLM.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Reuses the existing DCF in `server/src/dcf.ts`. Holds discount rate and terminal growth at the same values the Fair value uses, and solves for `growthRate` so that `fairValuePerShare == price`. |
| 2 | Solved numerically (bisection over `growthRate` in [-20%, +50%], stopping once the Fair value is within ₹0.01/share of the price; Implied growth is reported to 0.01 pt). If no solution exists in the range, return `status: "no-solution"` with the bound reached. If Fair value does not rise with growth (e.g. earlier losses make the average margin negative), return `status: "not-applicable"`. |
| 3 | Unscored. Never affects the Quantitative or Qualitative score. |
| 4 | Comparators shown beside Implied growth: **historical revenue CAGR** (up to 5 calendar years from `history`, spanning the actual fiscal years so gaps are not overstated) and **guided growth** when the Guidance scorecard has a revenue claim (see [spec-guidance-scorecard.md](spec-guidance-scorecard.md)). Missing comparators are omitted, not estimated. |
| 5 | Plain-language verdict computed by thresholds, not an LLM: Implied growth > historical CAGR + 3 pts → "market expects acceleration"; < CAGR − 3 pts → "market expects slowdown"; otherwise "in line with history". |
| 6 | Loss-making or negative-FCF base year → `status: "not-applicable"` with a message (DCF base is meaningless). |
| 7 | Shown as a tile on the dashboard next to the Fair value, with a single-line headline ("Price implies 14% growth for 5 years; company delivered 9%"). |

## API

`GET /api/analysis/:ticker/reverse-dcf?discount=12&terminal=4`

Optional `discount` / `terminal` query overrides (percentage points) work the same way as on `/quantitative`. The dashboard passes the current slider values so this tile and the Fair value tile always agree. `growth` is ignored because it is the value being solved. Invalid overrides, or discount ≤ terminal, return 400.

All rates are in percentage points (14 = 14%).

```jsonc
{
  "ticker": "TCS",
  "status": "ok",              // ok | no-solution | not-applicable | unavailable (insufficient history)
  "message": null,             // set for no-solution / not-applicable / unavailable
  "price": 3900,
  "impliedGrowth": 14.2,       // null unless status is ok
  "bound": null,               // 50 or -20 when status is no-solution
  "assumptions": { "discountRate": 12, "terminalGrowthRate": 4 },
  "historicalCagr": 9.1,       // null with fewer than 2 years of revenue
  "guidedGrowth": null,        // filled once the Guidance scorecard exists
  "verdict": "expects-acceleration",  // expects-acceleration | in-line | expects-slowdown | null
  "cached": false,
  "cachedAt": "2025-01-01T00:00:00.000Z"
}
```

For `no-solution`, the verdict compares the `bound` with the CAGR.

## Out of scope (v1)

- Solving for margin or discount rate instead of growth.
- User-editable assumptions (the editable DCF table already exists).
