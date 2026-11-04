# One Market edition per deployment

The app serves either the India or the US market, chosen by `STOCK_DATA_PROVIDER` (`indianapi` = India, `fmp` = US). The edition fixes data sources, ticker rules, currency, number formatting, unit scale and annual report source; providers are never mixed or switched in-app. In the US edition market and financial data come from FMP but 10-Ks come from SEC EDGAR, because FMP supplies only XBRL statement tables, not the MD&A narrative the insights and Guidance scorecard need.

## Considered Options

- **FMP for everything, including Indian reports**: rejected; FMP has no Indian annual report source and its NSE coverage needs a higher plan.
- **In-app market toggle**: rejected; each edition has different data sources and units, so a toggle would multiply caching and failure modes for little benefit.

## Consequences

- Analyst consensus and news are removed in both editions (consistent with ADR 0001; FMP news is also plan-restricted).
- Currency, locale, unit scale and ticker rules live behind one market descriptor served by the backend; components must not hard-code ₹, crore or `en-IN`.
- The annual report source and section locator are server-only and live behind one `ReportProfile` per edition (`server/src/reportProfiles.ts`); callers receive the profile and never branch on the edition.
- US edition needs `SEC_USER_AGENT` (required) and throttled, cached EDGAR requests; Peer set is limited to the edition's own market.
- Fiscal years are matched on the company's own fiscal-year label.
