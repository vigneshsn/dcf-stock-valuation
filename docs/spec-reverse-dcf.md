# Spec: Reverse DCF (market-implied growth)

Solve the DCF backwards: given today's price, find the **Implied growth** the market is pricing in, and show it next to what the company actually delivered and what management guided to. Deterministic, no LLM.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Reuses the existing DCF in `server/src/dcf.ts`. Holds discount rate and terminal growth at the same values the Fair value uses, and solves for `growthRate` so that `fairValuePerShare == price`. |
| 2 | Solved numerically (bisection over `growthRate` in [-20%, +50%], tolerance ₹0.01/share). If no solution exists in the range, return `status: "no-solution"` with the bound reached. |
| 3 | Unscored. Never affects the Quantitative or Qualitative score. |
| 4 | Comparators shown beside Implied growth: **historical revenue CAGR** (up to 5 years from `history`) and **guided growth** when the Guidance scorecard has a revenue claim (see [spec-guidance-scorecard.md](spec-guidance-scorecard.md)). Missing comparators are omitted, not estimated. |
| 5 | Plain-language verdict computed by thresholds, not an LLM: Implied growth > historical CAGR + 3 pts → "market expects acceleration"; < CAGR − 3 pts → "market expects slowdown"; otherwise "in line with history". |
| 6 | Loss-making or negative-FCF base year → `status: "not-applicable"` with a message (DCF base is meaningless). |
| 7 | Shown as a tile on the dashboard next to the Fair value, with a single-line headline ("Price implies 14% growth for 5 years; company delivered 9%"). |

## API

`GET /api/analysis/:ticker/reverse-dcf`

```jsonc
{
  "ticker": "TCS",
  "status": "ok",              // ok | no-solution | not-applicable | unavailable
  "message": null,
  "price": 3900,
  "impliedGrowth": 0.14,
  "assumptions": { "discountRate": 0.12, "terminalGrowthRate": 0.04 },
  "historicalCagr": 0.09,
  "guidedGrowth": null,
  "verdict": "expects-acceleration"  // expects-acceleration | in-line | expects-slowdown
}
```

## Out of scope (v1)

- Solving for margin or discount rate instead of growth.
- User-editable assumptions (the editable DCF table already exists).
