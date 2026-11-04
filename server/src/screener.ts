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

// Best effort: failures return [] so the caller falls back to upload or cached summaries.
export async function listScreenerReports(ticker: string, count = 3, fetcher: typeof fetch = fetch): Promise<Array<{ year: number; url: string }>> {
  const slug = screenerSlug(ticker);
  if (!slug) {
    return [];
  }
  try {
    const pageRes = await fetcher(`https://www.screener.in/company/${encodeURIComponent(slug)}/consolidated/`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pageRes.ok) {
      return [];
    }
    return parseAnnualReportLinks(await pageRes.text()).slice(0, count);
  } catch {
    return [];
  }
}

export async function downloadReportPdf(url: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const pdfRes = await fetcher(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(120_000) });
    if (!pdfRes.ok) {
      return null;
    }
    const data = Buffer.from(await pdfRes.arrayBuffer());
    return data.subarray(0, 5).toString() === '%PDF-' ? data : null;
  } catch {
    return null;
  }
}

