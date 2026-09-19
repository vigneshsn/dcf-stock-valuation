import { Router } from 'express';
import yahooFinance from 'yahoo-finance2';
import { get, set, CACHE_TTL_MS } from '../cache.js';

interface StockMetrics {
  marketCap: number | null;
  currentPrice: number | null;
  week52High: number | null;
  week52Low: number | null;
  peRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
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
  };

  set(ticker, metrics, CACHE_TTL_MS);
  console.log(`[upstream success] ${ticker}`, metrics);
  res.status(200).json(metrics);
});

export default router;
