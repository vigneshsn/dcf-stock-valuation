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

test('SWOT returns financials strengths when no annual report is available', async () => {
  process.env.SWOT_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'swot-route-'));
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      failOnFmp(url);
      return url.pathname === '/industry_search' ? new Response('[]') : new Response(JSON.stringify(indianApiStock('SWOTIND')));
    },
    swot: { listReports: async () => [] },
    features: { swot: true },
  });
  const app = express();
  app.use('/api/analysis', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/analysis/SWOTIND/swot`, { method: 'POST' });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.report.status, 'no-reports');
  assert.deepEqual(body.financials, { status: 'ok', year: 2026, message: null });
  assert.deepEqual(body.strengths.items.map((i: { evidence: string }) => i.evidence), ['ROE: 25.0%', 'ROCE: 20.0%']);
  assert.deepEqual(body.opportunities.items, []);
  assert.equal(body.experimental, true);
});

test('SWOT caches a complete result so a repeat request makes no upstream calls', async () => {
  process.env.SWOT_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'swot-route-'));
  let fetches = 0;
  let listings = 0;
  const router = createAnalysisRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    indianApiBaseUrl: 'https://indianapi.test',
    fetcher: async (input) => {
      const url = new URL(String(input));
      failOnFmp(url);
      fetches++;
      return url.pathname === '/industry_search' ? new Response('[]') : new Response(JSON.stringify(indianApiStock('SWOTCACHE')));
    },
    swot: {
      listReports: async () => (listings++, [{ year: 2026, source: 'screener', load: async () => Buffer.from('pdf') }]),
      textOf: async () => 'A report without any MD&A section.',
    },
    features: { swot: true },
  });
  const app = express();
  app.use('/api/analysis', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const run = async () => (await fetch(`http://127.0.0.1:${address.port}/api/analysis/SWOTCACHE/swot`, { method: 'POST' })).json();

  const first = await run();
  const callsAfterFirst = { fetches, listings };
  const second = await run();

  assert.equal(first.report.status, 'no-mdna');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.report.cached, true);
  assert.deepEqual(second.strengths, first.strengths);
  assert.deepEqual({ fetches, listings }, callsAfterFirst);
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

test('features: SWOT and the Qualitative analysis are off by default, MD&A insights on', async () => {
  const saved = { q: process.env.ENABLE_QUALITATIVE, s: process.env.ENABLE_SWOT };
  delete process.env.ENABLE_QUALITATIVE;
  delete process.env.ENABLE_SWOT;
  try {
    const base = await serve(createAnalysisRouter({ provider: 'indianapi' }));
    assert.deepEqual(await (await fetch(`${base}/features`)).json(), { insights: true, qualitative: false, swot: false });

    for (const [path, flag] of [['SOME/swot', 'ENABLE_SWOT'], ['SOME/qualitative', 'ENABLE_QUALITATIVE']]) {
      const response = await fetch(`${base}/${path}`, { method: 'POST' });
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.error, 'disabled');
      assert.match(body.message, new RegExp(flag));
    }

    process.env.ENABLE_SWOT = 'true';
    assert.equal((await (await fetch(`${base}/features`)).json()).swot, true);
  } finally {
    if (saved.q === undefined) delete process.env.ENABLE_QUALITATIVE;
    else process.env.ENABLE_QUALITATIVE = saved.q;
    if (saved.s === undefined) delete process.env.ENABLE_SWOT;
    else process.env.ENABLE_SWOT = saved.s;
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
