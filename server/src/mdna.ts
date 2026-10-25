import { PDFParse } from 'pdf-parse';
import { generate } from './llm.js';

const START = /management(?:['’]s)?\s+discussion\s+(?:and|&)\s+analysis/gi;
const END = /(?:directors['’]?\s+report|report\s+on\s+corporate\s+governance|corporate\s+governance\s+report|business\s+responsibility|independent\s+auditor['’]?s?\s+report|notice\s+of\s+(?:the\s+)?annual\s+general)/gi;
const MAX_SECTION_CHARS = 120_000;
const MIN_SECTION_CHARS = 1500;

export async function pdfToText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

// Table-of-contents hits are short, so the longest candidate section wins.
export function extractMdna(text: string): string | null {
  let best: string | null = null;
  for (const m of text.matchAll(START)) {
    const from = m.index ?? 0;
    const rest = text.slice(from, from + MAX_SECTION_CHARS);
    let end = rest.length;
    for (const e of rest.slice(m[0].length).matchAll(END)) {
      end = m[0].length + (e.index ?? 0);
      break;
    }
    const section = rest.slice(0, end).trim();
    if (section.length >= MIN_SECTION_CHARS && (!best || section.length > best.length)) {
      best = section;
    }
  }
  return best;
}

// ~3k tokens per chunk; fits the configured num_ctx with room for the prompt and the summary.
export const SUMMARY_CHUNK_CHARS = 12_000;
// Upper bound on MD&A text summarised per year (≈3 chunks) so latency stays predictable.
export const MAX_FILTERED_CHARS = 30_000;
const PASSAGE_CHARS = 600;

const GUIDANCE = /\b(?:guidance|outlook|going forward|in the coming (?:year|years|quarters)|we (?:expect|anticipate|aim|plan|intend|target|will|remain confident)|targets?|targeted|on track|medium[- ]term|long[- ]term|next (?:year|financial year|fiscal))\b/gi;
const MOAT = /\b(?:market (?:share|leader|leadership|position)|leadership|leading|competitive|competition|competitors?|brand|pricing power|distribution|dealers?|network|moat|differentiat\w*|innovation|new products?|launch(?:ed|es)?|capacity|capex|expansion|order book)\b/gi;
const RESULTS = /\b(?:revenue|sales|volume|value growth|grew|growth|declined?|margins?|ebitda|ebit|pat|profit(?:ability)?|earnings|return on|roce|roe|market share)\b/gi;
const COMPANY = /\b(?:[Ww]e|[Oo]ur|the [Cc]ompany|[Cc]ompany['’]s|the [Gg]roup)\b/;
const MACRO = /\b(?:gdp|global economy|world economy|economic growth|inflation|monetary|central bank|federal reserve|imf|world bank|geopolitic\w*|fiscal deficit|repo rate|interest rates?|crude oil)\b/i;
const BOILERPLATE = /\b(?:energy consumption|emissions?|greenhouse|ghg|scope [123]|water (?:consumption|withdrawal)|waste|renewable energy|csr|corporate social|internal (?:financial )?controls?|human resources?|occupational|health and safety|cautionary statement|forward[- ]looking statements|ind as|restated)\b/i;

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

function passageScore(p: string): number {
  const nonSpace = p.replace(/\s/g, '');
  // Table rows and ten-year reviews are mostly digits.
  if (!nonSpace.length || (nonSpace.match(/[a-z]/gi)?.length ?? 0) / nonSpace.length < 0.55) {
    return 0;
  }
  const company = COMPANY.test(p);
  if ((MACRO.test(p) || BOILERPLATE.test(p)) && !company) {
    return 0;
  }
  const guidance = count(GUIDANCE, p);
  const score = 3 * guidance + 2 * count(MOAT, p) + count(RESULTS, p);
  if (BOILERPLATE.test(p) && guidance === 0) {
    return 0;
  }
  return score;
}

// PDF text arrives as short column-wrapped lines with few blank lines, so reflow into sentences and score ~600-char passages.
export function passages(section: string): string[] {
  const flat = section
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, ' ')
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = flat.split(/(?<=[.!?])\s+(?=["“‘(]?[A-Z0-9₹])/);
  const out: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length > PASSAGE_CHARS) {
      out.push(current);
      current = '';
    }
    current = current ? `${current} ${s}` : s;
  }
  if (current) {
    out.push(current);
  }
  return out;
}

// Keep the passages most likely to inform Moat and guidance-vs-actuals; drop macro commentary, ESG metrics and tables.
// Falls back to the raw section when the filter finds too little, so unusual layouts still get summarised.
export function filterRelevant(section: string, maxChars = MAX_FILTERED_CHARS): string {
  const scored = passages(section).map((text, index) => ({ text, index, score: passageScore(text) }));
  const relevant = scored.filter((p) => p.score > 0);
  const total = relevant.reduce((s, p) => s + p.text.length, 0);
  if (total < Math.min(3000, section.length * 0.1)) {
    return section.slice(0, maxChars);
  }
  let kept = relevant;
  if (total > maxChars) {
    kept = [];
    let used = 0;
    for (const p of [...relevant].sort((a, b) => b.score / b.text.length - a.score / a.text.length)) {
      if (used + p.text.length <= maxChars) {
        kept.push(p);
        used += p.text.length;
      }
    }
    kept.sort((a, b) => a.index - b.index);
  }
  let out = '';
  for (let i = 0; i < kept.length; i++) {
    const sep = i === 0 ? '' : kept[i].index === kept[i - 1].index + 1 ? ' ' : '\n\n';
    out += sep + kept[i].text;
  }
  return out;
}

export function chunkText(text: string, size = SUMMARY_CHUNK_CHARS): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length > size) {
      chunks.push(current);
      current = '';
    }
    let piece = p;
    while (piece.length > size) {
      chunks.push(piece.slice(0, size));
      piece = piece.slice(size);
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current.trim()) {
    chunks.push(current);
  }
  return chunks;
}

export interface MdnaSummary {
  chunkCount: number;
  summary: string;
  excerpt: string;
}

// Summarise each chunk, then judge from the joined summaries (reports exceed the model's context window).
// Chunks run concurrently; generate() caps how many hit the LLM at once.
export async function summariseMdna(section: string): Promise<MdnaSummary> {
  const chunks = chunkText(filterRelevant(section));
  const parts = await Promise.all(
    chunks.map((chunk) =>
      generate(
        'Summarise these excerpts of a company annual report\'s management discussion and analysis in at most 200 words. ' +
          'Keep concrete facts: guidance, targets, market position, competitive strengths, and actual results. ' +
          'Keep short exact phrases from the text in double quotes where they support a claim.\n\n' +
          chunk,
        { maxTokens: 400 }
      )
    )
  );
  return { chunkCount: chunks.length, summary: parts.join('\n\n'), excerpt: section.slice(0, 1500) };
}
