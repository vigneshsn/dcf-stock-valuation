import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractMdna, filterRelevant, pdfToText } from './mdna.js';
import { generateJson } from './llm.js';
import { MoatJudgement, MoatRating, verifiedQuote } from './qualitative.js';
import { AnnualReportRef } from './reports.js';
import { extractSwotSections, opportunityThreatPassages } from './swot.js';

// Bump when input selection or the prompt changes so stored insights are recomputed.
export const INSIGHTS_VERSION = 2;
// ~5k tokens, so the single request fits free-tier per-minute token limits (Groq ≈ 8k TPM) with room for the answer.
export const MAX_INSIGHTS_INPUT_CHARS = 20_000;
const MAX_OUTLOOK_CHARS = 8_000;
export const MAX_INSIGHT_ITEMS = 4;
const INSIGHTS_MAX_TOKENS = 1500;

export interface InsightItem {
  point: string;
  // Only kept when it appears verbatim in the report text the model saw.
  quote: string | null;
}

export type InsightListKey = 'keyPoints' | 'growthStrategy' | 'tailwinds' | 'headwinds' | 'risks';
export const INSIGHT_LISTS: readonly InsightListKey[] = ['keyPoints', 'growthStrategy', 'tailwinds', 'headwinds', 'risks'];

export interface Insights extends Record<InsightListKey, InsightItem[]> {
  moat: MoatJudgement;
}

export interface ReportInsights {
  year: number;
  source: AnnualReportRef['source'];
  // false when the report had no recognisable MD&A or risk sections
  found: boolean;
  insights: Insights | null;
  createdAt: number;
}

// MD&A passages about results, strategy and competitive position, plus the report's opportunities/threats/risks text.
export function insightsInput(reportText: string, maxChars = MAX_INSIGHTS_INPUT_CHARS): string | null {
  const mdna = extractMdna(reportText);
  const sections = extractSwotSections(mdna ?? reportText);
  const dedicated = [sections.opportunitiesAndThreats, sections.risks].filter((s): s is string => !!s).join('\n\n');
  const outlook = (dedicated || (mdna ? opportunityThreatPassages(mdna, MAX_OUTLOOK_CHARS) : '')).slice(0, MAX_OUTLOOK_CHARS);
  const discussion = mdna ? filterRelevant(mdna, maxChars - outlook.length) : '';
  if (!discussion && !outlook) {
    return null;
  }
  return [
    discussion && `MANAGEMENT DISCUSSION AND ANALYSIS (excerpts):\n${discussion}`,
    outlook && `OPPORTUNITIES, THREATS AND RISKS:\n${outlook}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function insightItems(raw: unknown, source: string): InsightItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: InsightItem[] = [];
  for (const r of raw as Array<{ point?: unknown; quote?: unknown } | string>) {
    const point = typeof r === 'string' ? r.trim() : typeof r?.point === 'string' ? r.point.trim() : '';
    if (!point || out.some((o) => o.point.toLowerCase() === point.toLowerCase())) {
      continue;
    }
    out.push({ point, quote: typeof r === 'string' ? null : verifiedQuote(r?.quote, source) });
    if (out.length >= MAX_INSIGHT_ITEMS) {
      break;
    }
  }
  return out;
}

const asRating = (v: unknown): MoatRating => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'wide' || s === 'narrow' ? s : 'none';
};

export type InsightsJudge = (year: number, text: string) => Promise<Insights>;

export const judgeInsights: InsightsJudge = async (year, text) => {
  const raw = await generateJson<Record<string, any>>(
    `Below are excerpts from a company's FY${year} annual report: its management discussion and analysis and its opportunities, threats and risks.\n` +
      `Summarise them for an investor as lists ranked by importance, most important first, with at most ${MAX_INSIGHT_ITEMS} items each:\n` +
      '- keyPoints: the most important facts about the year\'s performance and business position.\n' +
      '- growthStrategy: how management plans to grow revenue (products, markets, capacity, pricing, acquisitions).\n' +
      '- tailwinds: external factors helping the business.\n' +
      '- headwinds: factors holding the business back now.\n' +
      '- risks: risks an investor in the company should watch.\n' +
      'Each item has a "point" (at most 20 words) and a "quote": one contiguous phrase of 8-30 words copied verbatim from the text (no "..."), supporting the point.\n' +
      'Also judge the economic moat (durable competitive advantage) from the text.\n' +
      'Only include points supported by the text. Use empty lists if nothing qualifies.\n' +
      'Reply as JSON: {"keyPoints":[{"point":"","quote":""}],"growthStrategy":[],"tailwinds":[],"headwinds":[],"risks":[],' +
      '"moat":{"rating":"wide|narrow|none","reasoning":"<2 sentences>","quote":""}}\n\n' +
      text,
    INSIGHTS_MAX_TOKENS
  );
  const moat = raw?.moat ?? {};
  return {
    keyPoints: insightItems(raw?.keyPoints, text),
    growthStrategy: insightItems(raw?.growthStrategy, text),
    tailwinds: insightItems(raw?.tailwinds, text),
    headwinds: insightItems(raw?.headwinds, text),
    risks: insightItems(raw?.risks, text),
    moat: {
      rating: asRating(moat.rating),
      reasoning: typeof moat.reasoning === 'string' ? moat.reasoning.trim() : '',
      quote: verifiedQuote(moat.quote, text),
    },
  };
};

export async function insightsFromReportText(
  year: number,
  reportText: string,
  judge: InsightsJudge = judgeInsights
): Promise<{ found: boolean; insights: Insights | null }> {
  const input = insightsInput(reportText);
  return input ? { found: true, insights: await judge(year, input) } : { found: false, insights: null };
}

// ---- Disk store (a past report's insights never change) -------------------

export function insightsCacheDir(): string {
  return process.env.INSIGHTS_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'insights');
}

const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');
const tickerPrefix = (ticker: string) => `${safe(ticker)}__`;
const modelSuffix = (model: string) => `__${safe(model)}__v${INSIGHTS_VERSION}.json`;
const fileName = (ticker: string, year: number, model: string) => `${tickerPrefix(ticker)}${year}${modelSuffix(model)}`;

async function listCacheFiles(): Promise<string[]> {
  try {
    return await readdir(insightsCacheDir());
  } catch {
    return [];
  }
}

export async function readStoredInsights(ticker: string, year: number, model: string): Promise<ReportInsights | undefined> {
  try {
    return JSON.parse(await readFile(path.join(insightsCacheDir(), fileName(ticker, year, model)), 'utf8')) as ReportInsights;
  } catch {
    return undefined;
  }
}

async function writeStoredInsights(ticker: string, model: string, entry: ReportInsights): Promise<void> {
  const dir = insightsCacheDir();
  const target = path.join(dir, fileName(ticker, entry.year, model));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, target);
  } catch (err: any) {
    console.error(`[insights cache] write failed for ${target}: ${err?.message || err}`);
  }
}

async function storedInsightYears(ticker: string, model: string): Promise<number[]> {
  const prefix = tickerPrefix(ticker);
  const suffix = modelSuffix(model);
  return (await listCacheFiles())
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => Number(f.slice(prefix.length, f.length - suffix.length)))
    .filter((y) => Number.isInteger(y));
}

// Drops every stored result for the year (all models and versions); called when a report is uploaded.
export async function forgetStoredInsights(ticker: string, year: number): Promise<void> {
  const prefix = `${tickerPrefix(ticker)}${year}__`;
  await Promise.all(
    (await listCacheFiles())
      .filter((f) => f.startsWith(prefix))
      .map((f) => unlink(path.join(insightsCacheDir(), f)).catch(() => undefined))
  );
}

// ---- Latest annual report → insights --------------------------------------

export interface ReportInsightsDeps {
  listReports: (ticker: string, count: number) => Promise<AnnualReportRef[]>;
  textOf?: (pdf: Buffer) => Promise<string>;
  judge?: InsightsJudge;
}

export interface ReportInsightsResult {
  entry: ReportInsights | null;
  cached: boolean;
}

const inflight = new Map<string, Promise<ReportInsightsResult>>();

// A stored result is reused unless a fetched-report result is superseded by an upload; LLM failures are not stored.
export async function latestReportInsights(ticker: string, model: string, deps: ReportInsightsDeps): Promise<ReportInsightsResult> {
  const listed = (await deps.listReports(ticker, 1)).sort((a, b) => b.year - a.year)[0];
  const storedLatest = Math.max(-Infinity, ...(await storedInsightYears(ticker, model)));
  if (!listed && !Number.isFinite(storedLatest)) {
    return { entry: null, cached: false };
  }
  if (!listed || storedLatest > listed.year) {
    return { entry: (await readStoredInsights(ticker, storedLatest, model)) ?? null, cached: true };
  }
  const key = fileName(ticker, listed.year, model);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const work = (async (): Promise<ReportInsightsResult> => {
    const stored = await readStoredInsights(ticker, listed.year, model);
    if (stored && !(listed.source === 'upload' && stored.source !== 'upload')) {
      console.log(`[insights cache HIT] ${key}`);
      return { entry: stored, cached: true };
    }
    const started = Date.now();
    const pdf = await listed.load();
    if (!pdf) {
      return { entry: null, cached: false };
    }
    const text = await (deps.textOf ?? pdfToText)(pdf);
    const { found, insights } = await insightsFromReportText(listed.year, text, deps.judge);
    const entry: ReportInsights = { year: listed.year, source: listed.source, found, insights, createdAt: Date.now() };
    console.log(`[insights cache MISS] ${key}: computed in ${Date.now() - started}ms`);
    await writeStoredInsights(ticker, model, entry);
    return { entry, cached: false };
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}
