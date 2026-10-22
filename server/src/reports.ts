export interface AnnualReportPdf {
  year: number;
  source: 'screener' | 'upload';
  data: Buffer;
}

const uploads = new Map<string, Map<number, AnnualReportPdf>>();

export function saveUpload(ticker: string, year: number, data: Buffer): void {
  const key = ticker.toUpperCase();
  if (!uploads.has(key)) {
    uploads.set(key, new Map());
  }
  uploads.get(key)!.set(year, { year, source: 'upload', data });
}

export function getUploads(ticker: string): AnnualReportPdf[] {
  return [...(uploads.get(ticker.toUpperCase())?.values() ?? [])];
}

const BROWSER_UA = 'Mozilla/5.0';

// "RELIANCE.NS" / "RELIANCE.BO" / "500325" -> Screener company slug
function screenerSlug(ticker: string): string | null {
  const m = ticker.toUpperCase().match(/^([A-Z0-9&-]+?)(?:\.(?:NS|BO))?$/);
  return m ? m[1] : null;
}

// Report PDFs are linked from the company page, newest first. Fiscal year is the 4-digit year in the link text.
export function parseAnnualReportLinks(html: string): Array<{ year: number; url: string }> {
  const out: Array<{ year: number; url: string }> = [];
  const start = html.search(/<h3>\s*Annual reports\s*<\/h3>/i);
  if (start < 0) {
    return out;
  }
  const rest = html.slice(start);
  const end = rest.indexOf('</ul>');
  const list = end < 0 ? rest : rest.slice(0, end);
  for (const m of list.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const year = Number(m[2].match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (Number.isFinite(year) && !out.some((o) => o.year === year)) {
      out.push({ year, url: m[1].replace(/&amp;/g, '&') });
    }
  }
  return out;
}

// Best effort: failures return [] so the caller falls back to upload.
export async function fetchAnnualReports(ticker: string, count = 3): Promise<AnnualReportPdf[]> {
  const slug = screenerSlug(ticker);
  if (!slug) {
    return [];
  }
  try {
    const pageRes = await fetch(`https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageRes.ok) {
      return [];
    }
    const links = parseAnnualReportLinks(await pageRes.text()).slice(0, count);
    const reports: AnnualReportPdf[] = [];
    for (const link of links) {
      const pdfRes = await fetch(link.url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(120_000) });
      if (!pdfRes.ok) {
        continue;
      }
      const data = Buffer.from(await pdfRes.arrayBuffer());
      if (data.subarray(0, 5).toString() === '%PDF-') {
        reports.push({ year: link.year, source: 'screener', data });
      }
    }
    return reports;
  } catch {
    return [];
  }
}

// Uploads take precedence over fetched reports for the same year.
export async function acquireReports(ticker: string, count = 3): Promise<AnnualReportPdf[]> {
  const byYear = new Map<number, AnnualReportPdf>();
  for (const r of getUploads(ticker)) {
    byYear.set(r.year, r);
  }
  if (byYear.size < count) {
    for (const r of await fetchAnnualReports(ticker, count)) {
      if (!byYear.has(r.year)) {
        byYear.set(r.year, r);
      }
    }
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year).slice(0, count);
}
