import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, test } from 'node:test';
import { createAnalysisRouter } from './routes/analysis.js';
import { computeFairValue, deriveDefaults, YearFinancials } from './dcf.js';
import { Insights } from './insights.js';
import { LlmError } from './llm.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function requestAnalysis(router: express.Router, ticker: string, path = 'quantitative'): Promise<Response> {
  const app = express();
  app.use('/api/analysis', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/api/analysis/${encodeURIComponent(ticker)}/${path}`);
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

// The DCF history the router derives from indianApiStock (latest 5 annual periods)
const indianApiHistory: YearFinancials[] = [
  [2026, 1300, 260], [2025, 1200, 230], [2024, 1100, 200], [2023, 1000, 180], [2022, 900, 150],
].map(([year, revenue, netIncome]) => ({ year, revenue, netIncome, capex: revenue * 0.05, nonCashExpense: revenue * 0.02 }));

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

  const response = await requestAnalysis(router, 'quantind.ns');
  const body = await response.json();

  const defaults = deriveDefaults(indianApiHistory)!;
  assert.equal(response.status, 200);
  assert.equal(body.price, 120.5);
  assert.deepEqual(body.ratios, { pe: 18.2, pb: 3.1, roe: 0.25 });
  assert.deepEqual(body.defaults, defaults);
  assert.equal(body.fairValue, computeFairValue(indianApiHistory, defaults, 100));
  assert.deepEqual(body.scenarios.base, { ...defaults, fairValuePerShare: body.fairValue });
  assert.equal(body.scenarios.grid.values.length, 5);
  assert.equal(typeof body.scenarios.impliedGrowth, 'number');
  assert.equal(requests.length, 2);
});

test('reverse DCF solves the growth the price implies, using discount and terminal overrides', async () => {
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      failOnFmp(url);
      return new Response(url.pathname === '/industry_search' ? '[]' : JSON.stringify(indianApiStock('REVDCF')));
    },
  });

  const response = await requestAnalysis(router, 'REVDCF', 'reverse-dcf?discount=10&terminal=4');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.price, 120.5);
  assert.deepEqual(body.assumptions, { discountRate: 10, terminalGrowthRate: 4 });
  // 900 → 1300 over 4 years
  assert.equal(body.historicalCagr, 9.63);
  const atImplied = computeFairValue(indianApiHistory, { growthRate: body.impliedGrowth, discountRate: 10, terminalGrowthRate: 4 }, 100)!;
  assert.ok(Math.abs(atImplied - 120.5) < 0.1, `Fair value at Implied growth was ${atImplied}`);
});

const indianApiRouter = (stock: object) =>
  createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      failOnFmp(url);
      return new Response(url.pathname === '/industry_search' ? '[]' : JSON.stringify(stock));
    },
  });

test('reverse DCF rejects invalid overrides and ignores a growth override', async () => {
  const router = indianApiRouter(indianApiStock('REVBAD'));
  assert.equal((await requestAnalysis(router, 'REVBAD', 'reverse-dcf?discount=abc')).status, 400);
  assert.equal((await requestAnalysis(router, 'REVBAD', 'reverse-dcf?discount=4&terminal=4')).status, 400);
  const withGrowth = await (await requestAnalysis(router, 'REVBAD', 'reverse-dcf?discount=10&terminal=4&growth=99')).json();
  const withoutGrowth = await (await requestAnalysis(router, 'REVBAD', 'reverse-dcf?discount=10&terminal=4')).json();
  assert.equal(withGrowth.impliedGrowth, withoutGrowth.impliedGrowth);
});

test('reverse DCF is unavailable with fewer than two years of history', async () => {
  const stock = indianApiStock('REVSHORT');
  stock.financials = stock.financials.slice(0, 2); // interim + one annual period
  const response = await requestAnalysis(indianApiRouter(stock), 'REVSHORT', 'reverse-dcf');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'unavailable');
  assert.match(body.message, /Not enough historical financials/);
  assert.equal(body.assumptions, null);
  assert.equal(body.impliedGrowth, null);
});

test('red flags: scans IndianAPI cash flow, balance sheet and promoter holding', async () => {
  const period = (year: number, cfo: string, debt: string) => {
    const base = annualPeriod(year, 1000, 100, 100);
    const map = base.stockFinancialMap;
    return {
      ...base,
      stockFinancialMap: {
        ...map,
        CAS: [...map.CAS, ...keyed({ CashfromOperatingActivities: cfo })],
        BAL: [...map.BAL, ...keyed({ TotalDebt: debt, TotalReceivablesNet: '200' })],
      },
    };
  };
  const stock = {
    ...indianApiStock('REDFLAG'),
    financials: [period(2026, '10', '900'), period(2025, '49', '500'), period(2024, '120', '480')],
    shareholding: [
      {
        displayName: 'Promoter',
        categories: [{ holdingDate: '2025-09-30', percentage: '50.10' }, { holdingDate: '2026-06-30', percentage: '49.00' }],
      },
      { displayName: 'FII', categories: [{ holdingDate: '2026-06-30', percentage: '20.00' }] },
    ],
  };

  const response = await requestAnalysis(indianApiRouter(stock), 'REDFLAG', 'red-flags');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ticker, 'REDFLAG');
  assert.equal(body.status, 'ok');
  // Equity is 4 × net income = 400, so debt / equity is 2.25.
  assert.deepEqual(body.flags.map((f: { id: string }) => f.id), [
    'profit-not-backed-by-cash',
    'cash-conversion-drop',
    'debt-outpacing-revenue',
    'high-leverage',
  ]);
  assert.equal(body.flags[0].evidence, 'OCF/NI 0.49, 0.10 (FY25, FY26)');
  assert.deepEqual(body.skipped, [
    { id: 'promoter-stake-falling', reason: 'data source provides less than 2 years of promoter holding' },
    { id: 'promoter-pledging', reason: 'not provided by data source' },
  ]);
});

test('red flags are unavailable without annual financials', async () => {
  const stock = { ...indianApiStock('REDNONE'), financials: [] };
  const response = await requestAnalysis(indianApiRouter(stock), 'REDNONE', 'red-flags');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'unavailable');
  assert.deepEqual(body.flags, []);
  assert.match(body.message, /No annual financials/);
});

test('statements: the latest 5 IndianAPI fiscal years, oldest first, in crores', async () => {
  const response = await requestAnalysis(indianApiRouter(indianApiStock('STMT')), 'STMT', 'statements');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ticker, 'STMT');
  assert.deepEqual(body.years.map((y: { year: number }) => y.year), [2022, 2023, 2024, 2025, 2026]);
  // EBITDA is operating income (1.5 × net income) plus depreciation (2% of revenue).
  assert.deepEqual(
    { ...body.years[4] },
    {
      year: 2026,
      revenue: 1300,
      ebitda: 416,
      netProfit: 260,
      netMargin: 20,
      totalAssets: 2600,
      borrowings: null,
      equity: 1040,
      debtToEquity: null,
      operatingCashFlow: null,
      capex: 65,
      freeCashFlow: null,
      cashConversion: null,
    }
  );
});

test('statements are empty without annual financials', async () => {
  const stock = { ...indianApiStock('STMTNONE'), financials: [] };
  const response = await requestAnalysis(indianApiRouter(stock), 'STMTNONE', 'statements');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).years, []);
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

  const response = await requestAnalysis(router, 'BANKQUANT');
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

  const unresolved = await requestAnalysis(router, 'NOQUANT');
  assert.equal(unresolved.status, 404);
  assert.deepEqual(await unresolved.json(), { error: 'Ticker not found' });
  assert.equal(requests, 2);

  const bseTicker = await requestAnalysis(router, 'NOQUANT.BO');
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

  const response = await requestAnalysis(router, 'FAILQUANT');

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

    const response = await requestAnalysis(router, 'FMPQUANT.NS');
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

test('statements: FMP amounts are converted from rupees to crores', async () => {
  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  try {
    const router = createAnalysisRouter({
      provider: 'fmp',
      fetcher: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/quote')) {
          return new Response(JSON.stringify([{ price: 50, marketCap: 5e10 }]));
        }
        if (url.pathname.endsWith('/income-statement')) {
          return new Response(JSON.stringify([{ fiscalYear: '2025', revenue: 1e10, netIncome: 1e9, ebitda: 2e9 }]));
        }
        if (url.pathname.endsWith('/cash-flow-statement')) {
          return new Response(JSON.stringify([{ fiscalYear: '2025', capitalExpenditure: -5e8, operatingCashFlow: 1.5e9 }]));
        }
        if (url.pathname.endsWith('/balance-sheet-statement')) {
          return new Response(JSON.stringify([{ fiscalYear: '2025', totalAssets: 3e10, totalDebt: 2e9, totalStockholdersEquity: 1e10 }]));
        }
        return new Response('[]');
      },
    });

    const response = await requestAnalysis(router, 'FMPSTMT.NS', 'statements');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.years, [{
      year: 2025,
      revenue: 1000,
      ebitda: 200,
      netProfit: 100,
      netMargin: 10,
      totalAssets: 3000,
      borrowings: 200,
      equity: 1000,
      debtToEquity: 0.2,
      operatingCashFlow: 150,
      capex: 50,
      freeCashFlow: 100,
      cashConversion: 150,
    }]);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});

async function serve(router: express.Router): Promise<string> {
  const app = express();
  app.use('/api/analysis', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api/analysis`;
}

test('SWOT, the Qualitative analysis and their feature flags are gone', async () => {
  const base = await serve(createAnalysisRouter({ provider: 'indianapi' }));
  assert.equal((await fetch(`${base}/features`)).status, 404);
  for (const path of ['SOME/swot', 'SOME/qualitative']) {
    assert.equal((await fetch(`${base}/${path}`, { method: 'POST' })).status, 404);
  }
});

const insightsReport = [
  'Management Discussion and Analysis',
  ...Array.from({ length: 30 }, (_, i) => `Our revenue grew and we expect new product launch ${i} to expand market share next year.`),
  'Risks and Concerns',
  ...Array.from({ length: 10 }, (_, i) => `Volatile input cost ${i} could pressure our margins.`),
  'Directors Report',
].join('\n');

const sampleInsights: Insights = {
  keyPoints: [{ point: 'Revenue grew', quote: null }],
  growthStrategy: [{ point: 'New launches', quote: null }],
  tailwinds: [],
  headwinds: [],
  risks: [{ point: 'Input costs', quote: null }],
  moat: { rating: 'narrow', reasoning: 'Brand.', quote: null },
  guidance: [],
};

test('insights: analyses the latest report once and serves repeats from cache', async () => {
  process.env.INSIGHTS_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'insights-route-'));
  let listings = 0;
  let judged = 0;
  const base = await serve(createAnalysisRouter({
    provider: 'indianapi',
    insights: {
      listReports: async () => (listings++, [{ year: 2026, source: 'screener', load: async () => Buffer.from('pdf') }]),
      textOf: async () => insightsReport,
      judge: async () => (judged++, sampleInsights),
    },
  }));

  const first = await (await fetch(`${base}/INSIGHTCO/insights`)).json();
  const second = await (await fetch(`${base}/INSIGHTCO/insights`)).json();

  assert.equal(first.status, 'ok');
  assert.equal(first.year, 2026);
  assert.equal(first.source, 'screener');
  assert.equal(first.cached, false);
  assert.equal(first.experimental, true);
  assert.deepEqual(first.insights, sampleInsights);
  assert.equal(second.cached, true);
  assert.deepEqual({ listings, judged }, { listings: 1, judged: 1 });
});

test('insights: missing report is 422 no-reports, LLM failure is 503 and not cached', async () => {
  process.env.INSIGHTS_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'insights-route-'));
  const none = await serve(createAnalysisRouter({ provider: 'indianapi', insights: { listReports: async () => [] } }));
  const missing = await fetch(`${none}/NOREPORT/insights`);
  assert.equal(missing.status, 422);
  assert.equal((await missing.json()).error, 'no-reports');

  let fail = true;
  const flaky = await serve(createAnalysisRouter({
    provider: 'indianapi',
    insights: {
      listReports: async () => [{ year: 2026, source: 'screener', load: async () => Buffer.from('pdf') }],
      textOf: async () => insightsReport,
      judge: async () => {
        if (fail) throw new LlmError('All LLM providers failed');
        return sampleInsights;
      },
    },
  }));
  const down = await fetch(`${flaky}/FLAKY/insights`);
  assert.equal(down.status, 503);
  assert.equal((await down.json()).error, 'llm-unavailable');
  fail = false;
  const recovered = await fetch(`${flaky}/FLAKY/insights`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).cached, false);
});

test('guidance: scores cached claims against actuals, extracts once per report, partial when the LLM is down', async () => {
  process.env.GUIDANCE_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'guidance-route-'));
  const guidanceText = [
    'Management Discussion and Analysis',
    ...Array.from({ length: 30 }, (_, i) => `We expect revenue growth of 10% in FY24 and our outlook ${i} remains strong.`),
    'Directors Report',
  ].join('\n');
  const quote = 'We expect revenue growth of 10% in FY24';
  let extractions = 0;
  let llmDown = false;
  const base = await serve(createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return new Response(url.pathname === '/industry_search' ? '[]' : JSON.stringify(indianApiStock('GUIDECO')));
    },
    guidance: {
      listReports: async () => [2024, 2023].map((year) => ({ year, source: 'screener' as const, load: async () => Buffer.from('pdf') })),
      textOf: async () => guidanceText,
      sharedClaims: async () => undefined,
      extract: async (year) => {
        extractions++;
        if (llmDown && year === 2023) throw new LlmError('quota');
        return [{ metric: 'revenueGrowth', target: { min: 0.1, max: 0.1 }, horizon: year + 1, quote }];
      },
    },
  }));

  const first = await (await fetch(`${base}/GUIDECO/guidance`, { method: 'POST' })).json();
  assert.equal(first.experimental, true);
  assert.equal(first.lowerConfidence, true);
  assert.deepEqual(first.years.map((y: any) => [y.year, y.status, y.claims[0].verdict]), [[2024, 'ok', 'near'], [2023, 'ok', 'met']]);
  assert.equal('hitRate' in first, false);
  assert.equal(extractions, 2);

  llmDown = true;
  const second = await (await fetch(`${base}/GUIDECO/guidance`, { method: 'POST' })).json();
  assert.equal(extractions, 2);
  assert.equal(second.years.length, 2);
});
