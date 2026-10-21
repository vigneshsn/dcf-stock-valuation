import { Router } from 'express';
import { get, set, CACHE_TTL_MS } from '../cache.js';
import { fmpGet, FmpError } from '../fmp.js';
import { calculateROCE, calculateROE } from '../finance.js';

interface StockMetrics {
  marketCap: number | null;
  currentPrice: number | null;
  week52High: number | null;
  week52Low: number | null;
  peRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  roce: number | null;
  roe: number | null;
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
  ebit?: number | null;
  operatingIncome?: number | null;
  netIncome?: number | null;
}

interface FmpBalanceSheet {
  totalAssets?: number | null;
  totalCurrentLiabilities?: number | null;
  totalStockholdersEquity?: number | null;
}

function isUnknownSymbolError(err: unknown): boolean {
  if (!(err instanceof FmpError)) {
    return false;
  }
  if (err.status === 402 && /symbol.*not available|invalid.*symbol/i.test(err.message)) {
    return true;
  }
  return false;
}

const router = Router();

router.get('/:ticker', async (req, res) => {
  const ticker = req.params.ticker;
  const cached = get<StockMetrics>(ticker);
  if (cached) {
    console.log(`[cache HIT] ${ticker}`);
    return res.status(200).json(cached);
  }
  console.log(`[cache MISS] ${ticker}`);

  let quotes: FmpQuote[];
  try {
    quotes = await fmpGet<FmpQuote[]>('/quote', ticker);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[upstream error] ${ticker}: ${message}`);
    if (isUnknownSymbolError(err)) {
      return res.status(404).json({ error: 'Ticker not found' });
    }
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }

  const quote = quotes?.[0];
  if (!quote || (quote.marketCap == null && quote.price == null)) {
    console.log(`[not found] ${ticker}: empty upstream result`);
    return res.status(404).json({ error: 'Ticker not found' });
  }

  const metrics: StockMetrics = {
    marketCap: quote.marketCap ?? null,
    currentPrice: quote.price ?? null,
    week52High: quote.yearHigh ?? null,
    week52Low: quote.yearLow ?? null,
    peRatio: quote.pe ?? null,
    bookValue: null,
    dividendYield: null,
    roce: null,
    roe: null,
  };

  try {
    const ratiosList = await fmpGet<FmpRatios[]>('/ratios-ttm', ticker);
    const ratios = ratiosList?.[0];
    metrics.peRatio = ratios?.priceToEarningsRatioTTM ?? metrics.peRatio;
    metrics.bookValue = ratios?.bookValuePerShareTTM ?? null;
    metrics.dividendYield = ratios?.dividendYieldTTM ?? null;
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[upstream error] ${ticker} ratios-ttm: ${message}`);
  }

  try {
    const [incomeStatements, balanceSheets] = await Promise.all([
      fmpGet<FmpIncomeStatement[]>('/income-statement', ticker),
      fmpGet<FmpBalanceSheet[]>('/balance-sheet-statement', ticker),
    ]);
    const incomeStatement = incomeStatements?.[0];
    const balanceSheet = balanceSheets?.[0];

    const ebit = incomeStatement?.ebit ?? incomeStatement?.operatingIncome;
    const netIncome = incomeStatement?.netIncome;
    const totalAssets = balanceSheet?.totalAssets;
    const totalCurrentLiabilities = balanceSheet?.totalCurrentLiabilities;
    const totalStockholderEquity = balanceSheet?.totalStockholdersEquity;

    metrics.roce = calculateROCE(ebit, totalAssets, totalCurrentLiabilities);
    metrics.roe = calculateROE(netIncome, totalStockholderEquity);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[upstream error] ${ticker} financial statements: ${message}`);
  }

  set(ticker, metrics, CACHE_TTL_MS);
  console.log(`[upstream success] ${ticker}`, metrics);
  res.status(200).json(metrics);
});

export default router;
