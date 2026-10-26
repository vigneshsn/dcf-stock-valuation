import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { YearFinancials } from './dcf.js';
import { LlmError, generateJson } from './llm.js';
import { extractMdna, filterRelevant, pdfToText } from './mdna.js';
import { verifiedQuote } from './qualitative.js';
import { AnnualReportRef } from './reports.js';

// Bump when the input selection, prompt or claim parsing changes so stored claims are recomputed.
export const GUIDANCE_VERSION = 1;
// ~4k tokens, so the call fits free-tier per-minute token limits with room for the answer.
export const MAX_GUIDANCE_INPUT_CHARS = 16_000;
export const MAX_GUIDANCE_CLAIMS = 12;
const GUIDANCE_MAX_TOKENS = 1500;
const NEAR_TOLERANCE = 0.1;

// revenueGrowth, netProfitGrowth, margin (net margin) and capex (share of revenue) are fractions; debt is debt-to-equity.
export type GuidanceMetric = 'revenueGrowth' | 'netProfitGrowth' | 'margin' | 'capex' | 'debt';
export type ClaimMetric = GuidanceMetric | 'other';
export type Verdict = 'met' | 'near' | 'missed' | 'pending' | 'unscored';
export type YearStatus = 'ok' | 'no-report' | 'no-guidance' | 'llm-unavailable' | 'failed';

export interface GuidanceTarget {
  min: number;
  max: number;
}

// A forward-looking statement from a report. Vague statements keep metric "other" and no target.
export interface GuidanceClaim {
  metric: ClaimMetric;
  target: GuidanceTarget | null;
  // Fiscal year the target applies to
  horizon: number | null;
  // Always verified verbatim against the text the model saw
  quote: string;
}

export interface ScoredClaim extends GuidanceClaim {
  actual: number | null;
  verdict: Verdict;
}

export interface GuidanceYear {
  year: number;
  status: YearStatus;
  cached: boolean;
  claims: GuidanceClaim[];
}

export interface ScoredGuidanceYear extends Omit<GuidanceYear, 'claims'> {
  claims: ScoredClaim[];
}

const SCORED_METRICS: readonly GuidanceMetric[] = ['revenueGrowth', 'netProfitGrowth', 'margin', 'capex', 'debt'];
// Targets for these are ceilings: lower is better.
const LOWER_IS_BETTER: readonly ClaimMetric[] = ['capex', 'debt'];
// The model answers in percent for these; the code stores fractions.
const PERCENT_METRICS: readonly ClaimMetric[] = ['revenueGrowth', 'netProfitGrowth', 'margin', 'capex'];

// ---- Extraction ------------------------------------------------------------

// MD&A / outlook text only; the filter favours passages that state guidance and targets.
export function guidanceInput(reportText: string, maxChars = MAX_GUIDANCE_INPUT_CHARS): string | null {
  const mdna = extractMdna(reportText);
  return mdna ? filterRelevant(mdna, maxChars) : null;
}

// Prompt fragment shared with the MD&A insights call, which extracts the Latest annual report's claims in the same request.
export const GUIDANCE_SCHEMA_PROMPT =
  `guidance: up to ${MAX_GUIDANCE_CLAIMS} forward-looking statements by management about future results, each with:\n` +
  '  - "metric": revenueGrowth | netProfitGrowth | margin (net profit margin) | capex (capital expenditure as % of revenue) | debt (debt-to-equity ratio) | other (any other or vague statement, e.g. "strong growth ahead").\n' +
  '  - "target": {"min":<number>,"max":<number>} for a numeric target (percent numbers, e.g. 15 for 15%; debt as a ratio), or null when there is none.\n' +
  '  - "horizon": the fiscal year the target applies to as a 4-digit year, or null if not stated.\n' +
  '  - "quote": one contiguous phrase of 8-30 words copied verbatim from the text (no "..."), stating the guidance.\n' +
  'Only include statements about the future, not past results.';

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[%,\s]/g, '')) : Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : n;
};

function parseTarget(raw: unknown, metric: ClaimMetric): GuidanceTarget | null {
  const r = raw as { min?: unknown; max?: unknown; value?: unknown } | number | string | null | undefined;
  const obj = typeof r === 'object' && r !== null ? r : { value: r };
  const lo = finite(obj.min ?? obj.value);
  const hi = finite(obj.max ?? obj.value);
  const a = lo ?? hi;
  const b = hi ?? lo;
  if (a == null || b == null) {
    return null;
  }
  const scale = PERCENT_METRICS.includes(metric) ? 100 : 1;
  return { min: Math.min(a, b) / scale, max: Math.max(a, b) / scale };
}

// Normalises the model's answer; claims whose quote is not verbatim in `source` are dropped.
export function parseGuidanceClaims(raw: unknown, source: string): GuidanceClaim[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: GuidanceClaim[] = [];
  for (const r of raw as Array<Record<string, unknown> | null>) {
    const quote = verifiedQuote(r?.quote, source);
    if (!quote || out.some((c) => c.quote === quote)) {
      continue;
    }
    const metric = (SCORED_METRICS as readonly string[]).includes(String(r?.metric)) ? (r!.metric as GuidanceMetric) : 'other';
    const horizon = finite(r?.horizon);
    out.push({
      metric,
      target: metric === 'other' ? null : parseTarget(r?.target, metric),
      horizon: horizon != null && Number.isInteger(horizon) && horizon >= 1990 && horizon <= 2100 ? horizon : null,
      quote,
    });
    if (out.length >= MAX_GUIDANCE_CLAIMS) {
      break;
    }
  }
  return out;
}

export type GuidanceExtractor = (year: number, text: string) => Promise<GuidanceClaim[]>;

export const extractGuidance: GuidanceExtractor = async (year, text) => {
  const raw = await generateJson<Record<string, unknown>>(
    `Below are excerpts from a company's FY${year} annual report management discussion and analysis.\n` +
      'List the forward-looking guidance management gives, so it can later be checked against actual results.\n' +
      `${GUIDANCE_SCHEMA_PROMPT}\n` +
      'Use an empty list if there is none.\n' +
      'Reply as JSON: {"guidance":[{"metric":"","target":{"min":0,"max":0},"horizon":0,"quote":""}]}\n\n' +
      text,
    GUIDANCE_MAX_TOKENS
  );
  return parseGuidanceClaims(raw?.guidance, text);
};

// ---- Scoring ---------------------------------------------------------------

const rowOf = (history: YearFinancials[], year: number) => history.find((h) => h.year === year);

function actualFor(metric: GuidanceMetric, horizon: number, history: YearFinancials[]): number | null {
  const row = rowOf(history, horizon);
  if (!row) {
    return null;
  }
  const growth = (current: number, prior: number | undefined) => (prior != null && prior > 0 ? current / prior - 1 : null);
  const prior = rowOf(history, horizon - 1);
  switch (metric) {
    case 'revenueGrowth':
      return growth(row.revenue, prior?.revenue);
    case 'netProfitGrowth':
      return growth(row.netIncome, prior?.netIncome);
    case 'margin':
      return row.revenue > 0 ? row.netIncome / row.revenue : null;
    case 'capex':
      return row.revenue > 0 ? row.capex / row.revenue : null;
    case 'debt':
      return row.totalDebt != null && row.totalEquity != null && row.totalEquity > 0 ? row.totalDebt / row.totalEquity : null;
  }
}

export function scoreClaim(claim: GuidanceClaim, history: YearFinancials[]): ScoredClaim {
  const unscored = { ...claim, actual: null, verdict: 'unscored' as const };
  if (claim.metric === 'other' || !claim.target || claim.horizon == null) {
    return unscored;
  }
  if (!rowOf(history, claim.horizon)) {
    return { ...claim, actual: null, verdict: 'pending' };
  }
  const actual = actualFor(claim.metric, claim.horizon, history);
  if (actual == null) {
    return unscored;
  }
  const lower = LOWER_IS_BETTER.includes(claim.metric);
  const ref = lower ? claim.target.max : claim.target.min;
  // Only point targets get a near band; a range is met inside or above, missed below.
  const slack = claim.target.min === claim.target.max ? Math.abs(ref) * NEAR_TOLERANCE : 0;
  const eps = 1e-9;
  const verdict: Verdict = lower
    ? actual <= ref + eps ? 'met' : actual <= ref + slack + eps ? 'near' : 'missed'
    : actual >= ref - eps ? 'met' : actual >= ref - slack - eps ? 'near' : 'missed';
  return { ...claim, actual, verdict };
}

export interface GuidanceScorecard {
  lowerConfidence: boolean;
  // met / (met + near + missed); null when nothing is scored
  hitRate: number | null;
  years: ScoredGuidanceYear[];
}

export function guidanceScorecard(years: GuidanceYear[], history: YearFinancials[]): GuidanceScorecard {
  const scored = years.map((y) => ({ ...y, claims: y.claims.map((c) => scoreClaim(c, history)) }));
  const verdicts = scored.flatMap((y) => y.claims.map((c) => c.verdict)).filter((v) => v === 'met' || v === 'near' || v === 'missed');
  const reports = years.filter((y) => y.status === 'ok' || y.status === 'no-guidance').length;
  return {
    lowerConfidence: reports < 3,
    hitRate: verdicts.length ? verdicts.filter((v) => v === 'met').length / verdicts.length : null,
    years: scored,
  };
}

// ---- Disk store (a past report's guidance never changes) --------------------

export interface StoredGuidance {
  year: number;
  source: AnnualReportRef['source'];
  // false when the report had no recognisable MD&A section
  found: boolean;
  claims: GuidanceClaim[];
  createdAt: number;
}

export function guidanceCacheDir(): string {
  return process.env.GUIDANCE_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'guidance');
}

const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');
const tickerPrefix = (ticker: string) => `${safe(ticker)}__`;
const modelSuffix = (model: string) => `__${safe(model)}__v${GUIDANCE_VERSION}.json`;
const fileName = (ticker: string, year: number, model: string) => `${tickerPrefix(ticker)}${year}${modelSuffix(model)}`;

async function listCacheFiles(): Promise<string[]> {
  try {
    return await readdir(guidanceCacheDir());
  } catch {
    return [];
  }
}

export async function readStoredGuidance(ticker: string, year: number, model: string): Promise<StoredGuidance | undefined> {
  try {
    return JSON.parse(await readFile(path.join(guidanceCacheDir(), fileName(ticker, year, model)), 'utf8')) as StoredGuidance;
  } catch {
    return undefined;
  }
}

async function writeStoredGuidance(ticker: string, model: string, entry: StoredGuidance): Promise<void> {
  const dir = guidanceCacheDir();
  const target = path.join(dir, fileName(ticker, entry.year, model));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, target);
  } catch (err: any) {
    console.error(`[guidance cache] write failed for ${target}: ${err?.message || err}`);
  }
}

async function storedGuidanceYears(ticker: string, model: string): Promise<number[]> {
  const prefix = tickerPrefix(ticker);
  const suffix = modelSuffix(model);
  return (await listCacheFiles())
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => Number(f.slice(prefix.length, f.length - suffix.length)))
    .filter((y) => Number.isInteger(y));
}

// Drops every stored result for the year (all models and versions); called when a report is uploaded.
export async function forgetStoredGuidance(ticker: string, year: number): Promise<void> {
  const prefix = `${tickerPrefix(ticker)}${year}__`;
  await Promise.all(
    (await listCacheFiles())
      .filter((f) => f.startsWith(prefix))
      .map((f) => unlink(path.join(guidanceCacheDir(), f)).catch(() => undefined))
  );
}

// ---- Reports → claims --------------------------------------------------------

export interface GuidanceDeps {
  listReports: (ticker: string, count: number) => Promise<AnnualReportRef[]>;
  textOf?: (pdf: Buffer) => Promise<string>;
  extract?: GuidanceExtractor;
  // Claims already extracted for a year by another call (the MD&A insights call); undefined when none.
  sharedClaims?: (year: number) => Promise<GuidanceClaim[] | undefined>;
}

const inflight = new Map<string, Promise<GuidanceYear>>();

const yearResult = (year: number, claims: GuidanceClaim[], cached: boolean): GuidanceYear => ({
  year,
  status: claims.length ? 'ok' : 'no-guidance',
  cached,
  claims,
});

function yearGuidance(ticker: string, model: string, ref: AnnualReportRef, isLatest: boolean, deps: GuidanceDeps): Promise<GuidanceYear> {
  const key = fileName(ticker, ref.year, model);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const work = (async (): Promise<GuidanceYear> => {
    const stored = await readStoredGuidance(ticker, ref.year, model);
    // An uploaded report replaces claims derived from a fetched one.
    if (stored && !(ref.source === 'upload' && stored.source !== 'upload')) {
      console.log(`[guidance cache HIT] ${key}`);
      return yearResult(ref.year, stored.claims, true);
    }
    // The Latest annual report's claims come with its MD&A insights, so they cost no extra call.
    const shared = isLatest ? await deps.sharedClaims?.(ref.year) : undefined;
    if (shared) {
      return yearResult(ref.year, shared, true);
    }
    const pdf = await ref.load();
    if (!pdf) {
      return { year: ref.year, status: 'no-report', cached: false, claims: [] };
    }
    try {
      const started = Date.now();
      const input = guidanceInput(await (deps.textOf ?? pdfToText)(pdf));
      const claims = input ? await (deps.extract ?? extractGuidance)(ref.year, input) : [];
      console.log(`[guidance cache MISS] ${key}: ${claims.length} claim(s) in ${Date.now() - started}ms`);
      await writeStoredGuidance(ticker, model, { year: ref.year, source: ref.source, found: !!input, claims, createdAt: Date.now() });
      return yearResult(ref.year, claims, false);
    } catch (err: any) {
      console.error(`[guidance error] ${key}: ${err?.message || err}`);
      return { year: ref.year, status: err instanceof LlmError ? 'llm-unavailable' : 'failed', cached: false, claims: [] };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

// Guidance for up to `count` reports, newest first. Years run in parallel; one LLM call per report, ever.
// Stored years keep the result available when the report listing or the LLM is down.
export async function collectGuidance(ticker: string, model: string, count: number, deps: GuidanceDeps): Promise<GuidanceYear[]> {
  const refs = await deps.listReports(ticker, count).catch(() => [] as AnnualReportRef[]);
  const known = new Set(refs.map((r) => r.year));
  const storedOnly: AnnualReportRef[] = (await storedGuidanceYears(ticker, model))
    .filter((y) => !known.has(y))
    .map((year) => ({ year, source: 'screener', load: async () => null }));
  const plan = [...refs, ...storedOnly].sort((a, b) => b.year - a.year).slice(0, count);
  return Promise.all(plan.map((ref, i) => yearGuidance(ticker, model, ref, i === 0, deps)));
}
