# Spec: Thesis tracker

The user records why they own (or want) a stock as measurable **Thesis checkpoints**. When a new annual report's financials arrive, each checkpoint is evaluated and the thesis is flagged intact / weakening / broken. Later phase; build after the four analysis features.

## Decisions

| # | Decision |
| --- | --- |
| 1 | A **Thesis** belongs to one ticker and holds a free-text rationale plus 1-5 **Thesis checkpoints**. |
| 2 | A checkpoint is structured: `metric` (revenue growth, net margin, ROE, ROCE, debt/equity, FCF), `operator` (≥ / ≤), `target`, optional `byYear`. No free-text checkpoints in v1, so evaluation is deterministic with no LLM. |
| 3 | Evaluation: *intact* (met), *weakening* (within 10% of target or moved toward it), *broken* (missed after `byYear`, or moved away for 2 years), *pending* (no data yet). Thesis status = worst checkpoint status. |
| 4 | Storage is **browser local storage**, no login (see Persistence below). Export / import as JSON so users can back up and move devices. |
| 5 | Checkpoints are evaluated in the browser against the financials the app already fetches; the server stores nothing. |
| 6 | The dashboard shows a status badge on the watchlist and a Thesis tile per stock, each checkpoint with current value vs target. |
| 7 | Suggest checkpoints from existing analysis (e.g. a Guidance scorecard claim or a Reverse DCF implied growth) with one click; user confirms. |
| 8 | A **Thesis** is not a score and never feeds into one. |

## Persistence

Local storage key `thesis.v1`, versioned for migration. Server-side storage and accounts are deliberately deferred; revisit if multi-device sync is requested (ADR candidate at that point, not now).

## Data shape

```jsonc
{
  "ticker": "TCS",
  "rationale": "IT services leader; margins to reach 26%",
  "createdAt": "2026-10-26",
  "checkpoints": [
    { "id": "c1", "metric": "netMargin", "operator": ">=", "target": 0.20, "byYear": 2027 }
  ]
}
```

## Out of scope (v1)

- Server sync, accounts, notifications or email alerts.
- Free-text or LLM-evaluated checkpoints.
- Portfolio-level aggregation.
