import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, test } from 'node:test';
import { createMarketRouter, marketDescriptor } from './market.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())))));
});

test('indianapi provider serves the India edition in rupees and crore', () => {
  assert.deepEqual(marketDescriptor('indianapi'), {
    edition: 'india',
    currencySymbol: '₹',
    locale: 'en-IN',
    statementDivisor: 1,
    unitLabel: '₹ crore',
    unitSuffix: ' cr',
    marketCapNotation: 'standard',
    marketCapSuffix: ' Cr',
    tickerLabel: 'NSE',
    exampleTickers: ['TCS', 'RELIANCE', 'INFY', 'ITC', 'HDFCBANK'],
  });
});

test('fmp provider serves the US edition in dollars and millions', () => {
  assert.deepEqual(marketDescriptor('fmp'), {
    edition: 'us',
    currencySymbol: '$',
    locale: 'en-US',
    statementDivisor: 1e6,
    unitLabel: '$ millions',
    unitSuffix: 'M',
    marketCapNotation: 'compact',
    marketCapSuffix: '',
    tickerLabel: 'US',
    exampleTickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'],
  });
});

test('GET /api/market returns the configured edition', async () => {
  const app = express();
  app.use('/api/market', createMarketRouter('fmp'));
  const server = createServer(app);
  servers.push(server);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const body = await (await fetch(`http://127.0.0.1:${port}/api/market`)).json();
  assert.equal(body.edition, 'us');
  assert.equal(body.currencySymbol, '$');
});
