# Tickets: Stock analysis agent

Spec: `docs/spec-stock-analysis-agent.md`. GitHub issues: vigneshsn/dcf-stock-valuation.

| # | Ticket | Blocked by |
|---|---|---|
| [#2](https://github.com/vigneshsn/dcf-stock-valuation/issues/2) | Ratios and Fair value on the dashboard | none |
| [#3](https://github.com/vigneshsn/dcf-stock-valuation/issues/3) | Quantitative score | #2 |
| [#4](https://github.com/vigneshsn/dcf-stock-valuation/issues/4) | Analysis cache with TTL | #3 |
| [#5](https://github.com/vigneshsn/dcf-stock-valuation/issues/5) | Annual report acquisition | none |
| [#6](https://github.com/vigneshsn/dcf-stock-valuation/issues/6) | PDF parsing and MD&A extraction | #5 |
| [#7](https://github.com/vigneshsn/dcf-stock-valuation/issues/7) | Ollama client | none |
| [#8](https://github.com/vigneshsn/dcf-stock-valuation/issues/8) | Moat and Peer set | #6, #7 |
| [#9](https://github.com/vigneshsn/dcf-stock-valuation/issues/9) | Management trustworthiness | #6, #7 |
| [#10](https://github.com/vigneshsn/dcf-stock-valuation/issues/10) | Qualitative score on the dashboard | #8, #9 |
| [#11](https://github.com/vigneshsn/dcf-stock-valuation/issues/11) | UAT pass from the UI | #4, #10 |

## Details

### #2 Ratios and Fair value on the dashboard
Fetch live Indian-market financials from a free API and cache them. Show key ratios (P/E, P/B, ROE). Compute Fair value via DCF with defaults derived from history; the user can override them in the existing DCF calculator.

### #3 Quantitative score
1-5 score from Fair value vs. market price: 5 is more than 30% below, 4 is 10-30% below, 3 is within ±10%, 2 is 10-30% above, 1 is more than 30% above. Written explanation on the dashboard. Ratios do not affect it.

### #4 Analysis cache with TTL
Cache completed Analyses with a TTL and serve from cache while valid.

### #5 Annual report acquisition
Fetch the last 3 years of annual reports from BSE/NSE where possible; fall back to user upload.

### #6 PDF parsing and MD&A extraction
Parse PDFs locally in `server/`. Extract the management discussion and analysis section, then chunk and summarise it. The specific parsing library needs the user's approval before it is added.

### #7 Ollama client
Call local Ollama over HTTP (`localhost:11434`) from `server/`, with no SDK. Model is configurable by env var, default `gemma3:1b`. Config stays server-side.

### #8 Moat and Peer set
Peer set is the data source's industry classification, limited to the 3-5 nearest companies by market cap, and the user can override it. Judge Moat from the MD&A against the peers.

### #9 Management trustworthiness
Over the last 3 years, the LLM compares each year's guidance with the next year's actuals. Flag lower-confidence if fewer than 3 years are available.

### #10 Qualitative score on the dashboard
Combine Moat and Management trustworthiness into a 1-5 score, labelled experimental. The explanation quotes report text. Shown side by side with the Quantitative score, with no blended score.

### #11 UAT pass from the UI
Run an Analysis on a known stock. Verify both scores, explanations with quoted evidence, caching and user overrides.
