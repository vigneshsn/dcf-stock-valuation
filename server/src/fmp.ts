const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

export class FmpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function fmpGet<T>(
  path: string,
  ticker: string,
  extraParams: Record<string, string | number> = {}
): Promise<T> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    throw new FmpError('FMP_API_KEY is not configured', 500);
  }
  const params = new URLSearchParams({ symbol: ticker, apikey: apiKey });
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, String(v));
  }
  const response = await fetch(`${FMP_BASE_URL}${path}?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new FmpError(`FMP request failed (${response.status}) for ${path}: ${body}`, response.status);
  }
  return (await response.json()) as T;
}
