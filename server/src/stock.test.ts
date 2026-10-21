import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, test } from 'node:test';
import { createStockRouter } from './routes/stock.js';

const servers: Server[] = [];

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
    if (url.pathname === '/static/all_stocks.json') {
      return new Response(JSON.stringify([
        { 'nse-code': 'ACME', name: 'Acme Industries' },
      ]));
    }
    assert.equal(url.pathname, '/stock');
    return new Response(JSON.stringify({
      companyName: 'Acme Industries',
      industry: 'Manufacturing',
      companyProfile: { companyDescription: 'Makes useful things.' },
      currentPrice: { NSE: '321.5', BSE: '999' },
      yearHigh: '350',
      yearLow: 250,
      keyMetrics: {
        marketCap: '125000000',
        stockPE: '18.5',
        bookValue: 42,
        dividendYield: 1.2,
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

test('returns not found when the exact NSE exchange code is absent', async () => {
  let stockLookupRequested = false;
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/static/all_stocks.json') {
        return new Response(JSON.stringify([
          { 'nse-code': 'ACMEOLD', name: 'Acme Industries' },
        ]));
      }
      stockLookupRequested = true;
      return new Response('{}');
    },
  });

  const response = await requestStock(router, 'NOTFOUND');

  assert.equal(response.status, 404);
  assert.equal(stockLookupRequested, false);
});

test('rejects a stock response whose company identity does not match the resolved NSE ticker', async () => {
  const router = createStockRouter({
    provider: 'indianapi',
    indianApiKey: 'test-key',
    fetcher: async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/static/all_stocks.json'
        ? new Response(JSON.stringify([{ 'nse-code': 'MISMATCH', name: 'Expected Company' }]))
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
      if (url.pathname === '/static/all_stocks.json') {
        return new Response(JSON.stringify([{ 'nse-code': 'NOPRICE', name: 'No Price Ltd' }]));
      }
      return new Response(JSON.stringify({
        companyName: 'No Price Ltd',
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
      return url.pathname === '/static/all_stocks.json'
        ? new Response(JSON.stringify([{ 'nse-code': 'FAIL', name: 'Fail Ltd' }]))
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
      if (url.pathname === '/static/all_stocks.json') {
        return new Response(JSON.stringify([{ 'nse-code': 'DETAILS', name: 'Details Ltd' }]));
      }
      return new Response(JSON.stringify({
        companyName: 'Details Ltd',
        industry: 'Technology',
        companyProfile: {
          companyDescription: longDescription,
          peerCompanyList: [
            { companyName: 'Small', marketCap: 10 },
            { companyName: 'Largest', marketCap: 500, price: 20, returnOnEquityTTM: 12.5 },
            { companyName: 'No Cap First' },
            { companyName: 'Middle', marketCap: 100, priceToEarningsValueRatio: 8 },
            { companyName: 'No Cap Second' },
            { companyName: 'Second Largest', marketCap: 200 },
          ],
        },
        currentPrice: { NSE: 75, BSE: 999 },
        yearHigh: 90,
        yearLow: 50,
        keyMetrics: { marketCap: 1234, priceToEarningsValueRatio: 15 },
        financials: {
          incomeStatement: [
            { fiscalYear: 2025, ebit: 1500 },
            { fiscalYear: 2024, netIncome: 100, ebit: 150 },
          ],
          balanceSheet: [
            { fiscalYear: 2025, totalAssets: 100, totalCurrentLiabilities: 10, totalStockholdersEquity: 50 },
            { fiscalYear: 2024, totalAssets: 1000, totalCurrentLiabilities: 250, totalStockholdersEquity: 500 },
          ],
        },
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
        analystView: { overallRecommendation: 'Buy' },
        recosBar: { buy: 4, hold: 2, sell: 1 },
      }));
    },
  });

  const response = await requestStock(router, 'DETAILS');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.marketCap, 1234);
  assert.equal(body.currentPrice, 75);
  assert.equal(body.peRatio, 15);
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
  assert.deepEqual(body.analystConsensus.counts, {
    strongBuy: null, buy: 4, hold: 2, sell: 1, strongSell: null,
  });
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
