const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

export class FmpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function fmpGet<T>(
  path: string,
  ticker: string,
  extraParams: Record<string, string | number> = {},
  fetcher: typeof fetch = fetch
): Promise<T> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new FmpError('FMP_API_KEY is not configured', 500);
  }
  const params = new URLSearchParams({ symbol: ticker, apikey: apiKey });
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, String(v));
  }
  const response = await fetcher(`${FMP_BASE_URL}${path}?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new FmpError(`FMP request failed (${response.status}) for ${path}: ${body}`, response.status);
  }
  return (await response.json()) as T;
}

/** The company's own fiscal-year label (FMP fiscalYear), e.g. 2025 for Apple's year ending September 2025. */
export function fmpFiscalYear(row: { fiscalYear?: string | number; calendarYear?: string | number; date?: string }): number | null {
  const year = Number(row.fiscalYear ?? row.calendarYear ?? row.date?.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}
