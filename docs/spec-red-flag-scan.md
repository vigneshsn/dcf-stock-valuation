# Spec: Red-flag scan

An unscored, deterministic checklist of **earnings-quality and balance-sheet warnings**. No LLM, so no quota cost.

## Decisions

| # | Decision |
| --- | --- |
| 1 | Unscored, informational; never affects any score. Same tile style as SWOT. |
| 2 | Pure rules over `history` and latest-year metrics (see table). Missing metrics are skipped silently. |
| 3 | Each flag carries a name, severity (*watch* / *warning*), the metric values and the years compared, so it is verifiable. |
| 4 | Latest fiscal year vs previous (and 3-year trend where noted). Absolute / year-over-year only; no Peer set comparison in v1. |
| 5 | No flags found → "No red flags detected on available data", not a positive score. |
| 6 | Computed on request from cached financials (1 h cache); no separate storage. |
| 7 | Where a rule needs data the provider does not supply (receivables, promoter holding, pledging), the rule is skipped and listed under `skipped` with the reason. Provider coverage is checked during implementation. |

## Rules

| Flag | Trigger | Severity |
| --- | --- | --- |
| Profit not backed by cash | Operating cash flow < 50% of net income for 2 consecutive years | warning |
| Cash conversion drop | Operating cash flow / net income fell > 30 pts YoY | watch |
| Receivables outpacing sales | Receivables growth > revenue growth + 15 pts | watch |
| Debt outpacing revenue | Total debt growth > revenue growth + 20 pts | watch |
| High leverage | Debt / equity > 1.5 | warning |
| Shrinking margins, 3 years | Net margin down each of last 3 years | watch |
| Promoter stake falling | Promoter holding down > 5 pts over 2 years | watch |
| Promoter pledging | Pledged share of promoter holding > 20% | warning |
| Negative free cash flow, 3 years | FCF < 0 in each of last 3 years | warning |

Thresholds live in one constants block so they are easy to tune.

## API

`GET /api/analysis/:ticker/red-flags`

```jsonc
{
  "ticker": "TCS",
  "status": "ok",                   // ok | unavailable
  "flags": [
    { "id": "cash-conversion-drop", "severity": "watch", "text": "...", "evidence": "OCF/NI 0.95 → 0.55 (FY24 → FY25)" }
  ],
  "skipped": [ { "id": "promoter-pledging", "reason": "not provided by data source" } ]
}
```

## Out of scope (v1)

- Peer-relative flags, auditor remarks, related-party transactions (need report parsing).
