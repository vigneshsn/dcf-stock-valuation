# Spec: Guidance scorecard

A per-claim, checkable view of **Management trustworthiness**: what management guided to in each annual report, and what the financials later showed. Designed to scale: one cached LLM extraction per report, everything else deterministic.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Unscored, informational. Does not change the Qualitative score; it is the evidence behind the Management trustworthiness judgement. |
| 2 | **Extract once per report.** One structured LLM call per annual report returns all forward-looking **Guidance claims**: `metric`, `target` (value or range), `horizon` (fiscal year), `quote`. Result cached on disk keyed by ticker / year / model / `GUIDANCE_VERSION`, indefinitely (past reports never change), like `yearSummaries.ts`. |
| 3 | Input to the call is the MD&A / outlook section only, not the full report. |
| 4 | The Latest annual report's claims are extracted in the **same call as MD&A insights** (add a `guidance` field to its schema), so no extra call for the latest year. Older years use the dedicated extraction call, run lazily and only once. |
| 5 | Each claim's `quote` is verified verbatim against the text sent; unverifiable claims are dropped. |
| 6 | Only claims mapping to a metric in the financial data (revenue growth, net profit growth, margin, capex, debt) are **scored**. Vague claims ("strong growth ahead") are listed as **unscored**. |
| 7 | Scoring is deterministic code: compare the target with the actual from `history` for the horizon year. Verdict per claim: *met* (≥ target), *near* (within 10% of target), *missed*. Ranges: met inside or above, missed below. |
| 8 | Needs the next year's actuals; claims whose horizon year has no financials yet are shown as **pending**. |
| 9 | Fewer than 3 reports → lower-confidence flag, as for Management trustworthiness. |
| 10 | Own endpoint and "Run" button; reuses uploaded/fetched reports. Labelled **experimental**. |
| 11 | Degraded modes return a partial result with a status: `llm-unavailable` still returns cached years. |

## API

`POST /api/analysis/:ticker/guidance`

```jsonc
{
  "ticker": "TCS",
  "model": "qwen3:8b",
  "experimental": true,
  "lowerConfidence": false,
  "hitRate": 0.6,              // met / (met + near + missed), null if none scored
  "years": [
    {
      "year": 2023,
      "status": "ok",          // ok | no-report | no-guidance | llm-unavailable | failed
      "cached": true,
      "claims": [
        {
          "metric": "revenueGrowth",
          "target": { "min": 0.15, "max": 0.15 },
          "horizon": 2024,
          "quote": "We expect revenue growth of 15% in FY24",
          "actual": 0.09,
          "verdict": "missed"  // met | near | missed | pending | unscored
        }
      ]
    }
  ]
}
```

## Cost model

LLM calls per ticker, ever: at most one per report (≤ 3). Repeat views and other users: zero.

## Out of scope (v1)

- Judging qualitative claims with an LLM.
- Guidance from earnings calls or investor presentations.
