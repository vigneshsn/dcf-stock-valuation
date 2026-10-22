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
        ollama["Ollama (local LLM)<br/>localhost:11434 · qwen3:8b"]
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
    analysisRoute -- "summarise / judge" --> ollama
```

| Feature | Frontend | Backend | Data source |
| --- | --- | --- | --- |
| Manual DCF calculator with CSV/XLSX export | `DcfCalculatorComponent`, `DcfHelperService`, `CsvService`, `XlsxService` | — (runs entirely in the browser) | User input |
| Fundamentals (price, ratios, news, peers, consensus) | `StockDashboardComponent`, `StockService` | `GET /api/stock/:ticker` | IndianAPI or FMP |
| Quantitative analysis (DCF Fair value + score) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/:ticker/quantitative` | IndianAPI or FMP |
| Qualitative analysis (Moat + Management trustworthiness) | `StockDashboardComponent`, `AnalysisService` | `POST /api/analysis/:ticker/qualitative` | Screener.in / uploaded PDFs, FMP peers, Ollama |
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
        ollamaA["ollama.ts<br/>generate · generateJson"]
    end

    subgraph domain["Domain logic (pure, unit-tested)"]
        finance["finance.ts<br/>ROCE · ROE · annual alignment"]
        dcf["dcf.ts<br/>deriveDefaults · computeFairValue<br/>quantitativeScore"]
        mdna["mdna.ts<br/>pdfToText · extractMdna<br/>filterRelevant · summariseMdna"]
        years["yearSummaries.ts<br/>collectYearSummaries<br/>(disk cache per ticker/year/model)"]
        qual["qualitative.ts<br/>selectPeers · judgeMoat<br/>judgeManagement · qualitativeScore"]
    end

    infra["provider.ts · cache.ts"]

    stockR --> indianapi & fmpA & finance & infra
    analysisR --> indianapi & fmpA & dcf & years & qual & finance & infra
    years --> reports & mdna
    mdna --> ollamaA
    qual --> ollamaA
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

### Qualitative analysis — `POST /api/analysis/:ticker/qualitative`

```mermaid
sequenceDiagram
    autonumber
    participant UI as StockDashboardComponent
    participant API as routes/analysis.ts
    participant Y as yearSummaries.ts
    participant D as Disk cache (.cache/mdna)
    participant R as reports.ts
    participant S as Screener.in
    participant M as mdna.ts
    participant Q as qualitative.ts
    participant F as FMP
    participant L as Ollama

    opt user uploads PDFs
        UI->>API: POST .../reports?year=YYYY (application/pdf)
        API->>R: saveUpload(ticker, year, pdf)
        API->>D: forget stored summaries for that year
    end
    UI->>API: POST .../qualitative { peers? }
    API->>Y: collectYearSummaries(ticker, model, 3)
    Y->>R: listReports(ticker, 3)
    R->>S: scrape company page for report links (if uploads < 3)
    R-->>Y: up to 3 report refs (uploads win per year, nothing downloaded yet)
    par each year in parallel
        Y->>D: stored summary for ticker/year/model?
        opt miss
            Y->>R: load() downloads the PDF
            Y->>M: pdfToText, extractMdna, filterRelevant, summariseMdna
            M->>L: summarise up to ~3 chunks concurrently (OLLAMA_CONCURRENCY)
            Y->>D: store summary (or "no MD&A")
        end
    end
    alt no reports
        API-->>UI: 422 no-reports
    end
    API->>API: analysis cache (keyed by peers + summaries fingerprint)
    opt no peer override
        API->>F: /quote + /stock-peers → selectPeers (3-5 by market cap)
    end
    par
        API->>Q: judgeMoat(latest, peers)
        Q->>L: moat judgement (JSON)
    and management, cached independently of peers
        API->>Q: judgeManagement(summaries)
        Q->>L: guidance vs. actuals per year pair, in parallel (JSON)
    end
    API->>Q: qualitativeScore(moat, management)
    API-->>UI: score 1-5 (experimental) + quotes | 503 llm-unavailable
```

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
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen3:8b` | Model used for MD&A summaries and judgements |
| `OLLAMA_NUM_CTX` | `8192` | Context window requested per Ollama call |
| `OLLAMA_CONCURRENCY` | `4` | Max in-flight Ollama requests from the proxy (pair with Ollama's `OLLAMA_NUM_PARALLEL`) |
| `MDNA_CACHE_DIR` | `server/.cache/mdna` | Directory for stored per-year MD&A summaries |

The frontend services hard-code the proxy at `http://localhost:3000`.

## Key design decisions and constraints

- **Proxy, not direct calls.** Keeps API keys out of the browser and lets the provider be swapped (`provider.ts`) without frontend changes.
- **NSE only.** Tickers are bare NSE symbols (an optional `.NS` suffix is accepted). Other exchange suffixes are rejected as not found.
- **Peer selection always uses FMP**, regardless of `STOCK_DATA_PROVIDER`.
- **All state is in process memory.** The response cache and uploaded PDFs are lost on restart and are not shared between instances.
- **Separate scores.** Quantitative and Qualitative scores are shown side by side and never blended. The Qualitative score is labelled experimental.
- **Local LLM.** The qualitative analysis depends on a reachable Ollama instance. If it is unreachable, the endpoint returns `503 llm-unavailable` and the rest of the app keeps working.

## Testing

| Layer | Tooling | Location |
| --- | --- | --- |
| Server unit tests | `node:test` via `tsx --test` | `server/src/*.test.ts` |
| Angular unit tests | Karma + Jasmine | `src/app/**/*.spec.ts` |
| End-to-end smoke | Playwright | `e2e/smoke.spec.ts` |
