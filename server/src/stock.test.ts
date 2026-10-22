import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, test } from 'node:test';
import { createStockRouter } from './routes/stock.js';

const servers: Server[] = [];

function keyed(values: Record<string, unknown>): Array<{ key: string; value: unknown }> {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function financialPeriod(
  fiscalYear: string,
  type: 'Annual' | 'Interim',
  income: Record<string, unknown>,
  balance: Record<string, unknown>
) {
  return {
    FiscalYear: fiscalYear,
    Type: type,
    stockFinancialMap: { INC: keyed(income), BAL: keyed(balance), CAS: [] },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  })));
});

async function requestStock(
  router: express.Router,
  ticker: string
): Promise<Response> {
  const app = express();
  app.use('/api/stock', router);
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/api/stock/${encodeURIComponent(ticker)}`);
}

test('normalizes an NSE ticker and returns IndianAPI stock data with only its NSE quote', async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'test-key');
    if (url.pathname === '/industry_search') {
      return new Response(JSON.stringify([
        { exchangeCodeNsi: 'ACME', commonName: 'Acme Industries' },
      ]));
    }
    assert.equal(url.pathname, '/stock');
    return new Response(JSON.stringify({
      companyName: 'Acme Industries',
      industry: 'Manufacturing',
      companyProfile: { companyDescription: 'Makes useful things.', exchangeCodeNse: 'ACME' },
      currentPrice: { NSE: '321.5', BSE: '999' },
      yearHigh: '350',
      yearLow: 250,
      keyMetrics: {
        persharedata: keyed({ bookValuePerShareMostRecentFiscalYear: '42' }),
      },
      stockDetailsReusableData: {
        marketCap: '125000000',
        pPerEBasicExcludingExtraordinaryItemsTTM: '18.5',
        currentDividendYieldCommonStockPrimaryIssueLTM: '1.2',
      },
      recentNews: [],
      peerCompanyList: [],
    }));
  };
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher,
  });

  const response = await requestStock(router, '  acme ');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('query'), 'ACME');
  assert.equal(requests[1].searchParams.get('name'), 'Acme Industries');
  assert.deepEqual(body, {
    marketCap: 125000000,
    currentPrice: 321.5,
    week52High: 350,
    week52Low: 250,
    peRatio: 18.5,
    bookValue: 42,
    dividendYield: 1.2,
    roce: null,
    roe: null,
    companyIntroduction: {
      name: 'Acme Industries',
      industry: 'Manufacturing',
      description: 'Makes useful things.',
    },
    news: [],
    peers: [],
    analystConsensus: null,
  });

  const cachedResponse = await requestStock(router, 'acme');
  assert.equal(cachedResponse.status, 200);
  assert.deepEqual(await cachedResponse.json(), body);
  assert.equal(requests.length, 2);

  const actualNow = Date.now;
  Date.now = () => actualNow() + 5 * 60 * 1000 + 1;
  try {
    const expiredResponse = await requestStock(router, 'Acme');
    assert.equal(expiredResponse.status, 200);
    assert.deepEqual(await expiredResponse.json(), body);
  } finally {
    Date.now = actualNow;
  }
  assert.equal(requests.length, 4);
});

test('looks the ticker up directly when industry search has no exact NSE match', async () => {
  const stockNames: (string | null)[] = [];
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/industry_search') {
        return new Response('[]');
      }
      stockNames.push(url.searchParams.get('name'));
      return new Response(JSON.stringify({
        companyName: 'Tata Consultancy Services',
        companyProfile: { exchangeCodeNse: 'TCS' },
        currentPrice: { NSE: '2506.90' },
      }));
    },
  });

  const response = await requestStock(router, 'tcs');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(stockNames, ['TCS']);
  assert.equal(body.currentPrice, 2506.9);
  assert.equal(body.companyIntroduction.name, 'Tata Consultancy Services');
});

test('returns not found when the ticker cannot be resolved', async () => {
  const stockNames: (string | null)[] = [];
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/industry_search') {
        return new Response(JSON.stringify([
          { exchangeCodeNsi: 'ACMEOLD', commonName: 'Acme Industries' },
        ]));
      }
      stockNames.push(url.searchParams.get('name'));
      return new Response(JSON.stringify({ error: 'Stock not found' }));
    },
  });

  const response = await requestStock(router, 'NOTFOUND');

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Ticker not found' });
  assert.deepEqual(stockNames, ['NOTFOUND']);
});

test('rejects a direct lookup that returns a different NSE ticker', async () => {
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/industry_search'
        ? new Response('[]')
        : new Response(JSON.stringify({
          companyName: 'ITC Hotels',
          companyProfile: { exchangeCodeNse: 'ITCHOTELS' },
          currentPrice: { NSE: 200 },
        }));
    },
  });

  const response = await requestStock(router, 'ITCH');

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Ticker not found' });
});

test('rejects a stock response whose company identity does not match the resolved NSE ticker', async () => {
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/industry_search'
        ? new Response(JSON.stringify([{ exchangeCodeNsi: 'MISMATCH', commonName: 'Expected Company' }]))
        : new Response(JSON.stringify({
          companyName: 'Different Company',
          currentPrice: { NSE: 150 },
        }));
    },
  });

  const response = await requestStock(router, 'MISMATCH');

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Ticker not found' });
});

test('reports missing NSE price and provider failure as explicit upstream errors without fallback', async () => {
  let requests = 0;
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      requests += 1;
      const url = new URL(String(input));
      if (url.pathname === '/industry_search') {
        return new Response(JSON.stringify([{ exchangeCodeNsi: 'NOPRICE', commonName: 'No Price Ltd' }]));
      }
      return new Response(JSON.stringify({
        companyName: 'No Price Ltd',
        companyProfile: { exchangeCodeNse: 'NOPRICE' },
        currentPrice: { BSE: 150 },
      }));
    },
  });

  const missingPriceResponse = await requestStock(router, 'NOPRICE');
  assert.equal(missingPriceResponse.status, 502);
  assert.deepEqual(await missingPriceResponse.json(), { error: 'Upstream fetch failed' });
  assert.equal(requests, 2);

  const failedRouter = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/industry_search'
        ? new Response(JSON.stringify([{ exchangeCodeNsi: 'FAIL', commonName: 'Fail Ltd' }]))
        : new Response('unavailable', { status: 503 });
    },
  });
  const failedResponse = await requestStock(failedRouter, 'FAIL');
  assert.equal(failedResponse.status, 502);
  assert.deepEqual(await failedResponse.json(), { error: 'Upstream fetch failed' });
});

test('normalizes recent news, ranked peers and aligned annual returns into the stock response', async () => {
  const longDescription = 'a'.repeat(600);
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/industry_search') {
        return new Response(JSON.stringify([{ exchangeCodeNsi: 'DETAILS', commonName: 'Details Ltd' }]));
      }
      return new Response(JSON.stringify({
        companyName: 'Details Ltd',
        industry: 'Technology',
        companyProfile: {
          companyDescription: longDescription,
          exchangeCodeNse: 'DETAILS',
          peerCompanyList: [
            { companyName: 'Small', marketCap: 10 },
            {
              companyName: 'Largest',
              marketCap: 500,
              price: 20,
              returnOnAverageEquityTrailing12Month: 12.5,
              returnOnAverageEquity5YearAverage: 30,
              netProfitMargin5YearAverage: 9,
              dividendYieldIndicatedAnnualDividend: 1.75,
            },
            { companyName: 'No Cap First' },
            { companyName: 'Middle', marketCap: 100, priceToEarningsValueRatio: 8 },
            { companyName: 'No Cap Second' },
            { companyName: 'Second Largest', marketCap: 200 },
          ],
        },
        currentPrice: { NSE: 75, BSE: 999 },
        yearHigh: 90,
        yearLow: 50,
        keyMetrics: {
          valuation: keyed({
            pPerEBasicExcludingExtraordinaryItemsTTM: '15',
            currentDividendYieldCommonStockPrimaryIssueLTM: '2.5',
          }),
          persharedata: keyed({ bookValuePerShareMostRecentFiscalYear: '54.46' }),
        },
        stockDetailsReusableData: {
          marketCap: '1234',
          pPerEBasicExcludingExtraordinaryItemsTTM: '',
          currentDividendYieldCommonStockPrimaryIssueLTM: '-',
          averageRating: 'Hold',
        },
        financials: [
          financialPeriod(
            '2026',
            'Interim',
            { OperatingIncome: 999, NetIncome: 999 },
            { TotalAssets: 2000, TotalCurrentLiabilities: 100, TotalEquity: 900 }
          ),
          financialPeriod(
            '2025',
            'Annual',
            {},
            { TotalAssets: 100, TotalCurrentLiabilities: 10, TotalEquity: 50 }
          ),
          financialPeriod(
            '2024',
            'Annual',
            { OperatingIncome: '150', NetIncome: '100' },
            { TotalAssets: '1000', TotalCurrentLiabilities: '250', TotalEquity: '500' }
          ),
        ],
        recentNews: [
          { headline: 'Old', pub_date: '2026-10-01T10:00:00Z', url: '/news/old' },
          { headline: 'Newest', pub_date: '2026-10-20T10:00:00Z', url: '/news/newest' },
          { headline: 'Bad link', pub_date: '2026-10-19T10:00:00Z', url: 'javascript:alert(1)' },
          { headline: 'Second newest', pub_date: '2026-10-18T10:00:00Z', url: 'https://news.example/article' },
          { headline: 'Third newest', pub_date: '2026-10-17T10:00:00Z', url: '/news/third' },
          { headline: 'Fourth newest', pub_date: '2026-10-16T10:00:00Z', url: '/news/fourth' },
          { headline: 'Fifth newest', pub_date: '2026-10-15T10:00:00Z', url: '/news/fifth' },
          { headline: 'Sixth newest', pub_date: '2026-10-14T10:00:00Z', url: '/news/sixth' },
        ],
        analystView: [
          { ratingName: 'Strong Buy', numberOfAnalystsLatest: '6' },
          { ratingName: 'Strong Sell', numberOfAnalystsLatest: '0.00' },
          { ratingName: 'Total', numberOfAnalystsLatest: '34' },
        ],
        recosBar: {
          tickerRatingValue: 2,
          isDataPresent: true,
          stockAnalyst: [
            { ratingName: 'Sell', ratingValue: 4, numberOfAnalysts: 2 },
            { ratingName: 'Hold', ratingValue: 3, numberOfAnalysts: 13 },
            { ratingName: 'Buy', ratingValue: 2, numberOfAnalysts: 13 },
          ],
        },
      }));
    },
  });

  const response = await requestStock(router, 'DETAILS');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.marketCap, 1234);
  assert.equal(body.currentPrice, 75);
  assert.equal(body.peRatio, 15);
  assert.equal(body.bookValue, 54.46);
  assert.equal(body.dividendYield, 2.5);
  assert.equal(body.roce, 20);
  assert.equal(body.roe, 20);
  assert.equal(body.companyIntroduction.description.length, 500);
  assert.equal(body.news.length, 5);
  assert.deepEqual(body.news.map((article: { headline: string }) => article.headline), [
    'Newest', 'Second newest', 'Third newest', 'Fourth newest', 'Fifth newest',
  ]);
  assert.equal(body.news[0].url, 'https://www.livemint.com/news/newest');
  assert.equal(body.news[0].source, null);
  assert.deepEqual(body.peers.map((peer: { name: string }) => peer.name), [
    'Largest', 'Second Largest', 'Middle', 'Small', 'No Cap First',
  ]);
  assert.equal(body.peers[0].roe, 12.5);
  assert.equal(body.peers[0].profitMargin, null);
  assert.equal(body.peers[0].dividendYield, 1.75);
  assert.deepEqual(body.analystConsensus, {
    source: 'IndianAPI',
    recommendation: 'Buy',
    counts: { strongBuy: 6, buy: 13, hold: 13, sell: 2, strongSell: 0 },
  });
});

test('calculates ROCE when the aligned annual data lacks the separate ROE inputs', async () => {
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/industry_search') {
        return new Response(JSON.stringify([{ exchangeCodeNsi: 'INDEPENDENT', commonName: 'Independent Ltd' }]));
      }
      return new Response(JSON.stringify({
        companyName: 'Independent Ltd',
        companyProfile: { exchangeCodeNse: 'INDEPENDENT' },
        currentPrice: { NSE: 50 },
        financials: [
          financialPeriod(
            '2025',
            'Annual',
            { OperatingIncome: 200, NetIncome: null },
            { TotalAssets: 1000, TotalCurrentLiabilities: 200, TotalEquity: 500 }
          ),
        ],
      }));
    },
  });

  const response = await requestStock(router, 'INDEPENDENT');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.roce, 25);
  assert.equal(body.roe, null);
});

test('uses FMP only when explicitly selected and leaves IndianAPI sections empty', async () => {
  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  const fmpRequests: URL[] = [];
  try {
    const router = createStockRouter({
      provider: 'fmp',
      fetcher: async (input) => {
        const url = new URL(String(input));
        fmpRequests.push(url);
        if (url.pathname.endsWith('/quote')) {
          return new Response(JSON.stringify([{
            symbol: 'ACME.NS',
            price: 100,
            marketCap: 500,
            yearHigh: 120,
            yearLow: 80,
            pe: 9,
          }]));
        }
        if (url.pathname.endsWith('/ratios-ttm')) {
          return new Response(JSON.stringify([{
            priceToEarningsRatioTTM: 8,
            bookValuePerShareTTM: 12,
            dividendYieldTTM: 2,
          }]));
        }
        if (url.pathname.endsWith('/income-statement')) {
          return new Response(JSON.stringify([
            { calendarYear: '2024', ebit: 150, netIncome: 100 },
          ]));
        }
        return new Response(JSON.stringify([
          { calendarYear: '2024', totalAssets: 1000, totalCurrentLiabilities: 250, totalStockholdersEquity: 500 },
        ]));
      },
    });

    const response = await requestStock(router, 'ACME');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.currentPrice, 100);
    assert.equal(body.roce, 20);
    assert.equal(body.roe, 20);
    assert.equal(body.companyIntroduction, null);
    assert.deepEqual(body.news, []);
    assert.deepEqual(body.peers, []);
    assert.equal(body.analystConsensus, null);
    assert.equal(fmpRequests.length, 4);
    assert.ok(fmpRequests.every((url) => url.searchParams.get('symbol') === 'ACME.NS'));
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});

test('returns an upstream error when the explicitly selected FMP quote has no current price', async () => {
  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  let requests = 0;
  try {
    const router = createStockRouter({
      provider: 'fmp',
      fetcher: async () => {
        requests += 1;
        return new Response(JSON.stringify([{
          symbol: 'NOPRICE.NS',
          price: null,
          marketCap: 200,
        }]));
      },
    });

    const response = await requestStock(router, 'NOPRICE');

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Upstream fetch failed' });
    assert.equal(requests, 1);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});

test('does not query FMP with a non-NSE exchange suffix', async () => {
  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  let requests = 0;
  try {
    const router = createStockRouter({
      provider: 'fmp',
      fetcher: async () => {
        requests += 1;
        return new Response('[]');
      },
    });

    const response = await requestStock(router, 'ACME.BO');

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Ticker not found' });
    assert.equal(requests, 0);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});

test('rejects zero and negative prices as unusable NSE quotes', async () => {
  const indianRouter = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/industry_search'
        ? new Response(JSON.stringify([{ exchangeCodeNsi: 'ZERO', commonName: 'Zero Ltd' }]))
        : new Response(JSON.stringify({
          companyName: 'Zero Ltd',
          companyProfile: { exchangeCodeNse: 'ZERO' },
          currentPrice: { NSE: 0 },
        }));
    },
  });
  const indianResponse = await requestStock(indianRouter, 'ZERO');
  assert.equal(indianResponse.status, 502);

  const previousApiKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEY = 'test-key';
  try {
    const fmpRouter = createStockRouter({
      provider: 'fmp',
      fetcher: async () => new Response(JSON.stringify([{
        symbol: 'NEGATIVE.NS',
        price: -1,
        marketCap: 100,
      }])),
    });
    const fmpResponse = await requestStock(fmpRouter, 'NEGATIVE');
    assert.equal(fmpResponse.status, 502);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.FMP_API_KEY;
    } else {
      process.env.FMP_API_KEY = previousApiKey;
    }
  }
});
