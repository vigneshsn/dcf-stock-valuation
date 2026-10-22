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

The qualitative analysis calls a local [Ollama](https://ollama.com/) server (`OLLAMA_URL`, default `http://localhost:11434`). The default model is `qwen3:8b`; pull it once with `ollama pull qwen3:8b`, or set `OLLAMA_MODEL` to use a different local model.

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

Open `http://localhost:4200/fundamentals` while the Angular app and backend are running, then verify:

1. Search a populated NSE symbol such as `RELIANCE`; confirm the NSE quote, metrics, company context, recent news, peers, and analyst consensus appear.
2. Search a company with missing optional provider data; confirm available sections remain visible and missing sections/cells show empty states rather than errors.
3. Search an unknown NSE symbol; confirm the app shows “Ticker not found”.
4. Set `STOCK_DATA_PROVIDER=indianapi` and use an invalid IndianAPI key while an FMP key is configured; confirm the app shows an upstream error without FMP data.
5. Set `STOCK_DATA_PROVIDER=fmp` with a valid FMP key; confirm FMP metrics appear and IndianAPI-only sections remain empty.

## Notes
- This app uses mock data for demonstration. Replace with real financial data as needed.


## Contributions
PRs welcome. If you'd like help wiring live financial data (e.g., company revenues, shares outstanding) I can add connectors to financial APIs.