# Spec: SWOT analysis

An unscored **SWOT analysis** (see [CONTEXT.md](../CONTEXT.md)) for the latest fiscal year, built from the **Latest annual report** and that year's financials, shown in its own dashboard tile.

## Decisions

| # | Decision |
| --- | --- |
| 1 | SWOT is a third, **unscored** part of an Analysis. It never affects the Quantitative or Qualitative score. |
| 2 | "Last year" = the Latest annual report (most recent fiscal year available, uploaded or fetched) and that year's financials. Not TTM. |
| 3 | **Strengths / Weaknesses** combine two sources, each item tagged: *report* (LLM, from the MD&A) and *financials* (deterministic rules). **Opportunities / Threats** come from the report only. |
| 4 | The MD&A's "Risks and concerns" content is folded into **Threats**. |
| 5 | Every *report* item carries a quote verified verbatim against the report text; unverifiable items are dropped. Every *financials* item cites its metric and value. |
| 6 | If the report has no recognisable Opportunities/Threats or Risks section, O/T are extracted from the whole MD&A and those quadrants are flagged **lower-confidence**. |
| 7 | Own full-width dashboard tile, own "Run SWOT analysis" button and endpoint; independent of the Qualitative analysis but reuses the same uploaded/fetched reports. |
| 8 | Financials rules are deterministic (no LLM), latest fiscal year only (see table below). |
| 9 | Financials rules are absolute / year-over-year only; no Peer set comparison in v1. |
| 10 | At most **5 report items per quadrant**, ranked by importance by the LLM; financials items are listed in addition. |
| 11 | Report-sourced SWOT is stored on disk per ticker / year / model with a version constant, and forgotten when a report for that year is uploaded. Financials items are recomputed per request (financials themselves are cached 1 h). |
| 12 | Degraded modes return a **partial result**: financials S/W are still returned when Ollama is unreachable or no report is available; the report part carries a status explaining why it is missing. |
| 13 | The tile is labelled **experimental**. |
| 14 | Recognised headings: "Opportunities and/& Threats", "Opportunities and/& Challenges", "Risks and Opportunities" (→ O and T); "Threats, Risks and Concerns", "Risks and/& Concerns", "Risk Management", "Critical / Key / Principal / Major / Material risks" (→ T). Table-of-contents lines (ending in a page number) are ignored. A line counts as a heading when it is the bare phrase, a Title-Case line starting with it, or a short unpunctuated line starting with it whose next line begins a new sentence (e.g. "Critical risks and mitigation strategies"). The last two groups were added after probing integrated reports (Asian Paints, Maruti) that never use the statutory "Opportunities and Threats" heading. |
| 15 | The tile shows fiscal year and report source (e.g. "FY2025 · uploaded"), a 2×2 grid, a *report* / *financials* badge per item, expandable evidence (quote or metric), and a lower-confidence marker per quadrant. |

## Financials rules (latest fiscal year)

Metrics in the neutral band produce no item. Missing metrics are skipped silently. YoY rules need the previous fiscal year to be present.

| Metric | Strength | Weakness |
| --- | --- | --- |
| Revenue growth YoY | ≥ 15% | < 0% |
| Net profit growth YoY (previous year profitable) | ≥ 15% | < 0% |
| Net margin change YoY | ≥ +2 pts | ≤ −2 pts |
| ROE | ≥ 18% | < 10% |
| ROCE | ≥ 18% | < 10% |
| Free cash flow (net income + non-cash expense − capex) | — | < 0 |
| Debt / equity | < 0.3 | > 1.0 |

## API

`POST /api/analysis/:ticker/swot`

```jsonc
{
  "ticker": "TCS",
  "model": "qwen3:8b",
  "experimental": true,
  "report": {
    "status": "ok",            // ok | no-reports | no-mdna | llm-unavailable | failed
    "message": null,           // human-readable reason when status != ok
    "year": 2025,              // fiscal year of the Latest annual report, null if none
    "source": "screener",      // screener | upload | null
    "cached": true
  },
  "financials": { "status": "ok", "year": 2025, "message": null }, // ok | unavailable
  "strengths":     { "items": [SwotItem], "lowerConfidence": false },
  "weaknesses":    { "items": [SwotItem], "lowerConfidence": false },
  "opportunities": { "items": [SwotItem], "lowerConfidence": false },
  "threats":       { "items": [SwotItem], "lowerConfidence": true }
}
// SwotItem = { "text": string, "source": "report" | "financials", "evidence": string }
```

- `404` when the ticker is not found by the stock-data provider and no report exists either.
- Report uploads go through the existing `POST /api/analysis/:ticker/reports?year=YYYY`.

## Pipeline (report part)

1. Pick the Latest annual report from `listReports` (uploads win per year); fall back to a stored SWOT year when the listing is unavailable.
2. On a disk-cache miss: download the PDF → `pdfToText` → `extractMdna`.
3. Locate Opportunities/Threats and Risks sections by heading (within the MD&A, else the full text).
4. One LLM call for S/W over the filtered MD&A, one for O/T over the located sections (or keyword-selected MD&A passages as a lower-confidence fallback).
5. Verify each quote against the text sent to the model; drop unverified items; cap at 5 per quadrant.
6. Store the result on disk (`SWOT_CACHE_DIR`, default `server/.cache/swot`), keyed by ticker / year / model / `SWOT_VERSION`.

## Out of scope (v1)

- Peer-relative financial strengths/weaknesses.
- Multi-year SWOT trends.
- Blending SWOT into any score.
