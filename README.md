# DCF Valuation App


An interactive Angular application to estimate the intrinsic value of a stock using Discounted Cash Flow (DCF). Features:


- Modern Angular + TypeScript
- Responsive UI styled with Angular Material
- Editable projection table (revenue growth %, profit margin %, FCF %)
- CSV and Excel (XLSX) export
- Printable report
- Unit tests (Jasmine + Karma)

See [docs/architecture.md](docs/architecture.md) for the system architecture diagrams.


## Setup


1. Ensure Node.js LTS (>=18) and npm are installed.
2. Clone the repo:


```bash
git clone https://github.com/YOUR_USERNAME/dcf-valuation-app.git
cd dcf-valuation-app
```


3. Install dependencies:


```bash
npm install
```


4. Run the app locally:


```bash
npm start
```


5. Run tests:


```bash
npm test
```


## Build


```bash
npm run build
```



## Backend Server (stock data proxy)

The `server/` directory contains a standalone Express + TypeScript proxy that fetches stock data from IndianAPI by default. FMP remains available as an explicit alternative. It runs independently of the Angular app on port 3000.

1. Install backend dependencies:

```bash
cd server
npm install
```

2. Configure the stock-data provider in `server/.env`:

```bash
STOCK_DATA_PROVIDER=indianapi
INDIANAPI_API_KEY=your_indianapi_api_key
```

IndianAPI is the default. Its base URL defaults to `https://dev.indianapi.in`; set `INDIANAPI_BASE_URL` only when using a different documented endpoint. To explicitly use FMP instead:

```
STOCK_DATA_PROVIDER=fmp
FMP_API_KEY=your_financial_modeling_prep_api_key
```

The selected provider is used for the entire stock response and for the quantitative (DCF) analysis; the server does not automatically fall back or combine provider data. The qualitative analysis still uses FMP for its default peer list, so set `FMP_API_KEY` if you rely on it. Get an IndianAPI key at https://indianapi.in/ or an FMP key at https://site.financialmodelingprep.com/.

**MD&A insights** (always on) read the latest annual report's Management Discussion and Analysis plus its opportunities/threats/risks sections (about 20k characters, ~5k tokens) in **one LLM call**, and list key points, revenue growth strategy, tailwinds, headwinds, investment risks and a Moat rating, each backed by a verbatim quote where one can be verified. The result is stored on disk under `server/.cache/insights` (override with `INSIGHTS_CACHE_DIR`), so each report is analysed once.

The Qualitative analysis (Moat + management guidance over 3 annual reports, ~11 LLM calls) and the SWOT analysis (~2 more calls plus financials) are **disabled by default** because they exhaust free-tier quotas. Enable them in `server/.env` with `ENABLE_QUALITATIVE=true` and/or `ENABLE_SWOT=true`; the UI shows their panels only when `GET /api/analysis/features` reports them enabled.

All three use an LLM. Providers are tried in order, and the next one is used when a call fails or returns invalid JSON:

| Provider | Setup | Default model |
|---|---|---|
| [Google Gemini](https://aistudio.google.com/apikey) (free tier) | `GEMINI_API_KEY` | `gemini-3.6-flash` (`GEMINI_MODEL`) |
| [Groq](https://console.groq.com/keys) (free tier) | `GROQ_API_KEY` | `openai/gpt-oss-120b` (`GROQ_MODEL`) |
| Local [Ollama](https://ollama.com/) | `OLLAMA_URL` (default `http://localhost:11434`) | `qwen3:8b` (`OLLAMA_MODEL`); pull it once with `ollama pull qwen3:8b` |

By default every provider with an API key is tried first, then local Ollama. Set `LLM_PROVIDERS` to choose the order explicitly, e.g. when the server runs somewhere without Ollama:

```
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
LLM_PROVIDERS=gemini,groq
LLM_CONCURRENCY=2
```

Gemini and Groq are called through their OpenAI-compatible APIs. Rate-limited (429) and server-error responses are retried up to `LLM_MAX_RETRIES` times (default 2), honouring the provider's suggested delay; a delay above `LLM_MAX_RETRY_WAIT_MS` (default 30 s, usually a spent daily quota) moves straight to the next provider. Both default models think before answering; `GEMINI_REASONING_EFFORT` / `GROQ_REASONING_EFFORT` default to `low` (set empty for non-reasoning models). Cloud calls time out after `LLM_TIMEOUT_MS` (default 60 s) and fall back. The Gemini free tier allows only about 20 requests per day per model and is often congested (slow answers or `503 high demand`), while Groq's free tier answers an insights request in seconds within a much larger daily allowance; set `LLM_PROVIDERS=groq,gemini` to prefer Groq. Gemini free-tier prompts may be used by Google to improve its models.

For the Qualitative analysis, each year's MD&A summary is stored on disk under `server/.cache/mdna` (override with `MDNA_CACHE_DIR`), so only the first analysis of a ticker downloads reports and summarises them. Cached results are keyed on the first provider's model, so changing it re-runs the analysis. The proxy sends up to `LLM_CONCURRENCY` (default 4; `OLLAMA_CONCURRENCY` is still accepted) requests at once. Use 1–2 for free cloud tiers; for Ollama, set `OLLAMA_NUM_PARALLEL` on the Ollama server to match so they actually run in parallel.

3. Run the server in dev mode (restarts automatically when files in `src/` or `.env` change):

```bash
npm run dev
```

4. Or build and run the compiled version:

```bash
npm run build
npm start
```

5. Run backend tests:

```bash
npm test
```

The server starts on `http://localhost:3000` by default. Run it alongside `npm start` in the project root (Angular dev server) when you need live stock data in the UI.

### Manual stock-data UAT

Open `http://localhost:4200/stock` while the Angular app and backend are running. Fundamentals, the Quantitative analysis and MD&A insights (plus the Qualitative and SWOT analyses when enabled) share this one page; `?q=TICKER` deep-links a stock. Then verify:

1. Search a populated NSE symbol such as `RELIANCE`; confirm five blocks appear in order (Business overview, Financials, Management & annual report, Valuation, Decision summary), each open with a Collapse button, and that the sticky contents bar scrolls to each block. Confirm the NSE quote, metrics, company context, red flags, peers, and the Quantitative score with Fair value appear, and that no analyst consensus or news is shown.
2. Search a company with missing optional provider data; confirm available sections remain visible and missing sections/cells show empty states rather than errors.
3. Search an unknown NSE symbol; confirm the app shows “Ticker not found”.
4. Set `STOCK_DATA_PROVIDER=indianapi` and use an invalid IndianAPI key while an FMP key is configured; confirm the app shows an upstream error without FMP data.
5. Set `STOCK_DATA_PROVIDER=fmp` with a valid FMP key; confirm FMP metrics appear and IndianAPI-only sections remain empty.
6. Search `TCS`; confirm MD&A insights load automatically with the report year, a Moat rating and the five lists, and that a repeat search shows them as cached. With no LLM key or quota left, confirm the panel explains the outage and offers a retry.
7. Confirm the Qualitative and SWOT panels are hidden by default and appear after setting `ENABLE_QUALITATIVE=true` / `ENABLE_SWOT=true` and reloading the page.

## Notes
- This app uses mock data for demonstration. Replace with real financial data as needed.


## Contributions
PRs welcome. If you'd like help wiring live financial data (e.g., company revenues, shares outstanding) I can add connectors to financial APIs.