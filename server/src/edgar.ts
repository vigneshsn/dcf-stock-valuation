export class EdgarSetupError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'EdgarSetupError';
  }
}

export class EdgarConfigError extends EdgarSetupError {
  constructor() {
    super('sec-user-agent-missing', 'SEC_USER_AGENT is required in the US edition: set it to "Your Name your@email.com" so SEC EDGAR accepts the requests.');
  }
}

/** EDGAR refused the request (bad User-Agent or rate limit), which retrying a listing cannot fix. */
export class EdgarRejectedError extends EdgarSetupError {
  constructor(status: number) {
    super('sec-edgar-rejected', `SEC EDGAR rejected the request (HTTP ${status}). Check SEC_USER_AGENT and retry later.`);
  }
}

export interface EdgarFiling {
  year: number;
  url: string;
}

// SEC's fair-access limit is 10 requests per second.
const MIN_INTERVAL_MS = 105;
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const FILING_TTL_MS = 10 * 60 * 1000;
// Filings are megabytes of HTML; stored insights and guidance make long-lived caching unnecessary.
const MAX_CACHED_FILINGS = 4;

interface Cached {
  expiresAt: number;
  text: Promise<string | null>;
}

const cache = new Map<string, Cached>();
let nextSlotAt = 0;

export function resetEdgarCache(): void {
  cache.clear();
  nextSlotAt = 0;
}

export function secUserAgent(): string {
  const value = process.env.SEC_USER_AGENT?.trim();
  if (!value) {
    throw new EdgarConfigError();
  }
  return value;
}

// Reserves a start slot so request starts are at least MIN_INTERVAL_MS apart; slow responses do not hold up later requests.
async function waitForSlot(): Promise<void> {
  const slot = Math.max(Date.now(), nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;
  const wait = slot - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function fetchText(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  const userAgent = secUserAgent();
  await waitForSlot();
  const res = await fetcher(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 403 || res.status === 429) {
    throw new EdgarRejectedError(res.status);
  }
  return res.ok ? res.text() : null;
}

// Concurrent callers share one request; failures are evicted so the next call retries.
function cachedText(url: string, ttlMs: number, fetcher: typeof fetch, timeoutMs: number, maxEntries?: number): Promise<string | null> {
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.text;
  }
  const text = fetchText(url, fetcher, timeoutMs);
  cache.set(url, { expiresAt: Date.now() + ttlMs, text });
  text.then((value) => value === null && cache.delete(url), () => cache.delete(url));
  if (maxEntries) {
    const filings = [...cache.keys()].filter((k) => k.includes('/Archives/'));
    for (const oldest of filings.slice(0, Math.max(0, filings.length - maxEntries))) {
      cache.delete(oldest);
    }
  }
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

interface FilingColumns {
  form?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  reportDate?: string[];
}

// Best effort apart from setup problems: other failures return [] so the caller falls back to uploads or stored summaries.
export async function listEdgarFilings(ticker: string, count: number, fetcher: typeof fetch = fetch): Promise<EdgarFiling[]> {
  secUserAgent();
  try {
    const cik = await cikFor(ticker, fetcher);
    if (cik === null) {
      return [];
    }
    const submissionsUrl = (name: string) => `https://data.sec.gov/submissions/${name}`;
    const main = await cachedText(submissionsUrl(`CIK${String(cik).padStart(10, '0')}.json`), LOOKUP_TTL_MS, fetcher, 30_000);
    if (!main) {
      return [];
    }
    const filings = JSON.parse(main)?.filings;
    const out: EdgarFiling[] = [];
    const collect = (columns: FilingColumns | undefined) => {
      for (let i = 0; i < (columns?.form?.length ?? 0) && out.length < count; i++) {
        // 10-K/A amendments are partial, so only original filings are used. The year is the one the period ends in, which is how FMP labels fiscal years.
        const year = Number(String(columns!.reportDate![i]).slice(0, 4));
        if (columns!.form![i] === '10-K' && Number.isFinite(year) && !out.some((o) => o.year === year)) {
          const accession = String(columns!.accessionNumber![i]).replace(/-/g, '');
          out.push({ year, url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${columns!.primaryDocument![i]}` });
        }
      }
    };
    collect(filings?.recent);
    // Older filings of busy filers sit in additional submission files.
    for (const file of filings?.files ?? []) {
      if (out.length >= count) {
        break;
      }
      const older = await cachedText(submissionsUrl(file.name), LOOKUP_TTL_MS, fetcher, 30_000);
      collect(older ? JSON.parse(older) : undefined);
    }
    return out;
  } catch (err) {
    return setupErrorOr(err, []);
  }
}

export async function downloadEdgarFiling(url: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const text = await cachedText(url, FILING_TTL_MS, fetcher, 120_000, MAX_CACHED_FILINGS);
    return text === null ? null : Buffer.from(text);
  } catch (err) {
    return setupErrorOr(err, null);
  }
}

/** Setup problems (missing User-Agent, EDGAR refusing us) must reach the user; any other failure becomes the fallback. */
export function setupErrorOr<T>(err: unknown, fallback: T): T {
  if (err instanceof EdgarSetupError) {
    throw err;
  }
  return fallback;
}
