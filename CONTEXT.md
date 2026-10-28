# Stock Analysis

Fundamental analysis of listed stocks (Indian market first) from live financial data and annual reports, producing scores and a fair value shown on a dashboard.

## Language

**Analysis**:
The complete fundamental assessment of one stock, read in order: business overview, financials (statements, Strengths / Weaknesses, Red flags, peers), MD&A insights with the Guidance scorecard, Quantitative analysis, and the Decision summary. Facts come before judgement; there is no blended overall score and no verdict.
_Avoid_: Report, evaluation

**Quantitative analysis**:
The numbers-based half of an Analysis: key financial ratios (P/E, P/B, ROE) and a DCF-derived Fair value, summarised by a Quantitative score.
_Avoid_: Financial analysis

**MD&A insights**:
An unscored summary of the Latest annual report's Management Discussion and Analysis, produced in a single LLM call: key points, revenue growth strategy, Tailwinds, Headwinds, Investment risks and a Moat rating. Each point carries a verbatim quote from the report when one can be verified. Labelled experimental.
_Avoid_: Report summary, AI summary

**Tailwind / Headwind**:
An external or internal factor named in the report that is currently helping (tailwind) or holding back (headwind) the business. Distinct from an Investment risk, which may or may not materialise.
_Avoid_: Driver, drag

**Investment risk**:
A risk the annual report itself names that may or may not materialise, found by the LLM in MD&A insights. Never called a Red flag.
_Avoid_: Red flag (LLM), threat

**Fair value**:
The per-share intrinsic value of a stock, produced purely by the DCF calculation (same as intrinsic value). Ratios do not influence it.
_Avoid_: Target price, intrinsic price

**Quantitative score**:
An integer 1-5 (5 = most undervalued) derived from how Fair value compares with the current market price using fixed margin-of-safety bands (5: price >30% below Fair value; 4: 10-30% below; 3: within ±10%; 2: 10-30% above; 1: >30% above), with a written explanation. Ratios are shown as context and do not affect the score.
_Avoid_: Valuation score

**Moat**:
A company's durable competitive advantage as rated in MD&A insights from the Latest annual report alone, so it is presented as management's own view, not a peer-relative judgement.
_Avoid_: Edge, USP

**Peer set**:
The companies from the same industry used as the benchmark for Strength / Weakness findings and peer comparison. Defined as the stock's industry classification from the data source, limited to the 3-5 nearest companies by market cap; the user can override the list.
_Avoid_: Competitors, comparables

**Latest annual report**:
The most recent annual report available for the stock (uploaded or fetched), covering the latest completed fiscal year. Not trailing-twelve-month data.
_Avoid_: Last year's report, current report

**Implied growth**:
The annual growth rate that makes the DCF Fair value equal the current market price, i.e. what the market is pricing in. Unscored.
_Avoid_: Market expectation, reverse growth

**Guidance claim**:
A forward-looking, measurable statement in an annual report (metric, target, horizon year, verbatim quote). Scored only when its metric exists in the financial data; vague claims stay unscored.
_Avoid_: Promise, forecast

**Guidance scorecard**:
The per-claim comparison of Guidance claims with the later actuals, giving each claim a verdict (met, near, missed, pending). The evidence for whether management delivers, left for the user to judge; unscored, with no trust score derived from it.
_Avoid_: Management report card, Management trustworthiness, Qualitative score

**Strength / Weakness**:
A deterministic, fact-based finding where a financial metric is clearly better (Strength) or worse (Weakness) than the company's own history or the Peer set median, stated with both numbers. Unscored. Compared on a fixed set of metrics and only listed when the difference is clear.
_Avoid_: Pros and cons, SWOT

**Decision summary**:
The closing view of an Analysis that sets out the evidence side by side (business quality, financial health, Strengths / Weaknesses, Red flags, valuation) without any verdict, recommendation, or wording that nudges the user to buy or sell. The decision belongs to the user.
_Avoid_: Verdict, recommendation, conclusion

**Self-check**:
The user's own per-stock checklist in the Decision summary (e.g. "I can explain how this company makes money"), ticked by the user, never by the app.
_Avoid_: Buy checklist, readiness score

**Red flag**:
A deterministic warning raised by a rule over the financials (earnings quality, leverage, promoter holding). Unscored; absence of flags is not a positive signal.
_Avoid_: Risk score, alert

**Scenario**:
A bear, base or bull Fair value computed by shifting growth and discount rate around the base DCF assumptions. The base scenario is the Fair value.
_Avoid_: Forecast case

**Thesis**:
A user's recorded reason for owning a stock, expressed as measurable Thesis checkpoints that are re-evaluated as new financials arrive. Never feeds into a score.
_Avoid_: Note, watch reason

**Thesis checkpoint**:
One measurable condition of a Thesis (metric, operator, target, optional year) with a status of intact, weakening, broken or pending.
_Avoid_: Milestone, alert
