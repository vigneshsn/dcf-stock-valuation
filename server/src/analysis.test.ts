import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, test } from 'node:test';
import { createAnalysisRouter } from './routes/analysis.js';
import { computeFairValue, deriveDefaults, YearFinancials } from './dcf.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function requestQuantitative(router: express.Router, ticker: string): Promise<Response> {
  const app = express();
  app.use('/api/analysis', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/api/analysis/${encodeURIComponent(ticker)}/quantitative`);
}

function keyed(values: Record<string, unknown>): Array<{ key: string; value: unknown }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function annualPeriod(year: number, revenue: number, netIncome: number, shares: number) {
  return {
    FiscalYear: String(year),
    Type: 'Annual',
    stockFinancialMap: {
      INC: keyed({ TotalRevenue: String(revenue), NetIncome: String(netIncome), OperatingIncome: String(netIncome * 1.5) }),
      CAS: keyed({ CapitalExpenditures: String(-revenue * 0.05), 'Depreciation/Depletion': String(revenue * 0.02) }),
      BAL: keyed({
        TotalAssets: String(revenue * 2),
        TotalCurrentLiabilities: String(revenue * 0.5),
        TotalEquity: String(netIncome * 4),
        TotalCommonSharesOutstanding: String(shares),
      }),
    },
  };
}

function indianApiStock(ticker: string) {
  return {
    companyName: `${ticker} Ltd`,
    companyProfile: { exchangeCodeNse: ticker },
    currentPrice: { NSE: '120.5', BSE: '999' },
    stockDetailsReusableData: { pPerEBasicExcludingExtraordinaryItemsTTM: '18.2' },
    keyMetrics: { valuation: keyed({ priceToBookMostRecentFiscalYear: '3.1' }) },
    financials: [
      { FiscalYear: '2027', Type: 'Interim', stockFinancialMap: { INC: keyed({ TotalRevenue: '9999', NetIncome: '9999' }) } },
      annualPeriod(2026, 1300, 260, 100),
      annualPeriod(2025, 1200, 230, 99),
      annualPeriod(2024, 1100, 200, 98),
      annualPeriod(2023, 1000, 180, 97),
      annualPeriod(2022, 900, 150, 96),
      annualPeriod(2021, 800, 120, 95),
    ],
  };
}

const failOnFmp = (url: URL) => {
  assert.notEqual(url.hostname, 'financialmodelingprep.com', `unexpected FMP request: ${url}`);
};

test('runs the quantitative DCF on IndianAPI data when IndianAPI is the configured provider', async () => {
  const requests: URL[] = [];
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      failOnFmp(url);
      if (url.pathname === '/industry_search') {
        return new Response('[]');
      }
      assert.equal(url.searchParams.get('name'), 'QUANTIND');
      return new Response(JSON.stringify(indianApiStock('QUANTIND')));
    },
  });

  const response = await requestQuantitative(router, 'quantind.ns');
  const body = await response.json();

  const expectedHistory: YearFinancials[] = [
    [2026, 1300, 260], [2025, 1200, 230], [2024, 1100, 200], [2023, 1000, 180], [2022, 900, 150],
  ].map(([year, revenue, netIncome]) => ({
    year,
    revenue,
    netIncome,
    capex: revenue * 0.05,
    nonCashExpense: revenue * 0.02,
  }));
  const defaults = deriveDefaults(expectedHistory)!;
  assert.equal(response.status, 200);
  assert.equal(body.price, 120.5);
  assert.deepEqual(body.ratios, { pe: 18.2, pb: 3.1, roe: 0.25 });
  assert.deepEqual(body.defaults, defaults);
  assert.equal(body.fairValue, computeFairValue(expectedHistory, defaults, 100));
  assert.equal(requests.length, 2);
});

test('derives bank revenue from interest and non-interest income', async () => {
  const bankPeriod = (year: number, interest: number) => ({
    FiscalYear: String(year),
    Type: 'Annual',
    stockFinancialMap: {
      INC: keyed({ InterestIncomeBank: String(interest), 'Non-InterestIncomeBank': '100', NetIncome: '150' }),
      CAS: keyed({ CapitalExpenditures: '-10', 'Depreciation/Depletion': '5' }),
      BAL: keyed({ TotalEquity: '1000', TotalCommonSharesOutstanding: '50' }),
    },
  });
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      failOnFmp(url);
      return url.pathname === '/industry_search'
        ? new Response('[]')
        : new Response(JSON.stringify({
          ...indianApiStock('BANKQUANT'),
          financials: [bankPeriod(2026, 1000), bankPeriod(2025, 900)],
        }));
    },
  });

  const response = await requestQuantitative(router, 'BANKQUANT');
  const body = await response.json();

  const history: YearFinancials[] = [
    { year: 2026, revenue: 1100, netIncome: 150, capex: 10, nonCashExpense: 5 },
    { year: 2025, revenue: 1000, netIncome: 150, capex: 10, nonCashExpense: 5 },
  ];
  assert.equal(response.status, 200);
  assert.equal(body.fairValue, computeFairValue(history, deriveDefaults(history)!, 50));
});

test('returns not found for unresolved or non-NSE tickers with IndianAPI configured', async () => {
  let requests = 0;
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      requests += 1;
      const url = new URL(String(input));
      failOnFmp(url);
      return url.pathname === '/industry_search'
        ? new Response('[]')
        : new Response(JSON.stringify({ error: 'Stock not found' }));
    },
  });

  const unresolved = await requestQuantitative(router, 'NOQUANT');
  assert.equal(unresolved.status, 404);
  assert.deepEqual(await unresolved.json(), { error: 'Ticker not found' });
  assert.equal(requests, 2);

  const bseTicker = await requestQuantitative(router, 'NOQUANT.BO');
  assert.equal(bseTicker.status, 404);
  assert.equal(requests, 2);
});

test('reports IndianAPI failures as upstream errors without falling back to FMP', async () => {
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      failOnFmp(new URL(String(input)));
      return new Response('unavailable', { status: 503 });
    },
  });

  const response = await requestQuantitative(router, 'FAILQUANT');

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Upstream fetch failed' });
});

test('runs the quantitative DCF on FMP data when FMP is the configured provider', async () => {
  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  const paths: string[] = [];
  try {
    const router = createAnalysisRouter({
      provider: 'fmp',
      fetcher: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.hostname, 'financialmodelingprep.com');
        assert.equal(url.searchParams.get('symbol'), 'FMPQUANT.NS');
        paths.push(url.pathname);
        if (url.pathname.endsWith('/quote')) {
          return new Response(JSON.stringify([{ price: 50, marketCap: 5000, pe: 12 }]));
        }
        if (url.pathname.endsWith('/income-statement')) {
          return new Response(JSON.stringify([
            { fiscalYear: '2025', revenue: 1200, netIncome: 200 },
            { fiscalYear: '2024', revenue: 1000, netIncome: 150 },
          ]));
        }
        if (url.pathname.endsWith('/cash-flow-statement')) {
          return new Response(JSON.stringify([
            { fiscalYear: '2025', capitalExpenditure: -60, depreciationAndAmortization: 30 },
            { fiscalYear: '2024', capitalExpenditure: -50, depreciationAndAmortization: 25 },
          ]));
        }
        if (url.pathname.endsWith('/balance-sheet-statement')) {
          return new Response(JSON.stringify([{ totalStockholdersEquity: 1000 }]));
        }
        return new Response(JSON.stringify([{ priceToEarningsRatioTTM: 11, priceToBookRatioTTM: 2 }]));
      },
    });

    const response = await requestQuantitative(router, 'FMPQUANT.NS');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.price, 50);
    assert.deepEqual(body.ratios, { pe: 11, pb: 2, roe: 0.2 });
    assert.ok(body.fairValue > 0);
    assert.ok(paths.some((path) => path.endsWith('/quote')));
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});
