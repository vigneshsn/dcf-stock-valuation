import { FetchedReportSource, INDIA_REPORTS, ReportProfile } from './reportProfiles.js';
export { parseAnnualReportLinks } from './screener.js';

export interface AnnualReportPdf {
  year: number;
  source: FetchedReportSource;
  data: Buffer;
}

// A report we know exists; the PDF is only downloaded when load() is called.
export interface AnnualReportRef {
  year: number;
  source: AnnualReportPdf['source'];
  load: () => Promise<Buffer | null>;
}

export async function listReports(
  ticker: string,
  count = 3,
  fetcher: typeof fetch = fetch,
  profile: ReportProfile = INDIA_REPORTS
): Promise<AnnualReportRef[]> {
  const byYear = new Map<number, AnnualReportRef>();
  for (const f of await profile.list(ticker, count, fetcher)) {
    byYear.set(f.year, { year: f.year, source: profile.source, load: f.load });
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year).slice(0, count);
}
