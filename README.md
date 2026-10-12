# DCF Valuation App


An interactive Angular application to estimate the intrinsic value of a stock using Discounted Cash Flow (DCF). Features:


- Modern Angular + TypeScript
- Responsive UI styled with Angular Material
- Editable projection table (revenue growth %, profit margin %, FCF %)
- CSV and Excel (XLSX) export
- Printable report
- Unit tests (Jasmine + Karma)


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

The `server/` directory contains a standalone Express + TypeScript proxy that fetches live financial data from [Financial Modeling Prep](https://financialmodelingprep.com/) (FMP). It runs independently of the Angular app on port 3000.

1. Install backend dependencies:

```bash
cd server
npm install
```

2. Configure your FMP API key:

```bash
cp .env.example .env  # if present, otherwise create server/.env
```

Add to `server/.env`:

```
FMP_API_KEY=your_financial_modeling_prep_api_key
```

Get a free API key at https://site.financialmodelingprep.com/.

3. Run the server in dev mode (auto-reload on changes):

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

## Notes
- This app uses mock data for demonstration. Replace with real financial data as needed.


## Contributions
PRs welcome. If you'd like help wiring live financial data (e.g., company revenues, shares outstanding) I can add connectors to financial APIs.