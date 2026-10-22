import { calculateAnnualReturns, mapAnnualStatements } from './finance.js';

const DEFAULT_INDIANAPI_URL = 'https://stock.indianapi.in';
const LIVEMINT_URL = 'https://www.livemint.com';

type JsonRecord = Record<string, unknown>;

export interface CompanyIntroduction {
  name: string;
  industry: string | null;
  description: string | null;
}

export interface StockNewsItem {
  headline: string;
  publishedAt: string;
  source: string | null;
  url: string;
}

export interface StockPeer {
  name: string;
  price: number | null;
  marketCap: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  roe: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  dividendYield: number | null;
}

export interface AnalystConsensus {
  source: 'IndianAPI';
  recommendation: string | null;
  counts: {
    strongBuy: number | null;
    buy: number | null;
    hold: number | null;
    sell: number | null;
    strongSell: number | null;
  };
}

export interface StockData {
  marketCap: number | null;
  currentPrice: number | null;
  week52High: number | null;
  week52Low: number | null;
  peRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  roce: number | null;
  roe: number | null;
  companyIntroduction: CompanyIntroduction | null;
  news: StockNewsItem[];
  peers: StockPeer[];
  analystConsensus: AnalystConsensus | null;
}

export class IndianApiError extends Error {}

export class StockNotFoundError extends Error {}

function record(value: unknown): JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, '').replace(/%$/, ''));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function comparableName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

// IndianAPI encodes metric groups and statements as [{ key, value }] lists.
function keyedValues(value: unknown): JsonRecord {
  if (!Array.isArray(value)) {
    return {};
  }
  const values: JsonRecord = {};
  for (const entry of value) {
    const item = record(entry);
    const key = stringValue(item.key);
    if (key && !(key in values)) {
      values[key] = item.value;
    }
  }
  return values;
}

function annualReturns(financials: unknown): { roce: number | null; roe: number | null } {
  const annualRows = (Array.isArray(financials) ? financials : [])
    .map(record)
    .filter((row) => stringValue(row.Type)?.toLowerCase() === 'annual');
  const fiscalYear = (row: JsonRecord): number | null => {
    const year = numberValue(row.FiscalYear);
    return year != null && Number.isInteger(year) ? year : null;
  };
  const statement = (row: JsonRecord, type: string): JsonRecord => keyedValues(record(row.stockFinancialMap)[type]);

  const annualIncome = mapAnnualStatements(annualRows, fiscalYear, (row) => {
    const income = statement(row, 'INC');
    return {
      ebit: numberValue(income.OperatingIncome),
      netIncome: numberValue(income.NetIncome),
    };
  });
  const annualBalance = mapAnnualStatements(annualRows, fiscalYear, (row) => {
    const balance = statement(row, 'BAL');
    return {
      totalAssets: numberValue(balance.TotalAssets),
      totalCurrentLiabilities: numberValue(balance.TotalCurrentLiabilities),
      totalStockholdersEquity: numberValue(balance.TotalEquity),
    };
  });
  return calculateAnnualReturns(annualIncome, annualBalance);
}

function normalizeNews(value: unknown): StockNewsItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items = value.flatMap((entry) => {
    const article = record(entry);
    const headline = stringValue(article.headline, article.title);
    const publishedAt = stringValue(article.publishedAt, article.pub_date, article.publishDate, article.date);
    const rawUrl = stringValue(article.url, article.link);
    if (!headline || !publishedAt || !Number.isFinite(Date.parse(publishedAt)) || !rawUrl) {
      return [];
    }

    let url: URL;
    try {
      if (/^https?:\/\//i.test(rawUrl)) {
        url = new URL(rawUrl);
      } else if (!/^[a-z][a-z\d+.-]*:/i.test(rawUrl) && !rawUrl.startsWith('//')) {
        url = new URL(rawUrl, LIVEMINT_URL);
      } else {
        return [];
      }
    } catch {
      return [];
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return [];
    }

    return [{
      headline,
      publishedAt,
      source: stringValue(article.source),
      url: url.toString(),
    }];
  });

  return items
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 5);
}

function normalizePeers(value: unknown): StockPeer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => ({ peer: record(entry), index }))
    .map(({ peer, index }) => ({
      index,
      marketCap: numberValue(peer.marketCap, peer.mktCap),
      value: {
        name: stringValue(peer.companyName, peer.name, peer.company, peer.symbol) ?? '',
        price: numberValue(peer.price, record(peer.currentPrice).NSE),
        marketCap: numberValue(peer.marketCap, peer.mktCap),
        peRatio: numberValue(peer.priceToEarningsValueRatio, peer.peRatio, peer.pe),
        pbRatio: numberValue(peer.priceToBookValueRatio, peer.pbRatio, peer.pb),
        roe: numberValue(peer.returnOnAverageEquityTrailing12Month, peer.returnOnEquityTTM),
        debtToEquity: numberValue(peer.ltDebtPerEquityMostRecentFiscalYear, peer.debtToEquity),
        profitMargin: numberValue(peer.netProfitMarginPercentTrailing12Month, peer.netProfitMarginTTM),
        dividendYield: numberValue(peer.dividendYieldIndicatedAnnualDividend, peer.dividendYield),
      },
    }))
    .filter(({ value }) => value.name.length > 0)
    .sort((a, b) => {
      if (a.marketCap == null && b.marketCap != null) return 1;
      if (a.marketCap != null && b.marketCap == null) return -1;
      if (a.marketCap != null && b.marketCap != null && a.marketCap !== b.marketCap) {
        return b.marketCap - a.marketCap;
      }
      return a.index - b.index;
    })
    .slice(0, 5)
    .map(({ value }) => value);
}

const RATING_KEYS: Record<string, keyof AnalystConsensus['counts']> = {
  strongbuy: 'strongBuy',
  buy: 'buy',
  hold: 'hold',
  sell: 'sell',
  strongsell: 'strongSell',
};

function ratingKey(item: JsonRecord): keyof AnalystConsensus['counts'] | null {
  const label = stringValue(item.ratingName)?.toLowerCase().replace(/[\s_-]+/g, '');
  return label ? RATING_KEYS[label] ?? null : null;
}

function normalizeConsensus(
  analystView: unknown,
  recosBar: unknown,
  averageRating: unknown
): AnalystConsensus | null {
  const bar = record(recosBar);
  if (bar.isDataPresent === false) {
    return null;
  }
  const barRatings = Array.isArray(bar.stockAnalyst) ? bar.stockAnalyst.map(record) : [];
  const viewRatings = Array.isArray(analystView) ? analystView.map(record) : [];
  const counts: AnalystConsensus['counts'] = {
    strongBuy: null,
    buy: null,
    hold: null,
    sell: null,
    strongSell: null,
  };
  for (const [ratings, countKey] of [[barRatings, 'numberOfAnalysts'], [viewRatings, 'numberOfAnalystsLatest']] as const) {
    for (const item of ratings) {
      const key = ratingKey(item);
      if (key && counts[key] == null) {
        counts[key] = numberValue(item[countKey]);
      }
    }
  }

  const tickerRating = numberValue(bar.tickerRatingValue);
  const recommendation = stringValue(
    barRatings.find((item) => tickerRating != null && numberValue(item.ratingValue) === tickerRating)?.ratingName,
    averageRating
  );
  if (!recommendation && Object.values(counts).every((count) => count == null)) {
    return null;
  }
  return { source: 'IndianAPI', recommendation, counts };
}

export async function fetchIndianApiStock(
  ticker: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  baseUrl: string = process.env.INDIANAPI_BASE_URL || DEFAULT_INDIANAPI_URL
): Promise<StockData> {
  if (!apiKey) {
    throw new IndianApiError('INDIANAPI_API_KEY is not configured');
  }

  const base = baseUrl.replace(/\/+$/, '');
  const headers = { 'X-API-Key': apiKey };
  const getJson = async (url: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(url, { headers });
    } catch (err) {
      throw new IndianApiError(`IndianAPI request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      throw new IndianApiError(`IndianAPI request failed (${response.status})`);
    }
    try {
      return await response.json();
    } catch {
      throw new IndianApiError('IndianAPI returned invalid JSON');
    }
  };

  const searchResults = await getJson(`${base}/industry_search?query=${encodeURIComponent(ticker)}`);
  const searchMatch = Array.isArray(searchResults)
    ? searchResults.map(record).find((stock) => stringValue(stock.exchangeCodeNsi)?.toUpperCase() === ticker)
    : undefined;
  // industry_search matches company names, not tickers (e.g. "TCS" finds nothing), so fall back to
  // looking the ticker up directly; the returned NSE code is verified below either way.
  const searchName = searchMatch ? stringValue(searchMatch.commonName) : ticker;
  if (!searchName) {
    throw new IndianApiError('IndianAPI search returned an unusable company identity');
  }

  const response = record(await getJson(`${base}/stock?name=${encodeURIComponent(searchName)}`));
  const providerError = stringValue(response.error);
  if (providerError && /not found/i.test(providerError)) {
    throw new StockNotFoundError('Ticker not found');
  }
  const returnedName = stringValue(response.companyName);
  if (!returnedName) {
    throw new IndianApiError('IndianAPI returned an unusable company identity');
  }
  if (searchMatch && comparableName(returnedName) !== comparableName(searchName)) {
    throw new StockNotFoundError('Ticker identity did not match');
  }
  const profile = record(response.companyProfile);
  const returnedCode = stringValue(
    profile.exchangeCodeNse,
    profile.exchangeCodeNsi,
    response.exchangeCodeNse,
    response.exchangeCodeNsi
  );
  if (returnedCode?.toUpperCase() !== ticker) {
    throw new StockNotFoundError('Ticker identity did not match');
  }

  const currentPrice = numberValue(record(response.currentPrice).NSE);
  if (currentPrice == null || currentPrice <= 0) {
    throw new IndianApiError('IndianAPI returned no usable NSE current price');
  }
  const details = record(response.stockDetailsReusableData);
  const keyMetrics = record(response.keyMetrics);
  const valuation = keyedValues(keyMetrics.valuation);
  const perShare = keyedValues(keyMetrics.persharedata);
  const priceAndVolume = keyedValues(keyMetrics.priceandVolume);
  const description = stringValue(profile.companyDescription, profile.description);
  const industry = stringValue(response.industry, profile.mgIndustry, profile.industry);
  const returns = annualReturns(response.financials);
  const peers = normalizePeers(profile.peerCompanyList ?? response.peerCompanyList);

  return {
    marketCap: numberValue(details.marketCap, priceAndVolume.marketCap),
    currentPrice,
    week52High: numberValue(response.yearHigh),
    week52Low: numberValue(response.yearLow),
    peRatio: numberValue(
      details.pPerEBasicExcludingExtraordinaryItemsTTM,
      valuation.pPerEBasicExcludingExtraordinaryItemsTTM
    ),
    bookValue: numberValue(perShare.bookValuePerShareMostRecentFiscalYear),
    dividendYield: numberValue(
      details.currentDividendYieldCommonStockPrimaryIssueLTM,
      valuation.currentDividendYieldCommonStockPrimaryIssueLTM
    ),
    roce: returns.roce,
    roe: returns.roe,
    companyIntroduction: {
      name: returnedName,
      industry,
      description: description?.slice(0, 500) ?? null,
    },
    news: normalizeNews(response.recentNews),
    peers,
    analystConsensus: normalizeConsensus(response.analystView, response.recosBar, details.averageRating),
  };
}
