# Spec: Scenario ranges and sensitivity

Show Fair value as a **range** (bear / base / bull) with a sensitivity grid, alongside the existing single Fair value. Deterministic, no LLM.

## Decisions

| # | Decision |
| --- | --- |
| 1 | The base case is the existing DCF result; the single Fair value and the Quantitative score are unchanged (score bands still use the base Fair value). |
| 2 | Bear / bull vary growth by ∓5 pts and discount rate by ±1 pt around the base assumptions; terminal growth is held constant. Offsets live in one constants block. |
| 3 | **Sensitivity grid**: growth (base ∓4 pts in 2-pt steps) × discount rate (base ∓2 pts in 1-pt steps), each cell a per-share value, coloured against the current price (cheap / fair / expensive using the Quantitative score bands). |
| 4 | **Implied growth note**: plain-language line computed in code, e.g. "Needs 12% annual growth for 5 years to justify today's price" (the same Implied growth as [Reverse DCF](spec-reverse-dcf.md), which will reuse the solver). |
| 5 | Tile shows a range bar: bear — base — bull with a marker for the current price. |
| 6 | Not-applicable bases follow the same rule as Reverse DCF: when the latest year is loss-making or has negative free cash flow (net income + non-cash expense − capex), `scenarios` is `null` and the tile says why. Grid cells ≤ 0 are coloured expensive. |
| 7 | Computed in the same request as the Quantitative analysis; the DCF is cheap, so no caching of its own. |

## API

Added to the existing Quantitative analysis response:

```jsonc
// Rates are percentage points, like the existing assumptions (9 = 9%).
"scenarios": {
  "bear": { "growthRate": 4,  "discountRate": 13, "terminalGrowthRate": 4.5, "fairValuePerShare": 2800 },
  "base": { "growthRate": 9,  "discountRate": 12, "terminalGrowthRate": 4.5, "fairValuePerShare": 3600 },
  "bull": { "growthRate": 14, "discountRate": 11, "terminalGrowthRate": 4.5, "fairValuePerShare": 4700 },
  // values[i][j] is for growth[i] and discount[j]; null where discount ≤ terminal growth
  "grid": { "growth": [5, 7, 9, 11, 13], "discount": [10, 11, 12, 13, 14], "values": [[...]] },
  "impliedGrowth": 11.2 // null when no growth in [-20, 50] matches the price
}
// The whole "scenarios" field is null when decision 6 applies.
```

The base scenario uses the active assumptions, including user overrides from the sliders.

## Out of scope (v1)

- User-defined scenario assumptions, probability weighting.
