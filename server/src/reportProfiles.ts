import { downloadEdgarFiling, listEdgarFilings } from './edgar.js';
import { extractMdna } from './mdna.js';
import { extractOutlookSections } from './reportSections.js';
import { downloadReportPdf, listScreenerReports } from './screener.js';
import { extractTenKSections } from './secSections.js';

export type FetchedReportSource = 'screener' | 'edgar';

export interface ListedReport {
  year: number;
  load: () => Promise<Buffer | null>;
}

// The report text the LLM steps read from.
export interface ReportSections {
  mdna: string | null;
  // Company and competition description (Item 1 of a 10-K); not every edition's reports have one.
  business: string | null;
  // The report's dedicated opportunities, threats and risks text; empty when it has none.
  outlook: string;
}

// Everything that differs between Market editions' annual reports: where they come from and where their sections are.
export interface ReportProfile {
  source: FetchedReportSource;
  list: (ticker: string, count: number, fetcher: typeof fetch) => Promise<ListedReport[]>;
  locate: (reportText: string) => ReportSections;
}

export const INDIA_REPORTS: ReportProfile = {
  source: 'screener',
  async list(ticker, count, fetcher) {
    return (await listScreenerReports(ticker, count, fetcher)).map((l) => ({ year: l.year, load: () => downloadReportPdf(l.url, fetcher) }));
  },
  locate(text) {
    const mdna = extractMdna(text);
    const sections = extractOutlookSections(mdna ?? text);
    return { mdna, business: null, outlook: [sections.opportunitiesAndThreats, sections.risks].filter((s): s is string => !!s).join('\n\n') };
  },
};

export const US_REPORTS: ReportProfile = {
  source: 'edgar',
  async list(ticker, count, fetcher) {
    return (await listEdgarFilings(ticker, count, fetcher)).map((f) => ({ year: f.year, load: () => downloadEdgarFiling(f.url, fetcher) }));
  },
  locate(text) {
    const { mdna, business, risks } = extractTenKSections(text);
    return { mdna, business, outlook: risks ?? '' };
  },
};

export function reportProfile(edition: 'india' | 'us'): ReportProfile {
  return edition === 'us' ? US_REPORTS : INDIA_REPORTS;
}
