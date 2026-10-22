import { generateJson } from './ollama.js';

export type MoatRating = 'wide' | 'narrow' | 'none';
export type GuidanceOutcome = 'met' | 'partly' | 'missed';

export interface Peer {
  symbol: string;
  name: string;
  marketCap: number | null;
}

export interface YearSummary {
  year: number;
  summary: string;
  excerpt: string;
}

export interface MoatJudgement {
  rating: MoatRating;
  reasoning: string;
  quote: string | null;
}

export interface GuidanceComparison {
  guidanceYear: number;
  actualsYear: number;
  outcome: GuidanceOutcome;
  reasoning: string;
  quote: string | null;
}

export interface ManagementJudgement {
  comparisons: GuidanceComparison[];
  lowerConfidence: boolean;
}

export interface QualitativeScore {
  score: 1 | 2 | 3 | 4 | 5;
  experimental: true;
  explanation: string;
  quotes: string[];
}

const MOAT_POINTS: Record<MoatRating, number> = { wide: 5, narrow: 3, none: 1 };
const OUTCOME_POINTS: Record<GuidanceOutcome, number> = { met: 5, partly: 3, missed: 1 };

// Choose the 3-5 companies closest in market cap to the target.
export function selectPeers(target: Peer, candidates: Peer[]): Peer[] {
  const seen = new Set<string>([target.symbol]);
  const unique = candidates.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
  if (target.marketCap == null) {
    return unique.slice(0, 5);
  }
  const distance = (p: Peer) => (p.marketCap == null ? Infinity : Math.abs(p.marketCap - target.marketCap!));
  return [...unique].sort((a, b) => distance(a) - distance(b)).slice(0, 5);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Keep a quote only if it appears verbatim in the report text we gave the model.
export function verifiedQuote(quote: unknown, source: string): string | null {
  if (typeof quote !== 'string' || quote.trim().length < 8) {
    return null;
  }
  return norm(source).includes(norm(quote)) ? quote.trim() : null;
}

const asRating = (v: unknown): MoatRating => (v === 'wide' || v === 'narrow' ? v : 'none');
const asOutcome = (v: unknown): GuidanceOutcome => (v === 'met' || v === 'partly' ? v : 'missed');

export async function judgeMoat(latest: YearSummary, peers: Peer[]): Promise<MoatJudgement> {
  const peerList = peers.length ? peers.map((p) => p.name || p.symbol).join(', ') : 'no peers available';
  const raw = await generateJson<{ rating?: string; reasoning?: string; quote?: string }>(
    'You assess a company\'s economic moat (durable competitive advantage) from its annual report summary, relative to industry peers.\n' +
      `Peers: ${peerList}\n\nManagement discussion summary (${latest.year}):\n${latest.summary}\n\n` +
      'Reply as JSON: {"rating":"wide|narrow|none","reasoning":"<2 sentences>","quote":"<exact phrase copied from the summary supporting the rating>"}'
  );
  return {
    rating: asRating(raw.rating),
    reasoning: String(raw.reasoning ?? ''),
    quote: verifiedQuote(raw.quote, latest.summary + latest.excerpt),
  };
}

// summaries are ordered newest first; each year's guidance is compared with the next year's actuals
export async function judgeManagement(summaries: YearSummary[]): Promise<ManagementJudgement> {
  const ordered = [...summaries].sort((a, b) => a.year - b.year);
  const comparisons: GuidanceComparison[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const prior = ordered[i];
    const next = ordered[i + 1];
    const raw = await generateJson<{ outcome?: string; reasoning?: string; quote?: string }>(
      `Management guidance from the ${prior.year} annual report:\n${prior.summary}\n\n` +
        `Actual results reported in the ${next.year} annual report:\n${next.summary}\n\n` +
        'Did actual results match the guidance? Reply as JSON: {"outcome":"met|partly|missed","reasoning":"<2 sentences>","quote":"<exact phrase copied from the text above>"}'
    );
    comparisons.push({
      guidanceYear: prior.year,
      actualsYear: next.year,
      outcome: asOutcome(raw.outcome),
      reasoning: String(raw.reasoning ?? ''),
      quote: verifiedQuote(raw.quote, prior.summary + next.summary + prior.excerpt + next.excerpt),
    });
  }
  return { comparisons, lowerConfidence: summaries.length < 3 };
}

export function qualitativeScore(moat: MoatJudgement, management: ManagementJudgement): QualitativeScore {
  const moatPts = MOAT_POINTS[moat.rating];
  const mgmtPts = management.comparisons.length
    ? management.comparisons.reduce((s, c) => s + OUTCOME_POINTS[c.outcome], 0) / management.comparisons.length
    : null;
  const combined = mgmtPts == null ? moatPts : (moatPts + mgmtPts) / 2;
  const score = Math.min(5, Math.max(1, Math.round(combined))) as QualitativeScore['score'];

  const quotes = [moat.quote, ...management.comparisons.map((c) => c.quote)].filter((q): q is string => !!q);
  const lines = [
    `Moat: ${moat.rating}. ${moat.reasoning}`.trim(),
    ...management.comparisons.map(
      (c) => `Guidance ${c.guidanceYear} vs actuals ${c.actualsYear}: ${c.outcome}. ${c.reasoning}`.trim()
    ),
  ];
  if (mgmtPts == null) {
    lines.push('Management trustworthiness could not be judged (fewer than 2 annual reports); the score reflects Moat only.');
  }
  if (management.lowerConfidence) {
    lines.push('Lower confidence: fewer than 3 years of annual reports were available.');
  }
  lines.push(quotes.length ? `Evidence quoted from the report: ${quotes.map((q) => `"${q}"`).join('; ')}` : 'No verbatim evidence could be verified in the report text.');
  return { score, experimental: true, explanation: lines.join('\n'), quotes };
}
