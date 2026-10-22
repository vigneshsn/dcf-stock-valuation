import { PDFParse } from 'pdf-parse';
import { generate } from './ollama.js';

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

export function chunkText(text: string, size = 4000): string[] {
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
export async function summariseMdna(section: string): Promise<MdnaSummary> {
  const chunks = chunkText(section);
  const parts: string[] = [];
  for (const chunk of chunks) {
    parts.push(
      await generate(
        'Summarise this excerpt of a company annual report\'s management discussion and analysis in at most 120 words. ' +
          'Keep concrete facts: guidance, targets, market position, competitive strengths, and actual results. ' +
          'Keep short exact phrases from the text in double quotes where they support a claim.\n\n' +
          chunk
      )
    );
  }
  return { chunkCount: chunks.length, summary: parts.join('\n\n'), excerpt: section.slice(0, 1500) };
}
