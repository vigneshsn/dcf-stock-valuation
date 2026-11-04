// Locates the sections of a US 10-K that feed MD&A insights and the Guidance scorecard, by SEC item number.

const MAX_MDNA_CHARS = 120_000;
const MAX_RISK_CHARS = 60_000;
const MAX_BUSINESS_CHARS = 60_000;
const MIN_SECTION_CHARS = 1500;
// Real headings are short; longer lines are body text that happens to start with "Item 7".
const MAX_HEADING_CHARS = 200;

const ITEM_1 = /^item\s*1\s*[.:\-–—]?\s*business/i;
const ITEM_1_END = /^item\s*1a\s*[.:\-–—]?\s*\S/i;
const ITEM_7 = /^item\s*7\s*[.:\-–—]?\s*management/i;
const ITEM_7_END = /^item\s*(?:7a|8)\s*[.:\-–—]?\s*\S/i;
const ITEM_1A = /^item\s*1a\s*[.:\-–—]?\s*risk\s+factors/i;
const ITEM_1A_END = /^item\s*(?:1b|1c|2)\s*[.:\-–—]?\s*\S/i;
// Filings laid out in table cells or separate blocks put the item number and its title on consecutive lines.
const BARE_ITEM = /^item\s*\d+[a-c]?\s*[.:\-–—]?$/i;

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|ix:header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// The table of contents lists the same headings, so the longest candidate wins.
function section(text: string, start: RegExp, end: RegExp, maxChars: number): string | null {
  const lines = text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const headingAt = (i: number): string => {
    const line = lines[i].trim();
    return BARE_ITEM.test(line) && lines[i + 1] ? `${line} ${lines[i + 1].trim()}` : line;
  };
  const matches = (i: number, re: RegExp) => {
    const heading = headingAt(i);
    return heading.length <= MAX_HEADING_CHARS && re.test(heading);
  };
  let best: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!matches(i, start)) {
      continue;
    }
    let stop = Math.min(text.length, offsets[i] + maxChars);
    for (let j = i + 1; j < lines.length && offsets[j] < stop; j++) {
      if (matches(j, end)) {
        stop = offsets[j];
        break;
      }
    }
    const candidate = text.slice(offsets[i], stop).trim();
    if (candidate.length >= MIN_SECTION_CHARS && (!best || candidate.length > best.length)) {
      best = candidate;
    }
  }
  return best;
}

export interface TenKSections {
  business: string | null;
  risks: string | null;
  mdna: string | null;
}

export function extractTenKSections(text: string): TenKSections {
  return {
    business: section(text, ITEM_1, ITEM_1_END, MAX_BUSINESS_CHARS),
    risks: section(text, ITEM_1A, ITEM_1A_END, MAX_RISK_CHARS),
    mdna: section(text, ITEM_7, ITEM_7_END, MAX_MDNA_CHARS),
  };
}
