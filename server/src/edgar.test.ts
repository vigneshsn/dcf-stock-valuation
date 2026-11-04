import { test } from 'node:test';
import assert from 'node:assert';
import { listReports, saveUpload } from './reports.js';
import { US_REPORTS } from './reportProfiles.js';
import { EdgarConfigError, EdgarRejectedError, resetEdgarCache } from './edgar.js';

const TICKERS = { '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, '1': { cik_str: 1067983, ticker: 'BRK-B', title: 'Berkshire' } };
const SUBMISSIONS = {
  filings: {
    recent: {
      form: ['10-Q', '10-K', '8-K', '10-K', '10-K/A', '10-K', '10-K'],
      accessionNumber: ['0-1', '0000320193-25-000079', '0-3', '0000320193-24-000123', '0-5', '0000320193-23-000106', '0000320193-22-000108'],
      primaryDocument: ['q.htm', 'aapl-20250927.htm', 'e.htm', 'aapl-20240928.htm', 'a.htm', 'aapl-20230930.htm', 'aapl-20220924.htm'],
      reportDate: ['2025-06-28', '2025-09-27', '2025-10-30', '2024-09-28', '2024-09-28', '2023-09-30', '2022-09-24'],
    },
  },
};

function edgarFetcher(requests: Array<{ url: string; ua: string | null }> = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, ua: new Headers(init?.headers).get('User-Agent') });
    if (url === 'https://www.sec.gov/files/company_tickers.json') {
      return new Response(JSON.stringify(TICKERS));
    }
    if (url === 'https://data.sec.gov/submissions/CIK0000320193.json') {
      return new Response(JSON.stringify(SUBMISSIONS));
    }
    if (url.startsWith('https://www.sec.gov/Archives/edgar/data/320193/')) {
      return new Response(`<html>10-K ${url.split('/').pop()}</html>`);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

async function withUserAgent<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.SEC_USER_AGENT;
  if (value === undefined) {
    delete process.env.SEC_USER_AGENT;
  } else {
    process.env.SEC_USER_AGENT = value;
  }
  resetEdgarCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SEC_USER_AGENT;
    } else {
      process.env.SEC_USER_AGENT = previous;
    }
  }
}

test('US edition lists the last 3 10-Ks from EDGAR, newest first, downloading only on load()', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    const requests: Array<{ url: string; ua: string | null }> = [];
    const refs = await listReports('AAPL', 3, edgarFetcher(requests), US_REPORTS);

    assert.deepStrictEqual(refs.map((r) => [r.year, r.source]), [[2025, 'edgar'], [2024, 'edgar'], [2023, 'edgar']]);
    assert.ok(requests.every((r) => r.ua === 'DCF Tester test@example.com'));
    assert.ok(!requests.some((r) => r.url.includes('/Archives/')));

    const html = (await refs[0].load())!.toString();
    assert.strictEqual(html, '<html>10-K aapl-20250927.htm</html>');
    assert.ok(requests.some((r) => r.url === 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm'));
  });
});

test('US edition fails with an explicit error when SEC_USER_AGENT is missing, without calling EDGAR', async () => {
  await withUserAgent(undefined, async () => {
    const requests: Array<{ url: string; ua: string | null }> = [];
    await assert.rejects(listReports('AAPL', 3, edgarFetcher(requests), US_REPORTS), (err: unknown) => {
      assert.ok(err instanceof EdgarConfigError);
      assert.match((err as Error).message, /SEC_USER_AGENT/);
      return true;
    });
    assert.strictEqual(requests.length, 0);
  });
});

test('EDGAR lookups are cached and throttled to at most 10 requests per second', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    const stamps: number[] = [];
    const base = edgarFetcher();
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      stamps.push(Date.now());
      return base(input, init);
    }) as typeof fetch;

    const refs = await listReports('AAPL', 3, fetcher, US_REPORTS);
    await Promise.all(refs.map((r) => r.load()));
    const first = stamps.length;
    await listReports('AAPL', 3, fetcher, US_REPORTS);
    await refs[0].load();

    assert.strictEqual(first, 5);
    assert.strictEqual(stamps.length, first, 'second listing and re-download are served from cache');
    for (let i = 1; i < stamps.length; i++) {
      assert.ok(stamps[i] - stamps[i - 1] >= 95, `requests ${i - 1} and ${i} are ${stamps[i] - stamps[i - 1]}ms apart`);
    }
  });
});

test('US edition returns no reports for an unknown ticker', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    assert.deepStrictEqual(await listReports('NOSUCH', 3, edgarFetcher(), US_REPORTS), []);
  });
});

test('EDGAR refusing us (403/429) is an explicit error, not an empty listing', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    const refusing = (async () => new Response('slow down', { status: 429 })) as typeof fetch;
    await assert.rejects(listReports('AAPL', 3, refusing, US_REPORTS), EdgarRejectedError);
  });
});

test('older 10-Ks come from the additional submission files when the recent list is short', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    const base = edgarFetcher();
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://data.sec.gov/submissions/CIK0000320193.json') {
        const recent = { form: ['10-K'], accessionNumber: ['0000320193-25-000079'], primaryDocument: ['new.htm'], reportDate: ['2025-09-27'] };
        return new Response(JSON.stringify({ filings: { recent, files: [{ name: 'CIK0000320193-submissions-001.json' }] } }));
      }
      if (url.endsWith('CIK0000320193-submissions-001.json')) {
        return new Response(JSON.stringify({ form: ['10-K', '10-K'], accessionNumber: ['0000320193-24-000123', '0000320193-23-000106'], primaryDocument: ['b.htm', 'c.htm'], reportDate: ['2024-09-28', '2023-09-30'] }));
      }
      return base(input, init);
    }) as typeof fetch;
    assert.deepStrictEqual((await listReports('AAPL', 3, fetcher, US_REPORTS)).map((r) => r.year), [2025, 2024, 2023]);
  });
});

test('a slow filing download does not hold up other EDGAR requests, and concurrent downloads share one request', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    const base = edgarFetcher();
    let downloads = 0;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/Archives/')) {
        downloads++;
        if (!String(input).endsWith('aapl-20250927.htm')) return base(input, init);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return base(input, init);
    }) as typeof fetch;
    const refs = await listReports('AAPL', 3, fetcher, US_REPORTS);
    const slow = Promise.all([refs[0].load(), refs[0].load()]);
    const started = Date.now();
    await refs[1].load().catch(() => null);
    assert.ok(Date.now() - started < 600, 'second filing is not queued behind the first download');
    await slow;
    assert.strictEqual(downloads, 2, 'two loads of one filing, plus one other filing');
  });
});

// Uploads are process-wide, so this runs last.
test('US edition lets an uploaded 10-K take precedence over EDGAR for the same year', async () => {
  await withUserAgent('DCF Tester test@example.com', async () => {
    saveUpload('AAPL', 2024, Buffer.from('%PDF-1.7 uploaded'));
    const refs = await listReports('AAPL', 3, edgarFetcher(), US_REPORTS);
    assert.deepStrictEqual(refs.map((r) => [r.year, r.source]), [[2025, 'edgar'], [2024, 'upload'], [2023, 'edgar']]);
  });
});
