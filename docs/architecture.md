# System Architecture

DCF Stock Valuation has two parts: an **Angular 20 single-page app** and a **Node/Express proxy server**. The browser never calls third-party data APIs directly. The proxy keeps API keys server-side, normalises provider responses, caches results in memory, and runs the DCF and LLM-based analysis. Domain terms such as *Analysis*, *Fair value*, *Moat* and *Peer set* are defined in [CONTEXT.md](../CONTEXT.md).

## System overview

```mermaid
flowchart LR
    user([User / Browser])

    subgraph spa["Angular SPA (src/app) — ng serve :4200 / GitHub Pages"]
        direction TB
        router{{AppRoutingModule}}
        dcfc["DcfCalculatorComponent<br/>route: /"]
        dash["StockDashboardComponent<br/>route: /stock?q=TICKER<br/>(/fundamentals, /analysis redirect here)"]
        fb["FeedbackComponent<br/>route: /feedback"]
        helper["DcfHelperService"]
        export["CsvService / XlsxService"]
        stockSvc["StockService"]
        analysisSvc["AnalysisService"]

        router --> dcfc & dash & fb
        dcfc --> helper
        dcfc --> export
        dash --> stockSvc
        dash --> analysisSvc
    end

    subgraph server["Express proxy (server/src) — :3000"]
        direction TB
        idx["index.ts<br/>CORS · /health"]
        stockRoute["routes/stock.ts<br/>/api/stock"]
        analysisRoute["routes/analysis.ts<br/>/api/analysis"]
        provider["provider.ts<br/>STOCK_DATA_PROVIDER"]
        cache[("cache.ts<br/>in-memory TTL Map")]
        uploads[("reports.ts<br/>in-memory PDF uploads")]

        idx --> stockRoute & analysisRoute
        stockRoute --> provider
        analysisRoute --> provider
        stockRoute --> cache
        analysisRoute --> cache
        analysisRoute --> uploads
    end

    subgraph ext["External services"]
        indian["IndianAPI<br/>stock.indianapi.in"]
        fmp["Financial Modeling Prep<br/>financialmodelingprep.com/stable"]
        screener["Screener.in<br/>annual-report PDFs"]
        llmP["LLM providers, tried in order<br/>Gemini · Groq · local Ollama"]
        gforms["Google Forms"]
    end

    user --> router
    stockSvc -- "GET /api/stock/:ticker" --> stockRoute
    analysisSvc -- "GET/POST /api/analysis/:ticker/*" --> analysisRoute
    fb -. iframe .-> gforms

    provider -- "indianapi (default)" --> indian
    provider -- fmp --> fmp
    analysisRoute -- "peers (always FMP)" --> fmp
    analysisRoute -- "scrape + download" --> screener
    analysisRoute -- "summarise / judge" --> llmP
```

| Feature | Frontend | Backend | Data source |
| --- | --- | --- | --- |
| Manual DCF calculator with CSV/XLSX export | `DcfCalculatorComponent`, `DcfHelperService`, `CsvService`, `XlsxService` | — (runs entirely in the browser) | User input |
| Fundamentals (price, ratios, company context, peers) | `StockDashboardComponent`, `StockService` | `GET /api/stock/:ticker` | IndianAPI or FMP |
| Quantitative analysis (DCF Fair value + score) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/:ticker/quantitative` | IndianAPI or FMP |
| MD&A insights (key points, growth strategy, tailwinds, headwinds, risks, Moat; loads automatically) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/:ticker/insights` | Latest annual report (Screener.in / upload), one LLM call |
| Feature flags (which optional panels to show) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/features` | `ENABLE_QUALITATIVE`, `ENABLE_SWOT` |
| Qualitative analysis (Moat + Management trustworthiness; off unless `ENABLE_QUALITATIVE`) | `StockDashboardComponent`, `AnalysisService` | `POST /api/analysis/:ticker/qualitative` | Screener.in / uploaded PDFs, FMP peers, LLM |
| SWOT analysis (unscored, see [spec](spec-swot-analysis.md); off unless `ENABLE_SWOT`) | `StockDashboardComponent`, `AnalysisService` | `POST /api/analysis/:ticker/swot` | Latest annual report (Screener.in / upload), LLM, IndianAPI or FMP financials |
| Feedback | `FeedbackComponent` | — | Embedded Google Form |

## Backend modules

```mermaid
flowchart TB
    subgraph routes["HTTP layer"]
        stockR["routes/stock.ts"]
        analysisR["routes/analysis.ts"]
    end

    subgraph adapters["Upstream adapters"]
        indianapi["indianapi.ts<br/>fetchIndianApiStock<br/>fetchIndianApiQuantitativeInputs"]
        fmpA["fmp.ts<br/>fmpGet"]
        reports["reports.ts<br/>listReports · saveUpload"]
        llmA["llm.ts<br/>generate · generateJson<br/>provider fallback + retries"]
    end

    subgraph domain["Domain logic (pure, unit-tested)"]
        finance["finance.ts<br/>ROCE · ROE · annual alignment"]
        dcf["dcf.ts<br/>deriveDefaults · computeFairValue<br/>quantitativeScore"]
        mdna["mdna.ts<br/>pdfToText · extractMdna<br/>filterRelevant · summariseMdna"]
        years["yearSummaries.ts<br/>collectYearSummaries<br/>(disk cache per ticker/year/model)"]
        qual["qualitative.ts<br/>selectPeers · judgeMoat<br/>judgeManagement · qualitativeScore"]
        swot["swot.ts<br/>financialSwot · extractSwotSections<br/>latestReportSwot (disk cache per ticker/year/model)"]
        insights["insights.ts<br/>insightsInput · judgeInsights<br/>latestReportInsights (disk cache per ticker/year/model)"]
    end

    infra["provider.ts · cache.ts · features.ts"]

    stockR --> indianapi & fmpA & finance & infra
    analysisR --> indianapi & fmpA & dcf & years & qual & swot & insights & finance & infra
    years --> reports & mdna
    swot --> mdna & llmA
    insights --> mdna & swot & llmA
    mdna --> llmA
    qual --> llmA
```

## Request flows

### Fundamentals — `GET /api/stock/:ticker`

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/stock.ts
    participant C as cache.ts
    participant P as IndianAPI / FMP

    UI->>API: GET /api/stock/RELIANCE
    API->>C: get("stock:{provider}:{ticker}")
    alt cache hit (5 min TTL)
        C-->>API: StockData
    else cache miss
        API->>P: fetch quote, ratios, statements
        P-->>API: provider payload
        API->>API: normalise to StockData (ROCE/ROE via finance.ts)
        API->>C: set(key, data)
    end
    API-->>UI: 200 StockData | 404 Ticker not found | 502 Upstream fetch failed
```

### Quantitative analysis — `GET /api/analysis/:ticker/quantitative`

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/analysis.ts
    participant C as cache.ts
    participant P as IndianAPI / FMP
    participant D as dcf.ts

    UI->>API: GET .../quantitative?growth=&discount=&terminal=
    API->>C: analysis cache (6 h TTL, keyed by overrides)
    alt hit
        C-->>API: cached result
    else miss
        API->>C: financials cache (1 h TTL)
        opt miss
            API->>P: quote + 5y income / cash-flow / balance sheet
            P-->>API: QuantitativeInputs
        end
        API->>D: deriveDefaults(history)
        API->>D: computeFairValue(history, assumptions, shares)
        API->>D: quantitativeScore(fairValue, price)
        API->>C: store result
    end
    API-->>UI: Fair value, ratios, assumptions, score 1-5
```

### MD&A insights — `GET /api/analysis/:ticker/insights`

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/analysis.ts
    participant I as insights.ts
    participant D as Disk cache (.cache/insights)
    participant R as reports.ts
    participant L as LLM (Gemini → Groq → Ollama)

    UI->>API: GET .../insights (automatically, with every ticker)
    opt response cached in memory (6 h)
        API-->>UI: cached insights, no report or LLM calls
    end
    API->>I: latestReportInsights(ticker, model)
    I->>R: listReports(ticker, 1) → newest year (uploads win)
    I->>D: stored insights for ticker/year/model?
    opt miss
        I->>R: load() downloads the PDF
        I->>I: extractMdna · filterRelevant + O&T / Risks sections (≤ ~20k chars)
        I->>L: ONE JSON call: key points, growth strategy, tailwinds, headwinds, risks, Moat
        I->>I: keep quotes that appear verbatim in the input
        I->>D: store result (LLM failures are not stored)
    end
    API-->>UI: insights | 422 no-reports (upload a PDF) | 503 llm-unavailable
```

The ~20k-character budget (~5k tokens) keeps the single request inside free-tier per-minute token limits. Bump `INSIGHTS_VERSION` in `insights.ts` when input selection or the prompt changes.

### Qualitative analysis — `POST /api/analysis/:ticker/qualitative`

Disabled unless `ENABLE_QUALITATIVE=true` (the endpoint returns `404 disabled`); it needs about 11 LLM calls per new ticker.

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/analysis.ts
    participant Y as yearSummaries.ts
    participant D as Disk cache (.cache/mdna, .cache/qualitative)
    participant R as reports.ts
    participant S as Screener.in
    participant M as mdna.ts
    participant Q as qualitative.ts
    participant F as FMP
    participant L as LLM (Gemini → Groq → Ollama)

    opt user uploads PDFs
        UI->>API: POST .../reports?year=YYYY (application/pdf)
        API->>R: saveUpload(ticker, year, pdf)
        API->>D: forget stored summaries for that year and stored judgements for the ticker
    end
    UI->>API: POST .../qualitative { peers? }
    opt response cached in memory (6 h, keyed by ticker + model + peers)
        API-->>UI: cached result, no report, FMP or LLM calls
    end
    API->>Y: collectYearSummaries(ticker, model, 3)
    Y->>R: listReports(ticker, 3)
    R->>S: scrape company page for report links (if uploads < 3)
    R-->>Y: up to 3 report refs (uploads win per year, nothing downloaded yet)
    par each year in parallel
        Y->>D: stored summary for ticker/year/model?
        opt miss
            Y->>R: load() downloads the PDF
            Y->>M: pdfToText, extractMdna, filterRelevant, summariseMdna
            M->>L: summarise up to ~3 chunks concurrently (LLM_CONCURRENCY)
            Y->>D: store summary (or "no MD&A")
        end
    end
    alt no reports
        API-->>UI: 422 no-reports
    end
    API->>D: stored result for model + peers + summaries fingerprint? (.cache/qualitative, survives restarts)
    opt no peer override
        API->>F: /quote + /stock-peers → selectPeers (3-5 by market cap)
    end
    par
        API->>Q: judgeMoat(latest, peers)
        Q->>L: moat judgement (JSON)
    and management, stored on disk independently of peers
        API->>Q: judgeManagement(summaries)
        Q->>L: guidance vs. actuals per year pair, in parallel (JSON)
    end
    API->>Q: qualitativeScore(moat, management)
    API->>D: store result
    API-->>UI: score 1-5 (experimental) + quotes | 503 llm-unavailable
```

### SWOT analysis — `POST /api/analysis/:ticker/swot`

Disabled unless `ENABLE_SWOT=true` (the endpoint returns `404 disabled`).

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/analysis.ts
    participant P as IndianAPI / FMP
    participant S as swot.ts
    participant D as Disk cache (.cache/swot)
    participant R as reports.ts
    participant L as LLM (Gemini → Groq → Ollama)

    UI->>API: POST .../swot
    opt response cached in memory (6 h)
        API-->>UI: cached SWOT, no upstream calls
    end
    par financials (1 h cache)
        API->>P: latest fiscal year statements, ROE, ROCE, debt/equity
        API->>S: financialSwot → Strengths / Weaknesses (rules, no LLM)
    and latest annual report
        API->>S: latestReportSwot(ticker, model)
        S->>R: listReports → newest year (uploads win)
        S->>D: stored SWOT for ticker/year/model?
        opt miss
            S->>R: load() downloads the PDF
            S->>S: extractMdna · extractSwotSections (O&T, Risks and Concerns)
            S->>L: S/W from MD&A ∥ O/T from sections (or MD&A fallback, lower-confidence)
            S->>D: store result
        end
    end
    API-->>UI: 2×2 SWOT (report items with verified quotes + financials items) and per-part status
```

The SWOT is a partial-result endpoint: if every LLM provider fails or no report is available, `report.status` explains why and the financials-based Strengths/Weaknesses are still returned. Bump `SWOT_VERSION` in `swot.ts` when section detection or the SWOT prompts change. A complete response (financials loaded, report analysed) is also cached in memory for `ANALYSIS_TTL_MS` (6 h) so repeat requests make no IndianAPI, report-listing or LLM calls; partial results are not cached, and uploading a report clears it.

MD&A summaries of past annual reports never change, so they are stored on disk per ticker, year and model and reused across restarts. Bump `SUMMARY_VERSION` in `yearSummaries.ts` when extraction, filtering or the summary prompt changes. `filterRelevant` keeps at most ~30k characters of guidance, competitive-position and results passages per year (dropping macro-economic commentary, ESG metrics and tables), so each year needs about 3 summary calls.

## Configuration

Server environment variables are loaded from `server/.env` via `dotenv`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Proxy listen port |
| `STOCK_DATA_PROVIDER` | `indianapi` | `indianapi` or `fmp` for stock and quantitative data |
| `INDIANAPI_API_KEY` | — | IndianAPI key |
| `INDIANAPI_BASE_URL` | `https://stock.indianapi.in` | IndianAPI base URL |
| `FMP_API_KEY` | — | FMP key (also required for qualitative peer selection) |
| `FINANCIALS_TTL_MS` | `3600000` (1 h) | Cache TTL for raw financials |
| `ANALYSIS_TTL_MS` | `21600000` (6 h) | Cache TTL for computed analyses |
| `ENABLE_QUALITATIVE` | `false` | Enables the 3-report Qualitative analysis endpoint and panel |
| `ENABLE_SWOT` | `false` | Enables the SWOT analysis endpoint and panel |
| `LLM_PROVIDERS` | keyed cloud providers, then `ollama` | Comma-separated order of `gemini`, `groq`, `ollama`; the next is tried when one fails |
| `LLM_CONCURRENCY` | `4` (or `OLLAMA_CONCURRENCY`) | Max in-flight LLM requests from the proxy; use 1–2 on free cloud tiers, pair with Ollama's `OLLAMA_NUM_PARALLEL` locally |
| `LLM_MAX_RETRIES` | `2` | Retries per provider on 429 / 5xx before falling back |
| `LLM_MAX_RETRY_WAIT_MS` | `30000` | Longer suggested waits (spent quotas) fall back immediately |
| `LLM_TIMEOUT_MS` | `60000` | Per-request timeout for cloud providers (Ollama has none) |
| `GEMINI_API_KEY` | — | Enables Gemini (OpenAI-compatible endpoint, free tier) |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model |
| `GEMINI_REASONING_EFFORT` | `low` | Sent as `reasoning_effort`; empty to omit |
| `GROQ_API_KEY` | — | Enables Groq (OpenAI-compatible endpoint, free tier) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model |
| `GROQ_REASONING_EFFORT` | `low` | Sent as `reasoning_effort`; empty to omit (non-reasoning models) |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen3:8b` | Local model |
| `OLLAMA_NUM_CTX` | `8192` | Context window requested per Ollama call |
| `QUALITATIVE_CACHE_DIR` | `server/.cache/qualitative` | Directory for stored Moat / Management results (bump `QUALITATIVE_VERSION` in `qualitativeStore.ts` when prompts change) |
| `MDNA_CACHE_DIR` | `server/.cache/mdna` | Directory for stored per-year MD&A summaries |
| `SWOT_CACHE_DIR` | `server/.cache/swot` | Directory for stored per-year report SWOT results |
| `INSIGHTS_CACHE_DIR` | `server/.cache/insights` | Directory for stored per-year MD&A insights |

The frontend services hard-code the proxy at `http://localhost:3000`.

## Key design decisions and constraints

- **Proxy, not direct calls.** Keeps API keys out of the browser and lets the provider be swapped (`provider.ts`) without frontend changes.
- **NSE only.** Tickers are bare NSE symbols (an optional `.NS` suffix is accepted). Other exchange suffixes are rejected as not found.
- **Peer selection always uses FMP**, regardless of `STOCK_DATA_PROVIDER`.
- **All state is in process memory.** The response cache and uploaded PDFs are lost on restart and are not shared between instances.
- **Separate scores.** Quantitative and Qualitative scores are shown side by side and never blended. The Qualitative score is labelled experimental. MD&A insights and the SWOT analysis are unscored and also labelled experimental.
- **Free-tier LLM budget.** MD&A insights use one LLM call per annual report and are the only LLM feature on by default; the many-call Qualitative and SWOT analyses are opt-in via `ENABLE_QUALITATIVE` / `ENABLE_SWOT`.
- **Swappable LLM.** `llm.ts` tries Gemini, Groq and local Ollama in the configured order, retrying rate limits before falling back; an answer that is not valid JSON (or is cut off at `max_tokens`) also falls back. Disk and memory caches are keyed on the first provider's model, so a fallback answer is cached under the same key. If every provider fails, the insights and qualitative endpoints return `503 llm-unavailable` and the rest of the app keeps working.

## Testing

| Layer | Tooling | Location |
| --- | --- | --- |
| Server unit tests | `node:test` via `tsx --test` | `server/src/*.test.ts` |
| Angular unit tests | Karma + Jasmine | `src/app/**/*.spec.ts` |
| End-to-end smoke | Playwright | `e2e/smoke.spec.ts` |
