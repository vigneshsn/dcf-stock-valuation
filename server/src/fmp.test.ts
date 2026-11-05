import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FmpError, fmpGet } from './fmp.js';
import { fmpFiscalYear } from './fmp.js';
import { financialStatements } from './statements.js';
import { scoreClaim } from './guidance.js';

function freshCache(env: Record<string, string> = {}) {
  process.env.FMP_CACHE_DIR = mkdtempSync(path.join(tmpdir(), 'fmp-test-'));
  process.env.FMP_API_KEY = 'k';
  process.env.FMP_DAILY_LIMIT = env.FMP_DAILY_LIMIT ?? '240';
  process.env.FMP_QUOTE_TTL_MS = env.FMP_QUOTE_TTL_MS ?? '';
  let calls = 0;
  let status = 200;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify([{ price: calls }]), { status });
  }) as typeof fetch;
  return { fetcher, calls: () => calls, failWith: (s: number) => { status = s; } };
}

test('fmpGet serves repeat requests from the disk cache and shares concurrent fetches', async () => {
  const fmp = freshCache();
  const [a, b] = await Promise.all([fmpGet('/quote', 'AAPL', {}, fmp.fetcher), fmpGet('/quote', 'AAPL', {}, fmp.fetcher)]);
  assert.deepEqual(a, b);
  assert.deepEqual(await fmpGet('/quote', 'AAPL', {}, fmp.fetcher), [{ price: 1 }]);
  assert.equal(fmp.calls(), 1);
});

test('fmpGet falls back to an expired entry when FMP is rate limited, but not for an unknown symbol', async () => {
  const fmp = freshCache({ FMP_QUOTE_TTL_MS: '1' });
  await fmpGet('/quote', 'AAPL', {}, fmp.fetcher);
  await new Promise((r) => setTimeout(r, 5));
  fmp.failWith(429);
  assert.deepEqual(await fmpGet('/quote', 'AAPL', {}, fmp.fetcher), [{ price: 1 }]);
  await assert.rejects(fmpGet('/quote', 'MSFT', {}, fmp.fetcher), (e: FmpError) => e.status === 429);
});

test('fmpGet stops calling FMP at the daily budget and serves stale data instead', async () => {
  const fmp = freshCache({ FMP_DAILY_LIMIT: '1', FMP_QUOTE_TTL_MS: '1' });
  await fmpGet('/quote', 'AAPL', {}, fmp.fetcher);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await fmpGet('/quote', 'AAPL', {}, fmp.fetcher), [{ price: 1 }]);
  await assert.rejects(fmpGet('/quote', 'MSFT', {}, fmp.fetcher), (e: FmpError) => e.status === 429);
  assert.equal(fmp.calls(), 1);
});

test('fmpFiscalYear uses the company fiscal-year label over calendar year and date', () => {
  // AAPL: year ends late September; MSFT: year ends 30 June.
  assert.equal(fmpFiscalYear({ date: '2025-09-27', fiscalYear: '2025', calendarYear: '2025' }), 2025);
  assert.equal(fmpFiscalYear({ date: '2025-06-30', fiscalYear: '2025', calendarYear: '2025' }), 2025);
  // A January year end is labelled with the earlier fiscal year.
  assert.equal(fmpFiscalYear({ date: '2025-01-31', fiscalYear: '2024', calendarYear: '2025' }), 2024);
  assert.equal(fmpFiscalYear({ date: '2024-12-31', calendarYear: '2024' }), 2024);
  assert.equal(fmpFiscalYear({ date: '2023-09-30' }), 2023);
  assert.equal(fmpFiscalYear({}), null);
  assert.equal(fmpFiscalYear({ fiscalYear: 'abc' }), null);
});

test('a FY2025 Guidance horizon lines up with the history row labelled FY2025', () => {
  const history = [
    { fiscalYear: '2025', date: '2025-09-27', revenue: 440e9, netIncome: 110e9 },
    { fiscalYear: '2024', date: '2024-09-28', revenue: 400e9, netIncome: 90e9 },
  ].map((row) => ({ year: fmpFiscalYear(row)!, revenue: row.revenue, netIncome: row.netIncome, capex: 0, nonCashExpense: 0 }));

  assert.deepEqual(financialStatements(history, 1e6).map((s) => s.year), [2024, 2025]);
  const scored = scoreClaim(
    { metric: 'revenueGrowth', target: { min: 0.1, max: 0.1 }, horizon: 2025, quote: 'q' },
    history
  );
  assert.equal(scored.verdict, 'met');
  assert.ok(Math.abs(scored.actual! - 0.1) < 1e-9);
});
