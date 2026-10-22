import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AnnualReportRef, listReports } from './reports.js';
import { MdnaSummary, extractMdna, pdfToText, summariseMdna } from './mdna.js';
import { YearSummary } from './qualitative.js';

// Bump when MD&A extraction, filtering or the summary prompt changes so stored summaries are recomputed.
export const SUMMARY_VERSION = 2;

// A past year's annual report never changes, so its MD&A summary is kept on disk indefinitely.
export interface StoredYear {
  year: number;
  source: AnnualReportRef['source'];
  // null when the report had no recognisable MD&A section
  summary: string | null;
  excerpt: string;
  chunkCount: number;
  createdAt: number;
}

export function summaryCacheDir(): string {
  return process.env.MDNA_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'mdna');
}

const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');
const tickerPrefix = (ticker: string) => `${safe(ticker)}__`;
const modelSuffix = (model: string) => `__${safe(model)}__v${SUMMARY_VERSION}.json`;
const fileName = (ticker: string, year: number, model: string) => `${tickerPrefix(ticker)}${year}${modelSuffix(model)}`;

export async function readStoredYear(ticker: string, year: number, model: string): Promise<StoredYear | undefined> {
  try {
    return JSON.parse(await readFile(path.join(summaryCacheDir(), fileName(ticker, year, model)), 'utf8')) as StoredYear;
  } catch {
    return undefined;
  }
}

async function writeStoredYear(ticker: string, model: string, entry: StoredYear): Promise<void> {
  const dir = summaryCacheDir();
  const target = path.join(dir, fileName(ticker, entry.year, model));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, target);
  } catch (err: any) {
    console.error(`[summary cache] write failed for ${target}: ${err?.message || err}`);
  }
}

async function listCacheFiles(): Promise<string[]> {
  try {
    return await readdir(summaryCacheDir());
  } catch {
    return [];
  }
}

export async function storedYears(ticker: string, model: string): Promise<number[]> {
  const prefix = tickerPrefix(ticker);
  const suffix = modelSuffix(model);
  return (await listCacheFiles())
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => Number(f.slice(prefix.length, f.length - suffix.length)))
    .filter((y) => Number.isInteger(y));
}

// Drops every stored summary for the year (all models and versions); called when a report is uploaded.
export async function forgetStoredYear(ticker: string, year: number): Promise<void> {
  const prefix = `${tickerPrefix(ticker)}${year}__`;
  await Promise.all(
    (await listCacheFiles())
      .filter((f) => f.startsWith(prefix))
      .map((f) => unlink(path.join(summaryCacheDir(), f)).catch(() => undefined))
  );
}

async function summarisePdf(pdf: Buffer): Promise<MdnaSummary | null> {
  const section = extractMdna(await pdfToText(pdf));
  return section ? summariseMdna(section) : null;
}

export interface YearSummaryDeps {
  listReports?: (ticker: string, count: number) => Promise<AnnualReportRef[]>;
  summarise?: (pdf: Buffer) => Promise<MdnaSummary | null>;
}

export interface YearSummariesResult {
  // years for which a report (or its stored summary) was available
  reportCount: number;
  summaries: YearSummary[];
  skippedYears: number[];
}

// Concurrent requests for the same ticker/year share one computation.
const inflight = new Map<string, Promise<StoredYear | null>>();

function yearSummary(
  ticker: string,
  model: string,
  ref: AnnualReportRef,
  summarise: NonNullable<YearSummaryDeps['summarise']>
): Promise<StoredYear | null> {
  const key = fileName(ticker, ref.year, model);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const work = (async () => {
    const stored = await readStoredYear(ticker, ref.year, model);
    // An uploaded report replaces a summary derived from a fetched one.
    if (stored && !(ref.source === 'upload' && stored.source !== 'upload')) {
      console.log(`[summary cache HIT] ${key}`);
      return stored;
    }
    const started = Date.now();
    const pdf = await ref.load();
    if (!pdf) {
      return null;
    }
    const result = await summarise(pdf);
    const entry: StoredYear = {
      year: ref.year,
      source: ref.source,
      summary: result?.summary ?? null,
      excerpt: result?.excerpt ?? '',
      chunkCount: result?.chunkCount ?? 0,
      createdAt: Date.now(),
    };
    console.log(`[summary cache MISS] ${key}: ${entry.chunkCount} chunk(s) in ${Date.now() - started}ms`);
    await writeStoredYear(ticker, model, entry);
    return entry;
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

// Per-year MD&A summaries, newest first. Years are processed in parallel and PDFs are only downloaded on a cache miss.
export async function collectYearSummaries(
  ticker: string,
  model: string,
  count = 3,
  deps: YearSummaryDeps = {}
): Promise<YearSummariesResult> {
  const list = deps.listReports ?? ((t: string, n: number) => listReports(t, n));
  const summarise = deps.summarise ?? summarisePdf;
  const refs = await list(ticker, count);
  const known = new Set(refs.map((r) => r.year));
  // Stored years keep the analysis working when the report listing is unavailable.
  const storedOnly: AnnualReportRef[] = (await storedYears(ticker, model))
    .filter((y) => !known.has(y))
    .map((year) => ({ year, source: 'screener', load: async () => null }));
  const plan = [...refs, ...storedOnly].sort((a, b) => b.year - a.year).slice(0, count);

  const results = (await Promise.all(plan.map((ref) => yearSummary(ticker, model, ref, summarise)))).filter(
    (r): r is StoredYear => r !== null
  );
  return {
    reportCount: results.length,
    summaries: results
      .filter((r) => r.summary !== null)
      .map((r) => ({ year: r.year, summary: r.summary!, excerpt: r.excerpt }))
      .sort((a, b) => b.year - a.year),
    skippedYears: results.filter((r) => r.summary === null).map((r) => r.year),
  };
}
