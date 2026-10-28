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
| Financial statements (5 fiscal years: income, balance sheet, cash flow; unscored) | `FinancialStatementsComponent`, `AnalysisService` | `GET /api/analysis/:ticker/statements` | IndianAPI or FMP (cached financials, amounts in ₹ crore) |
| Strength / Weakness findings (ROCE, ROE, net margin, revenue growth, debt / equity, cash conversion vs own history or Peer set median; ≥20% gaps only; unscored) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/:ticker/strengths-weaknesses` | IndianAPI or FMP (cached financials); peer ROE and net margin from IndianAPI only |
| MD&A insights ("What does management say?" and the Moat, management's own view; loads automatically) | `StockDashboardComponent`, `AnalysisService` | `GET /api/analysis/:ticker/insights` | Latest annual report (Screener.in / upload), one LLM call |
| Guidance scorecard ("Do they deliver?"; met / near / missed / pending counts, no trust score; see [spec](spec-guidance-scorecard.md)) | `StockDashboardComponent`, `AnalysisService` | `POST /api/analysis/:ticker/guidance` | Up to 3 past annual reports, one cached LLM call each, IndianAPI or FMP financials |
| Peer set (benchmark for Strength / Weakness; not yet shown) | `AnalysisService.getPeers` | `GET /api/analysis/:ticker/peers` | FMP |
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
        mdna["mdna.ts<br/>pdfToText · extractMdna · passages"]
        sections["reportSections.ts<br/>extractOutlookSections · outlookPassages"]
        quotes["quotes.ts<br/>verifiedQuote"]
        peers["peers.ts<br/>selectPeers"]
        guidance["guidance.ts<br/>collectGuidance · guidanceScorecard<br/>(disk cache per ticker/year/model)"]
        insights["insights.ts<br/>insightsInput · judgeInsights<br/>latestReportInsights (disk cache per ticker/year/model)"]
    end

    infra["provider.ts · cache.ts"]

    stockR --> indianapi & fmpA & finance & infra
    analysisR --> indianapi & fmpA & reports & dcf & peers & guidance & insights & finance & infra
    sections --> mdna
    insights --> mdna & sections & quotes & guidance & llmA
    guidance --> mdna & quotes & llmA
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

## Configuration

Server environment variables are loaded from `server/.env` via `dotenv`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Proxy listen port |
| `STOCK_DATA_PROVIDER` | `indianapi` | `indianapi` or `fmp` for stock and quantitative data |
| `INDIANAPI_API_KEY` | — | IndianAPI key |
| `INDIANAPI_BASE_URL` | `https://stock.indianapi.in` | IndianAPI base URL |
| `FMP_API_KEY` | — | FMP key (also required for the Peer set) |
| `FINANCIALS_TTL_MS` | `3600000` (1 h) | Cache TTL for raw financials |
| `ANALYSIS_TTL_MS` | `21600000` (6 h) | Cache TTL for computed analyses |
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
| `INSIGHTS_CACHE_DIR` | `server/.cache/insights` | Directory for stored per-year MD&A insights |
| `GUIDANCE_CACHE_DIR` | `server/.cache/guidance` | Directory for stored per-year guidance claims |

The frontend services hard-code the proxy at `http://localhost:3000`.

## Key design decisions and constraints

- **Proxy, not direct calls.** Keeps API keys out of the browser and lets the provider be swapped (`provider.ts`) without frontend changes.
- **NSE only.** Tickers are bare NSE symbols (an optional `.NS` suffix is accepted). Other exchange suffixes are rejected as not found.
- **Peer selection always uses FMP**, regardless of `STOCK_DATA_PROVIDER`.
- **All state is in process memory.** The response cache and uploaded PDFs are lost on restart and are not shared between instances.
- **One score.** The Quantitative score is the only score. MD&A insights, the Moat (management's own view) and the Guidance scorecard are unscored evidence; there is no Qualitative score or trust score (see [ADR 0001](adr/0001-evidence-without-verdict.md)).
- **Free-tier LLM budget.** MD&A insights use one LLM call per annual report and load automatically; the Guidance scorecard uses one cached call per past report and runs on demand.
- **Swappable LLM.** `llm.ts` tries Gemini, Groq and local Ollama in the configured order, retrying rate limits before falling back; an answer that is not valid JSON (or is cut off at `max_tokens`) also falls back. Disk and memory caches are keyed on the first provider's model, so a fallback answer is cached under the same key. If every provider fails, the insights and guidance endpoints return `503 llm-unavailable` and the rest of the app keeps working.

## Testing

| Layer | Tooling | Location |
| --- | --- | --- |
| Server unit tests | `node:test` via `tsx --test` | `server/src/*.test.ts` |
| Angular unit tests | Karma + Jasmine | `src/app/**/*.spec.ts` |
| End-to-end smoke | Playwright | `e2e/smoke.spec.ts` |
