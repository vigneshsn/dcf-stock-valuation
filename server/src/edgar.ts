import { get as cacheGet, set as cacheSet } from './cache.js';

export class EdgarConfigError extends Error {
  constructor() {
    super('SEC_USER_AGENT is required in the US edition: set it to "Your Name your@email.com" so SEC EDGAR accepts the requests.');
    this.name = 'EdgarConfigError';
  }
}

export interface EdgarFiling {
  year: number;
  url: string;
}

// SEC's fair-access limit is 10 requests per second.
const MIN_INTERVAL_MS = 105;
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const FILING_TTL_MS = 60 * 60 * 1000;

let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

export function resetEdgarCache(): void {
  lastRequestAt = 0;
  queue = Promise.resolve();
  for (const key of cacheKeys) {
    cacheSet(key, undefined, 0);
  }
  cacheKeys.clear();
}

const cacheKeys = new Set<string>();

function remember<T>(key: string, value: T, ttlMs: number): void {
  cacheKeys.add(key);
  cacheSet(key, value, ttlMs);
}

export function secUserAgent(): string {
  const value = process.env.SEC_USER_AGENT?.trim();
  if (!value) {
    throw new EdgarConfigError();
  }
  return value;
}

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function edgarGet(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<Response> {
  const userAgent = secUserAgent();
  return throttled(() => fetcher(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) }));
}

async function cachedText(url: string, ttlMs: number, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  const key = `edgar:${url}`;
  const hit = cacheGet<string>(key);
  if (hit !== undefined) {
    return hit;
  }
  const res = await edgarGet(url, fetcher, timeoutMs);
  if (!res.ok) {
    return null;
  }
  const text = await res.text();
  remember(key, text, ttlMs);
  return text;
}

async function cikFor(ticker: string, fetcher: typeof fetch): Promise<number | null> {
  const body = await cachedText('https://www.sec.gov/files/company_tickers.json', LOOKUP_TTL_MS, fetcher, 30_000);
  if (!body) {
    return null;
  }
  const wanted = ticker.toUpperCase();
  const row = Object.values(JSON.parse(body) as Record<string, { cik_str: number; ticker: string }>).find((r) => r.ticker.toUpperCase() === wanted);
  return row?.cik_str ?? null;
}

// Best effort apart from configuration: network or parsing failures return [] so the caller falls back to uploads or stored summaries.
export async function listEdgarFilings(ticker: string, count: number, fetcher: typeof fetch = fetch): Promise<EdgarFiling[]> {
  secUserAgent();
  try {
    const cik = await cikFor(ticker, fetcher);
    if (cik === null) {
      return [];
    }
    const body = await cachedText(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, LOOKUP_TTL_MS, fetcher, 30_000);
    if (!body) {
      return [];
    }
    const recent = JSON.parse(body)?.filings?.recent;
    const out: EdgarFiling[] = [];
    for (let i = 0; i < (recent?.form?.length ?? 0) && out.length < count; i++) {
      // 10-K/A amendments are partial, so only original filings are used.
      const year = Number(String(recent.reportDate[i]).slice(0, 4));
      if (recent.form[i] === '10-K' && Number.isFinite(year) && !out.some((o) => o.year === year)) {
        const accession = String(recent.accessionNumber[i]).replace(/-/g, '');
        out.push({ year, url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${recent.primaryDocument[i]}` });
      }
    }
    return out;
  } catch (err) {
    if (err instanceof EdgarConfigError) {
      throw err;
    }
    return [];
  }
}

export async function downloadEdgarFiling(url: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const text = await cachedText(url, FILING_TTL_MS, fetcher, 120_000);
    return text === null ? null : Buffer.from(text);
  } catch (err) {
    if (err instanceof EdgarConfigError) {
      throw err;
    }
    return null;
  }
}
