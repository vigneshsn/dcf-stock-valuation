# Spec: Stock analysis agent

Source: `docs/live-data.md`. Terms follow `CONTEXT.md`.

## Goal

For a listed stock (Indian market first), produce an **Analysis** from live financial data and annual reports, and show it on the dashboard: a **Quantitative analysis** and a **Qualitative analysis**, each with a 1-5 score and a written explanation.

## Scope

- Indian stocks (NSE/BSE) only in v1.
- Free financial data APIs only.
- The two scores are shown side by side. There is no blended overall score.

## Quantitative analysis

- Show key ratios (P/E, P/B, ROE, ...) as context. They do not affect the score.
- Compute **Fair value** per share with the DCF. Defaults for growth, discount rate and terminal growth are derived from historical financials. The user can override them in the existing DCF calculator UI.
- **Quantitative score** (5 = most undervalued), from market price vs. Fair value:

| Score | Price vs. Fair value |
|---|---|
| 5 | more than 30% below |
| 4 | 10-30% below |
| 3 | within ±10% |
| 2 | 10-30% above |
| 1 | more than 30% above |

- The score comes with a written explanation.

## Qualitative analysis

> **Retired** ([#20](https://github.com/vigneshsn/dcf-stock-valuation/issues/20)): the Qualitative score, Management trustworthiness and the peer-relative Moat were removed. The Management & annual report block now shows MD&A insights, the [Guidance scorecard](spec-guidance-scorecard.md) as evidence, and the Moat as management's own view. Kept below for history.

Inputs: annual reports for the last 3 years.

- **Report acquisition**: fetch from BSE/NSE filings where possible; fall back to user upload.
- **Parsing**: PDFs are parsed locally in `server/`. A parsing library needs the user's explicit approval before it is added.
- **Section extraction**: extract only the "management discussion and analysis" section, chunk it and summarise each chunk. Judge from the summaries, because reports exceed the model's context window.
- **Moat**: judged from the extracted section against the **Peer set**.
- **Peer set**: the data source's industry classification, limited to the 3-5 nearest companies by market cap. The user can override the list.
- **Management trustworthiness**: compare each year's guidance with the next year's actuals. If fewer than 3 years are available, flag the result as lower-confidence.
- **Qualitative score** (1-5) combines Moat and Management trustworthiness. The explanation must quote the report text it relied on. The dashboard labels the score "experimental".

## LLM

- Local Ollama, called over its HTTP API (`localhost:11434`) from `server/`. No SDK.
- Model is configurable by env var. The default is `gemma3:1b` to prove the pipeline. Pull a larger model before judging output quality.
- LLM config stays server-side and is never exposed to the browser.

## Non-functional requirements

- Cache financial data to limit API calls.
- Cache each completed Analysis with a TTL, and serve it from cache while valid.

## Guardrails

- Get the user's confirmation before adding any third-party library.

## Verification

- UAT from the UI: run an Analysis on a known stock and check both scores, the explanations (including the quoted evidence), the cache behaviour and the user overrides.

## Out of scope for v1

- Non-Indian markets.
- A blended overall score.
- Hosted LLM providers.
