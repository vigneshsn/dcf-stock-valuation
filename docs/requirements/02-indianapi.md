# IndianAPI Stock Data Integration

## Goal

Use IndianAPI's stock endpoint (`https://stock.indianapi.in/stock`) for Indian stock data and expand the dashboard with company information, recent news, peer comparison, and analyst consensus. A sample response is available in `docs/requirements/stock_resp.json`.

## Provider selection and stock lookup

- Use a server-side `STOCK_DATA_PROVIDER` setting with `indianapi` as the default and `fmp` as an explicitly selectable alternative. This setting applies to stock data retrieval and to the quantitative (DCF) analysis; qualitative-analysis behavior, including its FMP-based default peer selection, remains unchanged.
- Do not automatically fall back to FMP when IndianAPI fails. Return an explicit error rather than mixing data from different providers in one response.
- With FMP selected, return empty news and peer arrays and null analyst and company-introduction sections; do not source IndianAPI-only sections in the background.
- The stock route continues to accept an NSE ticker. Trim whitespace and normalize it to uppercase, then use IndianAPI's `industry_search` endpoint to find an exact `exchangeCodeNsi` match and use the matched company's canonical name with `/stock?name=...`. `industry_search` matches company names rather than tickers (for example, `TCS` returns no results), so when it has no exact match, call `/stock?name=<ticker>` directly. In both cases, verify that the returned `companyProfile.exchangeCodeNse` matches the requested NSE ticker. Do not guess a BSE symbol or accept a different company's result.
- Return a not-found error when the NSE ticker cannot be resolved or verified. Return an explicit upstream error when the provider fails or the response lacks usable company identity or an NSE current price.
- Use only `currentPrice.NSE` as the current price. Do not substitute the BSE price, aggregate price, or closing price.

## Normalized stock data

- Preserve the existing normalized numeric stock-metrics response contract rather than exposing raw provider payloads.
- Map market capitalization from `stockDetailsReusableData.marketCap`, 52-week high/low from `yearHigh` and `yearLow`, and current price from `currentPrice.NSE`. Parse numeric strings as numbers without scaling. IndianAPI does not document the market-cap unit; do not convert it or claim a currency/unit until the provider confirms it.
- If company P/E, book value per share, or dividend yield is absent or unpopulated, return `null`. Do not substitute peer data or fall back to FMP for individual fields.
- Calculate ROE and ROCE using the existing formulas and IndianAPI's latest complete annual financial records with aligned periods. Represent ROE/ROCE as percentage points (for example, `14` means `14%`) and display the percent sign. Return `null` when required inputs are missing or invalid; do not mix annual and quarterly values.
- Do not add a financial-statement-history response or dashboard section in this migration.

## Dashboard sections

The normalized response always includes stable section keys. News and peers are arrays (empty when unavailable); analyst data is nullable. Missing optional sections do not make an otherwise usable stock response fail.

### Company introduction

- Show provider-supplied company name, industry, and a company-description excerpt of at most 500 characters.
- Do not generate or infer company copy. Show an empty state when the provider does not supply the optional information.

### Recent news

- Show at most five items, sorted newest-first by publication time.
- Normalize each item to headline, publication time, nullable source, and URL. Do not infer a publisher/source from the URL.
- Prefix relative article paths with `https://www.livemint.com`; preserve valid absolute HTTP(S) URLs and omit invalid links.
- Show an empty state when there are no valid news items.

### Peer comparison

- Source the new comparison table from IndianAPI's `companyProfile.peerCompanyList`. Show at most five companies, ordered by market capitalization descending. Put peers without a usable market cap after ranked peers in provider order; they may fill remaining slots.
- Do not invent or discover additional peers. Keep a peer when an individual comparison value is missing; display an empty placeholder for that cell.
- Include company name, price, market cap, P/E, P/B, trailing-12-month ROE, debt/equity, trailing-12-month profit margin, and dividend yield when supplied. Use percentage points and display `%` for ROE, profit margin, and dividend yield; display P/E, P/B, and debt/equity as ratios.
- Do not substitute five-year-average ROE or profit margin when trailing-12-month values are absent.
- Do not add a user override control for this table. Peer set selection stays on FMP.

### Analyst consensus

- Label this section **Analyst consensus**, not broker analysis: the provider supplies aggregate analyst ratings, not named broker reports.
- When available, show the current rating distribution and counts together with the `recosBar` overall recommendation summary. Omit the historical one-week and one-to-three-month count series.
- Attribute the data to IndianAPI and keep it separate from DCF fair value. Show an empty state when the provider has no analyst data.

## Caching

- Cache successful ticker resolution and stock data together for five minutes per normalized ticker, matching the current stock-cache TTL. Cache keys must distinguish providers.
- Leave existing analysis-result caching and its TTL behavior unchanged.

## Guardrails

- Get explicit confirmation before adding, changing, or installing any runtime or development dependency.
- Do not remove the FMP adapter; keep it selectable through provider configuration.

## UAT verification

Perform manual UI UAT for:

- An NSE stock with company information, metrics, news, peer data, and analyst consensus populated.
- Missing optional sections and missing individual peer values.
- An unresolved ticker and an IndianAPI failure, confirming explicit errors and no FMP fallback.
- Explicit FMP selection, confirming FMP metrics and empty/null IndianAPI-only sections.
