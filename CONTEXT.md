# Stock Analysis

Fundamental analysis of listed stocks (Indian market first) from live financial data and annual reports, producing scores and a fair value shown on a dashboard.

## Language

**Analysis**:
The complete fundamental assessment of one stock, made of a Quantitative analysis, a Qualitative analysis and an unscored SWOT analysis. The two scores are always presented side by side; there is no blended overall score.
_Avoid_: Report, evaluation

**Quantitative analysis**:
The numbers-based half of an Analysis: key financial ratios (P/E, P/B, ROE) and a DCF-derived Fair value, summarised by a Quantitative score.
_Avoid_: Financial analysis

**Qualitative analysis**:
The annual-report-based half of an Analysis: Moat assessment and Management trustworthiness, summarised by a Qualitative score.
_Avoid_: Narrative analysis

**Fair value**:
The per-share intrinsic value of a stock, produced purely by the DCF calculation (same as intrinsic value). Ratios do not influence it.
_Avoid_: Target price, intrinsic price

**Quantitative score**:
An integer 1-5 (5 = most undervalued) derived from how Fair value compares with the current market price using fixed margin-of-safety bands (5: price >30% below Fair value; 4: 10-30% below; 3: within ±10%; 2: 10-30% above; 1: >30% above), with a written explanation. Ratios are shown as context and do not affect the score.
_Avoid_: Valuation score

**Qualitative score**:
An integer 1-5 combining Moat and Management trustworthiness, with a written explanation that quotes the report text it relied on. Labelled experimental.
_Avoid_: Quality score

**Moat**:
A company's durable competitive advantage, judged from the annual report's management analysis section compared against industry peers.
_Avoid_: Edge, USP

**Management trustworthiness**:
A judgement of whether management's past statements matched outcomes, based on the last 3 years of annual reports, comparing each year's guidance with the next year's actuals. With fewer than 3 years available, the judgement is flagged lower-confidence.
_Avoid_: Governance score

**Peer set**:
The companies from the same industry used to judge Moat. Defined as the stock's industry classification from the data source, limited to the 3-5 nearest companies by market cap; the user can override the list.
_Avoid_: Competitors, comparables

**SWOT analysis**:
An unscored, informational part of an Analysis listing the stock's Strengths, Weaknesses, Opportunities and Threats for the latest fiscal year, judged from the Latest annual report and that year's financials. It never affects any score.
_Avoid_: SWOT score, risk analysis

**Latest annual report**:
The most recent annual report available for the stock (uploaded or fetched), covering the latest completed fiscal year. Not trailing-twelve-month data.
_Avoid_: Last year's report, current report

**SWOT item**:
One entry in a SWOT quadrant, tagged with its source: *report* (backed by a verified quote from the Latest annual report) or *financials* (backed by a named metric and its value). Opportunities and Threats come only from the report; Threats include the report's "Risks and concerns". An Opportunities or Threats quadrant found without its dedicated report section is flagged lower-confidence.
_Avoid_: Point, factor
