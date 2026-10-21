import { calculateROCE, calculateROE } from './finance.js';

const DEFAULT_INDIANAPI_URL = 'https://dev.indianapi.in';
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

function readFinancialRows(financials: JsonRecord, keys: string[]): JsonRecord[] {
  for (const key of keys) {
    const value = financials[key];
    if (Array.isArray(value)) {
      return value.map(record);
    }
    const container = record(value);
    for (const nestedKey of ['annual', 'yearly', 'annualData', 'data']) {
      if (Array.isArray(container[nestedKey])) {
        return (container[nestedKey] as unknown[]).map(record);
      }
    }
    const nestedRows = Object.values(container).find(Array.isArray);
    if (nestedRows) {
      return (nestedRows as unknown[]).map(record);
    }
  }
  return [];
}

function rowYear(row: JsonRecord): number | null {
  const period = stringValue(row.period, row.frequency, row.type);
  if (period && /\bQ[1-4]\b|quarter/i.test(period)) {
    return null;
  }
  const raw = row.fiscalYear ?? row.calendarYear ?? row.financialYear ?? row.year ?? row.date;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1900 && raw <= 2100) {
    return raw;
  }
  const match = typeof raw === 'string' ? raw.match(/\b(19\d{2}|20\d{2})\b/) : null;
  return match ? Number(match[1]) : null;
}

function numericField(row: JsonRecord, ...keys: string[]): number | null {
  return numberValue(...keys.map((key) => row[key]));
}

function annualReturns(financials: unknown): { roce: number | null; roe: number | null } {
  const statements = record(financials);
  const incomeRows = readFinancialRows(statements, [
    'incomeStatement', 'income_statement', 'income', 'Income Statement', 'Income',
  ]);
  const balanceRows = readFinancialRows(statements, [
    'balanceSheet', 'balance_sheet', 'balance', 'Balance Sheet', 'Balance',
  ]);
  const incomeByYear = new Map<number, JsonRecord>();
  const balanceByYear = new Map<number, JsonRecord>();

  for (const row of incomeRows) {
    const year = rowYear(row);
    if (year != null && !incomeByYear.has(year)) {
      incomeByYear.set(year, row);
    }
  }
  for (const row of balanceRows) {
    const year = rowYear(row);
    if (year != null && !balanceByYear.has(year)) {
      balanceByYear.set(year, row);
    }
  }

  const years = [...incomeByYear.keys()].filter((year) => balanceByYear.has(year)).sort((a, b) => b - a);
  for (const year of years) {
    const income = incomeByYear.get(year)!;
    const balance = balanceByYear.get(year)!;
    const ebit = numericField(income, 'ebit', 'operatingIncome', 'operatingProfit');
    const netIncome = numericField(income, 'netIncome', 'netProfit', 'profitAfterTax');
    const assets = numericField(balance, 'totalAssets', 'total_assets');
    const liabilities = numericField(balance, 'totalCurrentLiabilities', 'currentLiabilities', 'total_current_liabilities');
    const equity = numericField(balance, 'totalStockholdersEquity', 'totalShareholdersEquity', 'shareholdersEquity', 'total_equity');

    if ([ebit, netIncome, assets, liabilities, equity].every((value) => value != null)) {
      return {
        roce: calculateROCE(ebit, assets, liabilities),
        roe: calculateROE(netIncome, equity),
      };
    }
  }
  return { roce: null, roe: null };
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
        roe: numberValue(peer.returnOnEquityTTM, peer.roeTTM, peer.roe),
        debtToEquity: numberValue(peer.ltDebtPerEquityMostRecentFiscalYear, peer.debtToEquity, peer.debtEquity),
        profitMargin: numberValue(peer.netProfitMarginTTM, peer.profitMarginTTM, peer.profitMargin),
        dividendYield: numberValue(peer.dividendYield, peer.dividendYieldTTM),
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

function consensusCount(source: JsonRecord, ...keys: string[]): number | null {
  return numberValue(...keys.map((key) => source[key]));
}

function normalizeConsensus(analystView: unknown, recosBar: unknown): AnalystConsensus | null {
  const view = record(analystView);
  const bar = record(recosBar);
  const countValues: AnalystConsensus['counts'] = {
    strongBuy: consensusCount(bar, 'strongBuy', 'strong_buy', 'strongBuyCount'),
    buy: consensusCount(bar, 'buy', 'buyCount'),
    hold: consensusCount(bar, 'hold', 'holdCount'),
    sell: consensusCount(bar, 'sell', 'sellCount'),
    strongSell: consensusCount(bar, 'strongSell', 'strong_sell', 'strongSellCount'),
  };
  if (Array.isArray(recosBar)) {
    for (const entry of recosBar) {
      const item = record(entry);
      const label = stringValue(item.recommendation, item.rating, item.label, item.name)?.toLowerCase().replace(/[\s_-]+/g, '');
      const count = numberValue(item.count, item.analystCount, item.value);
      const key = label === 'strongbuy' ? 'strongBuy'
        : label === 'buy' ? 'buy'
          : label === 'hold' ? 'hold'
            : label === 'sell' ? 'sell'
              : label === 'strongsell' ? 'strongSell'
                : null;
      if (key && countValues[key] == null) {
        countValues[key] = count;
      }
    }
  }
  const recommendation = stringValue(
    view.overallRecommendation,
    view.recommendation,
    view.recommendationSummary,
    view.overallRating,
    view.summary
  );
  if (!recommendation && Object.values(countValues).every((count) => count == null)) {
    return null;
  }
  return { source: 'IndianAPI', recommendation, counts: countValues };
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

  const stocks = await getJson(`${base}/static/all_stocks.json`);
  const resolved = Array.isArray(stocks)
    ? stocks.map(record).find((stock) => stringValue(stock['nse-code'])?.toUpperCase() === ticker)
    : undefined;
  if (!resolved) {
    throw new StockNotFoundError('Ticker not found');
  }
  const companyName = stringValue(resolved.name);
  if (!companyName) {
    throw new IndianApiError('IndianAPI symbol list returned an unusable company identity');
  }

  const response = record(await getJson(`${base}/stock?name=${encodeURIComponent(companyName)}`));
  const returnedName = stringValue(response.companyName);
  if (!returnedName) {
    throw new IndianApiError('IndianAPI returned an unusable company identity');
  }
  if (comparableName(returnedName) !== comparableName(companyName)) {
    throw new StockNotFoundError('Ticker identity did not match');
  }
  const profile = record(response.companyProfile);
  const returnedCode = stringValue(
    response.exchangeCodeNsi,
    response.nseCode,
    response.symbol,
    profile.exchangeCodeNsi
  );
  if (returnedCode && returnedCode.toUpperCase() !== ticker) {
    throw new StockNotFoundError('Ticker identity did not match');
  }

  const currentPrice = numberValue(record(response.currentPrice).NSE);
  if (currentPrice == null) {
    throw new IndianApiError('IndianAPI returned no usable NSE current price');
  }
  const keyMetrics = record(response.keyMetrics);
  const description = stringValue(profile.companyDescription, profile.description);
  const industry = stringValue(response.industry, profile.mgIndustry, profile.industry);
  const returns = annualReturns(response.financials);
  const peers = normalizePeers(profile.peerCompanyList ?? response.peerCompanyList);

  return {
    marketCap: numberValue(keyMetrics.marketCap, response.marketCap),
    currentPrice,
    week52High: numberValue(response.yearHigh),
    week52Low: numberValue(response.yearLow),
    peRatio: numberValue(
      keyMetrics.stockPE,
      keyMetrics.peRatio,
      keyMetrics.priceToEarningsRatio,
      keyMetrics.priceToEarningsValueRatio
    ),
    bookValue: numberValue(keyMetrics.bookValuePerShare, keyMetrics.bookValuePerShareTTM, keyMetrics.bookValue),
    dividendYield: numberValue(keyMetrics.dividendYield),
    roce: returns.roce == null ? null : returns.roce * 100,
    roe: returns.roe == null ? null : returns.roe * 100,
    companyIntroduction: {
      name: returnedName,
      industry,
      description: description?.slice(0, 500) ?? null,
    },
    news: normalizeNews(response.recentNews),
    peers,
    analystConsensus: normalizeConsensus(response.analystView, response.recosBar),
  };
}
