import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { YearFinancials } from './dcf.js';
import { SUMMARY_CHUNK_CHARS, extractMdna, filterRelevant, passages, pdfToText } from './mdna.js';
import { generateJson } from './ollama.js';
import { verifiedQuote } from './qualitative.js';
import { AnnualReportRef } from './reports.js';

// Bump when section detection or the SWOT prompts change so stored results are recomputed.
export const SWOT_VERSION = 2;
export const MAX_REPORT_ITEMS = 5;

export type SwotSource = 'report' | 'financials';
export type SwotQuadrantKey = 'strengths' | 'weaknesses' | 'opportunities' | 'threats';

export interface SwotItem {
  text: string;
  source: SwotSource;
  // verified quote for report items, "<metric>: <value>" for financials items
  evidence: string;
}

export interface SwotQuadrant {
  items: SwotItem[];
  lowerConfidence: boolean;
}

export type Swot = Record<SwotQuadrantKey, SwotQuadrant>;

// ---- Financials-sourced Strengths / Weaknesses ---------------------------

export interface SwotFinancials {
  roe: number | null;
  roce?: number | null;
  debtToEquity?: number | null;
  history: YearFinancials[];
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Deterministic rules on the latest fiscal year; metrics in the neutral band or missing produce no item.
export function financialSwot(f: SwotFinancials): { year: number | null; strengths: SwotItem[]; weaknesses: SwotItem[] } {
  const strengths: SwotItem[] = [];
  const weaknesses: SwotItem[] = [];
  const add = (list: SwotItem[], text: string, evidence: string) => list.push({ text, source: 'financials', evidence });
  const [latest, prev] = [...f.history].sort((a, b) => b.year - a.year);
  if (!latest) {
    return { year: null, strengths, weaknesses };
  }
  const fy = `FY${latest.year}`;

  if (prev && prev.year === latest.year - 1) {
    const revGrowth = prev.revenue > 0 ? latest.revenue / prev.revenue - 1 : null;
    if (revGrowth != null && revGrowth >= 0.15) {
      add(strengths, `Strong revenue growth of ${pct(revGrowth)} in ${fy}`, `Revenue growth YoY: ${pct(revGrowth)}`);
    } else if (revGrowth != null && revGrowth < 0) {
      add(weaknesses, `Revenue declined ${pct(-revGrowth)} in ${fy}`, `Revenue growth YoY: ${pct(revGrowth)}`);
    }

    const profitGrowth = prev.netIncome > 0 ? latest.netIncome / prev.netIncome - 1 : null;
    if (profitGrowth != null && profitGrowth >= 0.15) {
      add(strengths, `Strong net profit growth of ${pct(profitGrowth)} in ${fy}`, `Net profit growth YoY: ${pct(profitGrowth)}`);
    } else if (profitGrowth != null && profitGrowth < 0) {
      add(weaknesses, `Net profit fell ${pct(-profitGrowth)} in ${fy}`, `Net profit growth YoY: ${pct(profitGrowth)}`);
    }

    if (prev.revenue > 0 && latest.revenue > 0) {
      const [m0, m1] = [prev.netIncome / prev.revenue, latest.netIncome / latest.revenue];
      const evidence = `Net margin: ${pct(m0)} → ${pct(m1)}`;
      if (m1 - m0 >= 0.02) {
        add(strengths, `Net margin expanded in ${fy}`, evidence);
      } else if (m1 - m0 <= -0.02) {
        add(weaknesses, `Net margin contracted in ${fy}`, evidence);
      }
    }
  }

  for (const [label, value] of [['ROE', f.roe], ['ROCE', f.roce]] as const) {
    if (value == null || !Number.isFinite(value)) {
      continue;
    }
    if (value >= 0.18) {
      add(strengths, `High ${label} of ${pct(value)}`, `${label}: ${pct(value)}`);
    } else if (value < 0.1) {
      add(weaknesses, `Low ${label} of ${pct(value)}`, `${label}: ${pct(value)}`);
    }
  }

  const fcf = latest.netIncome + latest.nonCashExpense - latest.capex;
  if (fcf < 0) {
    add(weaknesses, `Negative free cash flow in ${fy}`, `Free cash flow (net income + non-cash − capex): ${fmt(fcf)}`);
  }

  const de = f.debtToEquity;
  if (de != null && Number.isFinite(de)) {
    if (de < 0.3) {
      add(strengths, 'Low leverage', `Debt / equity: ${de.toFixed(2)}`);
    } else if (de > 1) {
      add(weaknesses, 'High leverage', `Debt / equity: ${de.toFixed(2)}`);
    }
  }

  return { year: latest.year, strengths, weaknesses };
}

// ---- Report section detection --------------------------------------------

const OPP_HEADING = /opportunities\s+(?:and|&)\s+(?:threats|challenges)|risks?\s+(?:and|&)\s+opportunities/;
const RISK_HEADING = /(?:threats\s*,\s*)?risks?\s+(?:and|&)\s+concerns|risk\s+management|(?:critical|key|principal|major|material)\s+risks/;
// Other MD&A headings that end a section.
const ANY_HEADING = new RegExp(
  [
    OPP_HEADING.source,
    RISK_HEADING.source,
    'segment[- ]wise',
    'outlook',
    'internal\\s+(?:financial\\s+)?controls?',
    'human\\s+(?:resources?|capital)',
    '(?:discussion\\s+on\\s+)?financial\\s+performance',
    'material\\s+developments',
    'key\\s+financial\\s+ratios',
    'details\\s+of\\s+significant\\s+changes',
    'cautionary\\s+statement',
    'industry\\s+(?:structure|overview)',
    'economic\\s+overview',
  ].join('|')
);
const NUMBERING = /^(?:\d{1,2}(?:\.\d{1,2})*\.?|\(?[a-z]\)|\(?[ivx]{1,4}\)|[ivx]{1,4}\.)\s+/i;
const MAX_HEADING_LINE = 70;
const MAX_SWOT_SECTION_CHARS = 15_000;
const MIN_SWOT_SECTION_CHARS = 300;

interface Line {
  text: string;
  start: number;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    out.push({ text: raw.trim(), start });
    start += raw.length + 1;
  }
  return out;
}

// PDF body text wraps into short lines, so a heading is the bare phrase, a Title-Case line, or a short
// unpunctuated line followed by a line that starts a new sentence (wrapped body text continues in lowercase).
export function isHeading(line: string, phrase: RegExp, next?: string): boolean {
  if (!line || line.length > MAX_HEADING_LINE) {
    return false;
  }
  const body = line.replace(NUMBERING, '').replace(/[:.\s]+$/, '');
  // Table-of-contents entries end with a page number.
  if (/\s\d{1,4}$/.test(body)) {
    return false;
  }
  const m = body.match(new RegExp(`^(?:${phrase.source})`, 'i'));
  if (!m) {
    return false;
  }
  if (m[0].length === body.length) {
    return true;
  }
  if (/[.,;]/.test(body)) {
    return false;
  }
  const words = body.split(/\s+/);
  const titleCase = words.filter((w) => w.length > 3).every((w) => /^[A-Z]/.test(w));
  return titleCase || (words.length <= 8 && /^[A-Z0-9•●▪(“"-]/.test(next?.trim() ?? ''));
}

// Section text from a heading line to the next known heading; the longest candidate wins so table-of-contents hits lose.
function findSection(text: string, heading: RegExp): string | null {
  const ls = lines(text);
  let best: string | null = null;
  for (let i = 0; i < ls.length; i++) {
    if (!isHeading(ls[i].text, heading, ls[i + 1]?.text)) {
      continue;
    }
    let end = Math.min(text.length, ls[i].start + MAX_SWOT_SECTION_CHARS);
    for (let j = i + 1; j < ls.length && ls[j].start < end; j++) {
      if (isHeading(ls[j].text, ANY_HEADING, ls[j + 1]?.text)) {
        end = ls[j].start;
        break;
      }
    }
    const section = text.slice(ls[i].start, end).trim();
    if (section.length >= MIN_SWOT_SECTION_CHARS && (!best || section.length > best.length)) {
      best = section;
    }
  }
  return best;
}

export interface SwotSections {
  // "Opportunities and Threats/Challenges": feeds both Opportunities and Threats
  opportunitiesAndThreats: string | null;
  // "Risks and Concerns" / "Risk Management": feeds Threats
  risks: string | null;
}

export function extractSwotSections(text: string): SwotSections {
  return { opportunitiesAndThreats: findSection(text, OPP_HEADING), risks: findSection(text, RISK_HEADING) };
}

const OT_KEYWORDS = /\b(?:opportunit\w*|tailwinds?|headwinds?|growth drivers?|demand|untapped|potential|risks?|threats?|challeng\w*|competition|competitive|regulat\w*|uncertaint\w*|volatil\w*|disrupt\w*|slowdown|pressure)\b/gi;

// Fallback when no dedicated section exists: MD&A passages that talk about opportunities or risks.
export function opportunityThreatPassages(mdna: string, maxChars = SUMMARY_CHUNK_CHARS): string {
  const scored = passages(mdna)
    .map((text, index) => ({ text, index, score: text.match(OT_KEYWORDS)?.length ?? 0 }))
    .filter((p) => p.score > 0);
  const kept: typeof scored = [];
  let used = 0;
  for (const p of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + p.text.length <= maxChars) {
      kept.push(p);
      used += p.text.length;
    }
  }
  return kept.sort((a, b) => a.index - b.index).map((p) => p.text).join('\n\n');
}

// ---- LLM extraction ------------------------------------------------------

interface RawItem {
  point?: unknown;
  quote?: unknown;
}

// Keep ranked items whose quote appears verbatim in the text the model saw.
export function verifiedItems(raw: unknown, source: string, max = MAX_REPORT_ITEMS): SwotItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SwotItem[] = [];
  for (const r of raw as RawItem[]) {
    const text = typeof r?.point === 'string' ? r.point.trim() : '';
    const quote = verifiedQuote(r?.quote, source);
    if (text && quote && !out.some((o) => o.text.toLowerCase() === text.toLowerCase())) {
      out.push({ text, source: 'report', evidence: quote });
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

const ITEM_RULES =
  'Rank each list by importance, most important first, with at most 5 items per list. ' +
  'Each item has a short point (at most 15 words) and a quote: an exact phrase of 8-30 words copied verbatim from the text that supports the point. ' +
  'Only include points supported by the text. Use empty lists if nothing qualifies.';

async function judgeStrengthsWeaknesses(year: number, text: string) {
  const raw = await generateJson<{ strengths?: unknown; weaknesses?: unknown }>(
    `Below are excerpts from a company's FY${year} annual report management discussion and analysis.\n` +
      'List the company\'s own strengths (competitive advantages, market position, execution) and weaknesses (internal shortcomings, underperforming segments, cost or margin problems). Ignore the general economy.\n' +
      ITEM_RULES +
      '\nReply as JSON: {"strengths":[{"point":"","quote":""}],"weaknesses":[{"point":"","quote":""}]}\n\n' +
      text,
    1200
  );
  return { strengths: verifiedItems(raw.strengths, text), weaknesses: verifiedItems(raw.weaknesses, text) };
}

async function judgeOpportunitiesThreats(year: number, text: string) {
  const raw = await generateJson<{ opportunities?: unknown; threats?: unknown }>(
    `Below are excerpts from a company's FY${year} annual report describing its opportunities, threats, risks and concerns.\n` +
      'List the external opportunities and the threats (including risks and concerns) the company faces.\n' +
      ITEM_RULES +
      '\nReply as JSON: {"opportunities":[{"point":"","quote":""}],"threats":[{"point":"","quote":""}]}\n\n' +
      text,
    1200
  );
  return { opportunities: verifiedItems(raw.opportunities, text), threats: verifiedItems(raw.threats, text) };
}

export interface ReportSwot {
  year: number;
  source: AnnualReportRef['source'];
  // false when the report had no recognisable MD&A or SWOT sections
  found: boolean;
  swot: Swot;
  createdAt: number;
}

export type ReportSwotJudge = {
  strengthsWeaknesses: typeof judgeStrengthsWeaknesses;
  opportunitiesThreats: typeof judgeOpportunitiesThreats;
};

const defaultJudge: ReportSwotJudge = {
  strengthsWeaknesses: judgeStrengthsWeaknesses,
  opportunitiesThreats: judgeOpportunitiesThreats,
};

const emptyQuadrant = (lowerConfidence = false): SwotQuadrant => ({ items: [], lowerConfidence });

export async function swotFromReportText(
  year: number,
  text: string,
  judge: ReportSwotJudge = defaultJudge
): Promise<{ found: boolean; swot: Swot }> {
  const mdna = extractMdna(text);
  const sections = extractSwotSections(mdna ?? text);
  const dedicated = [sections.opportunitiesAndThreats, sections.risks].filter((s): s is string => !!s);
  const otText = dedicated.length ? dedicated.join('\n\n').slice(0, SUMMARY_CHUNK_CHARS) : mdna ? opportunityThreatPassages(mdna) : '';
  const swText = mdna ? filterRelevant(mdna, SUMMARY_CHUNK_CHARS) : '';
  if (!otText && !swText) {
    return {
      found: false,
      swot: { strengths: emptyQuadrant(), weaknesses: emptyQuadrant(), opportunities: emptyQuadrant(), threats: emptyQuadrant() },
    };
  }
  const empty = { strengths: [], weaknesses: [], opportunities: [], threats: [] };
  const [sw, ot] = await Promise.all([
    swText ? judge.strengthsWeaknesses(year, swText) : empty,
    otText ? judge.opportunitiesThreats(year, otText) : empty,
  ]);
  // A Threats quadrant also draws on "Opportunities and Threats", so it is only lower-confidence when neither section exists.
  const opportunitiesFallback = !sections.opportunitiesAndThreats;
  const threatsFallback = !dedicated.length;
  return {
    found: true,
    swot: {
      strengths: { items: sw.strengths, lowerConfidence: false },
      weaknesses: { items: sw.weaknesses, lowerConfidence: false },
      opportunities: { items: ot.opportunities, lowerConfidence: opportunitiesFallback },
      threats: { items: ot.threats, lowerConfidence: threatsFallback },
    },
  };
}

// ---- Disk store (a past report's SWOT never changes) ----------------------

export function swotCacheDir(): string {
  return process.env.SWOT_CACHE_DIR || path.resolve(process.cwd(), '.cache', 'swot');
}

const safe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.-]/g, '_');
const tickerPrefix = (ticker: string) => `${safe(ticker)}__`;
const modelSuffix = (model: string) => `__${safe(model)}__v${SWOT_VERSION}.json`;
const fileName = (ticker: string, year: number, model: string) => `${tickerPrefix(ticker)}${year}${modelSuffix(model)}`;

async function listCacheFiles(): Promise<string[]> {
  try {
    return await readdir(swotCacheDir());
  } catch {
    return [];
  }
}

export async function readStoredSwot(ticker: string, year: number, model: string): Promise<ReportSwot | undefined> {
  try {
    return JSON.parse(await readFile(path.join(swotCacheDir(), fileName(ticker, year, model)), 'utf8')) as ReportSwot;
  } catch {
    return undefined;
  }
}

async function writeStoredSwot(ticker: string, model: string, entry: ReportSwot): Promise<void> {
  const dir = swotCacheDir();
  const target = path.join(dir, fileName(ticker, entry.year, model));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, target);
  } catch (err: any) {
    console.error(`[swot cache] write failed for ${target}: ${err?.message || err}`);
  }
}

export async function storedSwotYears(ticker: string, model: string): Promise<number[]> {
  const prefix = tickerPrefix(ticker);
  const suffix = modelSuffix(model);
  return (await listCacheFiles())
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => Number(f.slice(prefix.length, f.length - suffix.length)))
    .filter((y) => Number.isInteger(y));
}

// Drops every stored SWOT for the year (all models and versions); called when a report is uploaded.
export async function forgetStoredSwot(ticker: string, year: number): Promise<void> {
  const prefix = `${tickerPrefix(ticker)}${year}__`;
  await Promise.all(
    (await listCacheFiles())
      .filter((f) => f.startsWith(prefix))
      .map((f) => unlink(path.join(swotCacheDir(), f)).catch(() => undefined))
  );
}

// ---- Latest annual report → SWOT ------------------------------------------

export interface ReportSwotDeps {
  listReports: (ticker: string, count: number) => Promise<AnnualReportRef[]>;
  textOf?: (pdf: Buffer) => Promise<string>;
  judge?: ReportSwotJudge;
}

export interface ReportSwotResult {
  entry: ReportSwot | null;
  cached: boolean;
}

const inflight = new Map<string, Promise<ReportSwotResult>>();

// SWOT for the Latest annual report; a stored result is reused unless a fetched-report result is superseded by an upload.
export async function latestReportSwot(ticker: string, model: string, deps: ReportSwotDeps): Promise<ReportSwotResult> {
  const refs = await deps.listReports(ticker, 3);
  const listed = [...refs].sort((a, b) => b.year - a.year)[0];
  const storedLatest = Math.max(-Infinity, ...(await storedSwotYears(ticker, model)));
  if (!listed && !Number.isFinite(storedLatest)) {
    return { entry: null, cached: false };
  }
  if (!listed || storedLatest > listed.year) {
    return { entry: (await readStoredSwot(ticker, storedLatest, model)) ?? null, cached: true };
  }
  const key = fileName(ticker, listed.year, model);
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const work = (async (): Promise<ReportSwotResult> => {
    const stored = await readStoredSwot(ticker, listed.year, model);
    if (stored && !(listed.source === 'upload' && stored.source !== 'upload')) {
      console.log(`[swot cache HIT] ${key}`);
      return { entry: stored, cached: true };
    }
    const started = Date.now();
    const pdf = await listed.load();
    if (!pdf) {
      return { entry: null, cached: false };
    }
    const text = await (deps.textOf ?? pdfToText)(pdf);
    const { found, swot } = await swotFromReportText(listed.year, text, deps.judge);
    const entry: ReportSwot = { year: listed.year, source: listed.source, found, swot, createdAt: Date.now() };
    console.log(`[swot cache MISS] ${key}: computed in ${Date.now() - started}ms`);
    await writeStoredSwot(ticker, model, entry);
    return { entry, cached: false };
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

// Report items first (ranked by the model), then financials items.
export function mergeSwot(report: Swot | null, financials: { strengths: SwotItem[]; weaknesses: SwotItem[] }): Swot {
  const r = report ?? { strengths: emptyQuadrant(), weaknesses: emptyQuadrant(), opportunities: emptyQuadrant(), threats: emptyQuadrant() };
  return {
    strengths: { items: [...r.strengths.items, ...financials.strengths], lowerConfidence: r.strengths.lowerConfidence },
    weaknesses: { items: [...r.weaknesses.items, ...financials.weaknesses], lowerConfidence: r.weaknesses.lowerConfidence },
    opportunities: r.opportunities,
    threats: r.threats,
  };
}
