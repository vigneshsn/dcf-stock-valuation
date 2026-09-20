import { Router } from 'express';
import yahooFinance from 'yahoo-finance2';
import { get, set, CACHE_TTL_MS } from '../cache.js';
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

const router = Router();

router.get('/:ticker', async (req, res) => {
  const ticker = req.params.ticker;
  const cached = get<StockMetrics>(ticker);
  if (cached) {
    console.log(`[cache HIT] ${ticker}`);
    return res.status(200).json(cached);
  }
  console.log(`[cache MISS] ${ticker}`);

  let quote;
  try {
    quote = await yahooFinance.quote(ticker);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[upstream error] ${ticker}: ${message}`);
    const notFoundSignal = /not found|no fundamentals|no data|quote not found|invalid/i.test(message);
    if (notFoundSignal) {
      return res.status(404).json({ error: 'Ticker not found' });
    }
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }

  if (!quote || (quote.marketCap == null && quote.regularMarketPrice == null)) {
    console.log(`[not found] ${ticker}: empty upstream result`);
    return res.status(404).json({ error: 'Ticker not found' });
  }

  const metrics: StockMetrics = {
    marketCap: quote.marketCap ?? null,
    currentPrice: quote.regularMarketPrice ?? null,
    week52High: quote.fiftyTwoWeekHigh ?? null,
    week52Low: quote.fiftyTwoWeekLow ?? null,
    peRatio: quote.trailingPE ?? null,
    bookValue: quote.bookValue ?? null,
    dividendYield: (quote as any).dividendYield ?? quote.trailingAnnualDividendYield ?? null,
    roce: null,
    roe: null,
  };

  try {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: ['incomeStatementHistory', 'balanceSheetHistory'],
    });
    const incomeStatement = summary?.incomeStatementHistory?.incomeStatementHistory?.[0];
    const balanceSheet = summary?.balanceSheetHistory?.balanceSheetStatements?.[0];

    const ebit = incomeStatement?.ebit as number | null | undefined;
    const netIncome = incomeStatement?.netIncome as number | null | undefined;
    const totalAssets = balanceSheet?.totalAssets as number | null | undefined;
    const totalCurrentLiabilities = balanceSheet?.totalCurrentLiabilities as number | null | undefined;
    const totalStockholderEquity = balanceSheet?.totalStockholderEquity as number | null | undefined;

    metrics.roce = calculateROCE(ebit, totalAssets, totalCurrentLiabilities);
    metrics.roe = calculateROE(netIncome, totalStockholderEquity);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[upstream error] ${ticker} quoteSummary: ${message}`);
  }

  set(ticker, metrics, CACHE_TTL_MS);
  console.log(`[upstream success] ${ticker}`, metrics);
  res.status(200).json(metrics);
});

export default router;
