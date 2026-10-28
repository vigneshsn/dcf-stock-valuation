import { passages } from './mdna.js';

// Detects an annual report's opportunities, threats and risks sections, which feed MD&A insights.

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
const MAX_SECTION_CHARS = 15_000;
const MIN_SECTION_CHARS = 300;

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
    let end = Math.min(text.length, ls[i].start + MAX_SECTION_CHARS);
    for (let j = i + 1; j < ls.length && ls[j].start < end; j++) {
      if (isHeading(ls[j].text, ANY_HEADING, ls[j + 1]?.text)) {
        end = ls[j].start;
        break;
      }
    }
    const section = text.slice(ls[i].start, end).trim();
    if (section.length >= MIN_SECTION_CHARS && (!best || section.length > best.length)) {
      best = section;
    }
  }
  return best;
}

export interface OutlookSections {
  // "Opportunities and Threats/Challenges"
  opportunitiesAndThreats: string | null;
  // "Risks and Concerns" / "Risk Management"
  risks: string | null;
}

export function extractOutlookSections(text: string): OutlookSections {
  return { opportunitiesAndThreats: findSection(text, OPP_HEADING), risks: findSection(text, RISK_HEADING) };
}

const OUTLOOK_KEYWORDS = /\b(?:opportunit\w*|tailwinds?|headwinds?|growth drivers?|demand|untapped|potential|risks?|threats?|challeng\w*|competition|competitive|regulat\w*|uncertaint\w*|volatil\w*|disrupt\w*|slowdown|pressure)\b/gi;

// Fallback when no dedicated section exists: MD&A passages that talk about opportunities or risks.
export function outlookPassages(mdna: string, maxChars: number): string {
  const scored = passages(mdna)
    .map((text, index) => ({ text, index, score: text.match(OUTLOOK_KEYWORDS)?.length ?? 0 }))
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
