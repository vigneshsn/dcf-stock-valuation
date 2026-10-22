import { Router } from 'express';
import { get, set, CACHE_TTL_MS } from '../cache.js';
import { fmpGet, FmpError } from '../fmp.js';
import {
  fetchIndianApiStock,
  IndianApiError,
  StockData,
  StockNotFoundError,
} from '../indianapi.js';
import { calculateAnnualReturns, mapAnnualStatements } from '../finance.js';
import { configuredProvider, StockDataProvider } from '../provider.js';

interface StockRouterOptions {
  provider?: StockDataProvider;
  indianApiKey?: string;
  indianApiBaseUrl?: string;
  fetcher?: typeof fetch;
}

interface FmpQuote {
  symbol: string;
  price: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  pe: number | null;
}

interface FmpRatios {
  priceToEarningsRatioTTM?: number | null;
  bookValuePerShareTTM?: number | null;
  dividendYieldTTM?: number | null;
}

interface FmpIncomeStatement {
  date?: string;
  fiscalYear?: string | number;
  calendarYear?: string | number;
  period?: string;
  ebit?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
}

interface FmpBalanceSheet {
  date?: string;
  fiscalYear?: string | number;
  calendarYear?: string | number;
  period?: string;
  totalAssets?: number | null;
  totalCurrentLiabilities?: number | null;
  totalStockholdersEquity?: number | null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function fmpYear(row: { fiscalYear?: string | number; calendarYear?: string | number; date?: string }): number | null {
  const value = row.fiscalYear ?? row.calendarYear ?? row.date?.slice(0, 4);
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

function alignedFmpReturns(
  incomeStatements: FmpIncomeStatement[],
  balanceSheets: FmpBalanceSheet[]
): { roce: number | null; roe: number | null } {
  const annualYear = (statement: FmpIncomeStatement | FmpBalanceSheet): number | null =>
    /^Q[1-4]$/i.test(statement.period ?? '') ? null : fmpYear(statement);
  const annualIncome = mapAnnualStatements(incomeStatements, annualYear, (statement) => ({
    ebit: numberOrNull(statement.ebit ?? statement.operatingIncome),
    netIncome: numberOrNull(statement.netIncome),
  }));
  const annualBalance = mapAnnualStatements(balanceSheets, annualYear, (statement) => ({
    totalAssets: numberOrNull(statement.totalAssets),
    totalCurrentLiabilities: numberOrNull(statement.totalCurrentLiabilities),
    totalStockholdersEquity: numberOrNull(statement.totalStockholdersEquity),
  }));
  return calculateAnnualReturns(annualIncome, annualBalance);
}

function isUnknownFmpSymbol(err: unknown): boolean {
  return err instanceof FmpError &&
    ((err.status === 404) || (err.status === 402 && /symbol.*not available|invalid.*symbol/i.test(err.message)));
}

function fmpTicker(ticker: string): string {
  return ticker.endsWith('.NS') ? ticker : `${ticker}.NS`;
}

async function fetchFmpStock(ticker: string, fetcher?: typeof fetch): Promise<StockData> {
  if (ticker.includes('.') && !ticker.endsWith('.NS')) {
    throw new StockNotFoundError('Only NSE tickers are supported');
  }
  const symbol = fmpTicker(ticker);
  const quotes = await fmpGet<FmpQuote[]>('/quote', symbol, {}, fetcher);
  const quote = quotes?.[0];
  if (!quote || (quote.marketCap == null && quote.price == null)) {
    throw new StockNotFoundError('Ticker not found');
  }
  if (quote.symbol.toUpperCase() !== symbol) {
    throw new StockNotFoundError('Ticker identity did not match');
  }
  const currentPrice = numberOrNull(quote.price);
  if (currentPrice == null || currentPrice <= 0) {
    throw new FmpError('FMP returned no usable NSE current price', 502);
  }
  const metrics: StockData = {
    marketCap: numberOrNull(quote.marketCap),
    currentPrice,
    week52High: numberOrNull(quote.yearHigh),
    week52Low: numberOrNull(quote.yearLow),
    peRatio: numberOrNull(quote.pe),
    bookValue: null,
    dividendYield: null,
    roce: null,
    roe: null,
    companyIntroduction: null,
    news: [],
    peers: [],
    analystConsensus: null,
  };

  try {
    const ratiosList = await fmpGet<FmpRatios[]>('/ratios-ttm', symbol, {}, fetcher);
    const ratios = ratiosList?.[0];
    metrics.peRatio = numberOrNull(ratios?.priceToEarningsRatioTTM) ?? metrics.peRatio;
    metrics.bookValue = numberOrNull(ratios?.bookValuePerShareTTM);
    metrics.dividendYield = numberOrNull(ratios?.dividendYieldTTM);
  } catch (err) {
    console.error(`[upstream error] ${ticker} ratios-ttm: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const [incomeStatements, balanceSheets] = await Promise.all([
      fmpGet<FmpIncomeStatement[]>('/income-statement', symbol, { limit: 5 }, fetcher),
      fmpGet<FmpBalanceSheet[]>('/balance-sheet-statement', symbol, { limit: 5 }, fetcher),
    ]);
    const returns = alignedFmpReturns(incomeStatements ?? [], balanceSheets ?? []);
    metrics.roce = returns.roce;
    metrics.roe = returns.roe;
  } catch (err) {
    console.error(`[upstream error] ${ticker} financial statements: ${err instanceof Error ? err.message : String(err)}`);
  }
  return metrics;
}

export function createStockRouter(options: StockRouterOptions = {}): Router {
  const router = Router();
  const provider = configuredProvider(options.provider);

  router.get('/:ticker', async (req, res) => {
    const requested = req.params.ticker.trim().toUpperCase();
    // IndianAPI resolves bare NSE symbols; accept the `.NS` form the analysis routes also accept.
    const ticker = provider === 'indianapi' ? requested.replace(/\.NS$/, '') : requested;
    if (!ticker) {
      return res.status(404).json({ error: 'Ticker not found' });
    }

    const cacheKey = `stock:${provider}:${ticker}`;
    const cached = get<StockData>(cacheKey);
    if (cached) {
      console.log(`[cache HIT] ${provider}:${ticker}`);
      return res.status(200).json(cached);
    }
    console.log(`[cache MISS] ${provider}:${ticker}`);

    try {
      const data = provider === 'indianapi'
        ? await fetchIndianApiStock(
          ticker,
          options.indianApiKey ?? process.env.INDIANAPI_API_KEY,
          options.fetcher,
          options.indianApiBaseUrl
        )
        : await fetchFmpStock(ticker, options.fetcher);
      set(cacheKey, data, CACHE_TTL_MS);
      console.log(`[upstream success] ${provider}:${ticker}`);
      return res.status(200).json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[upstream error] ${provider}:${ticker}: ${message}`);
      if (err instanceof StockNotFoundError || (provider === 'fmp' && isUnknownFmpSymbol(err))) {
        return res.status(404).json({ error: 'Ticker not found' });
      }
      if (err instanceof IndianApiError || err instanceof FmpError) {
        return res.status(502).json({ error: 'Upstream fetch failed' });
      }
      return res.status(502).json({ error: 'Upstream fetch failed' });
    }
  });

  return router;
}

export default createStockRouter();
