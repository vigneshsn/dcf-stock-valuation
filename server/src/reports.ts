import { FetchedReportSource, INDIA_REPORTS, ReportProfile } from './reportProfiles.js';
export { parseAnnualReportLinks } from './screener.js';

export interface AnnualReportPdf {
  year: number;
  source: FetchedReportSource | 'upload';
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

// A report we know exists; the PDF is only downloaded when load() is called.
export interface AnnualReportRef {
  year: number;
  source: AnnualReportPdf['source'];
  load: () => Promise<Buffer | null>;
}

// Uploads take precedence over fetched reports for the same year.
export async function listReports(
  ticker: string,
  count = 3,
  fetcher: typeof fetch = fetch,
  profile: ReportProfile = INDIA_REPORTS
): Promise<AnnualReportRef[]> {
  const byYear = new Map<number, AnnualReportRef>();
  for (const r of getUploads(ticker)) {
    byYear.set(r.year, { year: r.year, source: 'upload', load: async () => r.data });
  }
  if (byYear.size < count) {
    for (const f of await profile.list(ticker, count, fetcher)) {
      if (!byYear.has(f.year)) {
        byYear.set(f.year, { year: f.year, source: profile.source, load: f.load });
      }
    }
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year).slice(0, count);
}
