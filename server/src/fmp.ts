import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

export class FmpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Statements change once a year, profile-type data rarely, and the price is the only field kept near-current.
const ttlFor = (path: string): number => {
  if (/\/(income-statement|balance-sheet-statement|cash-flow-statement)$/.test(path)) {
    return Number(process.env.FMP_STATEMENTS_TTL_MS) || 30 * DAY_MS;
  }
  if (path === '/quote') {
    return Number(process.env.FMP_QUOTE_TTL_MS) || DAY_MS;
  }
  return Number(process.env.FMP_PROFILE_TTL_MS) || 7 * DAY_MS;
};

const dailyLimit = (): number => Number(process.env.FMP_DAILY_LIMIT) || 240;

export function fmpCacheDir(): string {
  return process.env.FMP_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'fmp');
}

interface FmpContext {
  refresh: boolean;
  staleSince: number | null;
}

const context = new AsyncLocalStorage<FmpContext>();

/** Per-request scope: `?refresh=1` bypasses the cache, and any stale FMP data served is flagged on the JSON response. */
export function fmpRequestContext(req: Request, res: Response, next: NextFunction): void {
  const ctx: FmpContext = { refresh: req.query.refresh === '1', staleSince: null };
  const json = res.json.bind(res);
  res.json = (body?: unknown) =>
    json(ctx.staleSince != null && body && typeof body === 'object' && !Array.isArray(body)
      ? { ...body, stale: true, dataAsOf: ctx.staleSince }
      : body);
  context.run(ctx, next);
}

export const fmpRefreshRequested = (): boolean => context.getStore()?.refresh ?? false;
export const fmpServedStale = (): boolean => context.getStore()?.staleSince != null;

interface Stored {
  fetchedAt: number;
  data: unknown;
}

function entryName(endpoint: string, ticker: string, params: Record<string, string | number>): string {
  const query = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${[endpoint.slice(1), ticker, query].filter(Boolean).join('__').replace(/[^A-Za-z0-9._=&-]/g, '_')}.json`;
}

async function readEntry(file: string): Promise<Stored | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Stored;
  } catch {
    return null;
  }
}

async function writeEntry(file: string, entry: Stored): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, file);
  } catch (err: any) {
    console.error(`[fmp cache] write failed for ${file}: ${err?.message || err}`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function usageFile(): string {
  return path.join(fmpCacheDir(), 'usage.json');
}

function callsToday(): number {
  try {
    const usage = JSON.parse(readFileSync(usageFile(), 'utf8'));
    return usage.date === today() ? Number(usage.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function recordCall(): void {
  const count = callsToday() + 1;
  try {
    mkdirSync(fmpCacheDir(), { recursive: true });
    writeFileSync(usageFile(), JSON.stringify({ date: today(), count }));
  } catch (err: any) {
    console.error(`[fmp cache] usage write failed: ${err?.message || err}`);
  }
  if (count === dailyLimit()) {
    console.warn(`[fmp budget] ${count} calls made today; only cached data will be served until UTC midnight`);
  }
}

// An outage is worth falling back on; an unknown symbol or a bad key is not.
const isOutage = (err: unknown): boolean =>
  !(err instanceof FmpError) || err.status === 429 || err.status >= 500 || (err.status === 402 && !/symbol/i.test(err.message));

const inFlight = new Map<string, Promise<unknown>>();

export async function fmpGet<T>(
  endpoint: string,
  ticker: string,
  extraParams: Record<string, string | number> = {},
  fetcher: typeof fetch = fetch
): Promise<T> {
  const name = entryName(endpoint, ticker, extraParams);
  const key = `fmp:${fmpCacheDir()}:${name}`;
  const ttl = ttlFor(endpoint);
  const ctx = context.getStore();
  const refresh = ctx?.refresh ?? false;

  const stored = await readEntry(path.join(fmpCacheDir(), name));
  if (stored && !refresh && Date.now() - stored.fetchedAt < ttl) {
    return stored.data as T;
  }

  const serveStale = (): T | undefined => {
    if (!stored) {
      return undefined;
    }
    if (ctx) {
      ctx.staleSince = Math.min(ctx.staleSince ?? Infinity, stored.fetchedAt);
    }
    return stored.data as T;
  };

  if (callsToday() >= dailyLimit()) {
    const stale = serveStale();
    if (stale !== undefined) {
      console.warn(`[fmp budget] limit reached, serving stale ${name}`);
      return stale;
    }
    throw new FmpError('FMP daily call budget reached', 429);
  }

  const pending = inFlight.get(key) ?? (async () => {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      throw new FmpError('FMP_API_KEY is not configured', 500);
    }
    const params = new URLSearchParams({ symbol: ticker, apikey: apiKey });
    for (const [k, v] of Object.entries(extraParams)) {
      params.set(k, String(v));
    }
    recordCall();
    const response = await fetcher(`${FMP_BASE_URL}${endpoint}?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new FmpError(`FMP request failed (${response.status}) for ${endpoint}: ${body}`, response.status);
    }
    const data = await response.json();
    // Empty answers (unknown symbols) are not kept, so a typo does not stick for days.
    if (Array.isArray(data) ? data.length : data) {
      await writeEntry(path.join(fmpCacheDir(), name), { fetchedAt: Date.now(), data });
    }
    return data;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, pending);

  try {
    return (await pending) as T;
  } catch (err) {
    const stale = isOutage(err) ? serveStale() : undefined;
    if (stale === undefined) {
      throw err;
    }
    console.warn(`[fmp] ${name} failed (${err instanceof Error ? err.message : err}); serving stale data`);
    return stale;
  }
}

/** The company's own fiscal-year label (FMP fiscalYear), e.g. 2025 for Apple's year ending September 2025. */
export function fmpFiscalYear(row: { fiscalYear?: string | number; calendarYear?: string | number; date?: string }): number | null {
  const year = Number(row.fiscalYear ?? row.calendarYear ?? row.date?.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}
