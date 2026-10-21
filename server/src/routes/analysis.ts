import express, { Router } from 'express';
import { get, set } from '../cache.js';
import { fmpGet, FmpError } from '../fmp.js';
import { calculateROE } from '../finance.js';
import { YearFinancials, deriveDefaults, computeFairValue, quantitativeScore, DcfAssumptions } from '../dcf.js';
import { acquireReports, saveUpload } from '../reports.js';
import { extractMdna, pdfToText, summariseMdna } from '../mdna.js';
import { OllamaError, ollamaConfig } from '../ollama.js';
import { Peer, YearSummary, judgeManagement, judgeMoat, qualitativeScore, selectPeers } from '../qualitative.js';

const FINANCIALS_TTL_MS = Number(process.env.FINANCIALS_TTL_MS) || 60 * 60 * 1000;
const ANALYSIS_TTL_MS = Number(process.env.ANALYSIS_TTL_MS) || 6 * 60 * 60 * 1000;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface Financials {
  price: number;
  marketCap: number;
  shares: number;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  history: YearFinancials[];
}

interface Stamped<T> {
  value: T;
  cachedAt: number;
}

function cacheGet<T>(key: string): Stamped<T> | undefined {
  return get<Stamped<T>>(key);
}

function cachePut<T>(key: string, value: T): void {
  set<Stamped<T>>(key, { value, cachedAt: Date.now() }, ANALYSIS_TTL_MS);
}

async function loadFinancials(ticker: string): Promise<Financials> {
  const key = `financials:${ticker}`;
  const hit = get<Financials>(key);
  if (hit) {
    return hit;
  }
  const quotes = await fmpGet<any[]>('/quote', ticker);
  const quote = quotes?.[0];
  if (!quote || quote.price == null || quote.marketCap == null) {
    throw new FmpError('Ticker not found', 404);
  }
  const [income, cash, balance, ratios] = await Promise.all([
    fmpGet<any[]>('/income-statement', ticker, { limit: 5 }),
    fmpGet<any[]>('/cash-flow-statement', ticker, { limit: 5 }),
    fmpGet<any[]>('/balance-sheet-statement', ticker, { limit: 1 }),
    fmpGet<any[]>('/ratios-ttm', ticker).catch(() => [] as any[]),
  ]);
  const yearOf = (row: any) => Number(row.fiscalYear ?? row.calendarYear ?? String(row.date ?? '').slice(0, 4));
  const cashByYear = new Map<number, any>((cash ?? []).map((c) => [yearOf(c), c]));
  const history: YearFinancials[] = (income ?? [])
    .map((row) => {
      const year = yearOf(row);
      const cf = cashByYear.get(year) ?? {};
      return {
        year,
        revenue: Number(row.revenue ?? 0),
        netIncome: Number(row.netIncome ?? 0),
        capex: Math.abs(Number(cf.capitalExpenditure ?? 0)),
        nonCashExpense: Number(cf.depreciationAndAmortization ?? row.depreciationAndAmortization ?? 0),
      };
    })
    .filter((y) => Number.isFinite(y.year) && y.revenue > 0)
    .sort((a, b) => b.year - a.year);

  const r = ratios?.[0] ?? {};
  const bookPerShare = r.bookValuePerShareTTM ?? null;
  const financials: Financials = {
    price: quote.price,
    marketCap: quote.marketCap,
    shares: quote.marketCap / quote.price,
    pe: r.priceToEarningsRatioTTM ?? quote.pe ?? null,
    pb: r.priceToBookRatioTTM ?? (bookPerShare ? quote.price / bookPerShare : null),
    roe: calculateROE(income?.[0]?.netIncome, balance?.[0]?.totalStockholdersEquity),
    history,
  };
  set(key, financials, FINANCIALS_TTL_MS);
  return financials;
}

function sendUpstreamError(res: express.Response, ticker: string, err: any) {
  console.error(`[analysis error] ${ticker}: ${err?.message || err}`);
  if (err instanceof FmpError && (err.status === 404 || (err.status === 402 && /symbol/i.test(err.message)))) {
    return res.status(404).json({ error: 'Ticker not found' });
  }
  return res.status(502).json({ error: 'Upstream fetch failed' });
}

function parseOverride(v: unknown): number | undefined {
  if (v === undefined || v === '') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const router = Router();

router.get('/:ticker/quantitative', async (req, res) => {
  const ticker = req.params.ticker;
  const overrides = {
    growthRate: parseOverride(req.query.growth),
    discountRate: parseOverride(req.query.discount),
    terminalGrowthRate: parseOverride(req.query.terminal),
  };
  if (Object.values(overrides).some((v) => Number.isNaN(v))) {
    return res.status(400).json({ error: 'Overrides must be numbers' });
  }
  const key = `analysis:quant:${ticker}:${overrides.growthRate ?? ''}:${overrides.discountRate ?? ''}:${overrides.terminalGrowthRate ?? ''}`;
  const hit = cacheGet<unknown>(key);
  if (hit) {
    console.log(`[analysis cache HIT] ${key}`);
    return res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
  }
  try {
    const f = await loadFinancials(ticker);
    const defaults = deriveDefaults(f.history);
    if (!defaults) {
      return res.status(422).json({ error: 'Not enough historical financials to run a DCF' });
    }
    const assumptions: DcfAssumptions = {
      growthRate: overrides.growthRate ?? defaults.growthRate,
      discountRate: overrides.discountRate ?? defaults.discountRate,
      terminalGrowthRate: overrides.terminalGrowthRate ?? defaults.terminalGrowthRate,
    };
    if (assumptions.discountRate <= assumptions.terminalGrowthRate) {
      return res.status(400).json({ error: 'Discount rate must be greater than terminal growth rate' });
    }
    const fairValue = computeFairValue(f.history, assumptions, f.shares);
    if (fairValue == null || fairValue <= 0) {
      return res.status(422).json({ error: 'DCF did not produce a positive Fair value for these inputs' });
    }
    const score = quantitativeScore(fairValue, f.price);
    const body = {
      ticker,
      price: f.price,
      ratios: { pe: f.pe, pb: f.pb, roe: f.roe },
      defaults,
      assumptions,
      overridden: Object.values(overrides).some((v) => v !== undefined),
      fairValue,
      score: score.score,
      explanation: score.explanation,
    };
    cachePut(key, body);
    res.json({ ...body, cached: false, cachedAt: Date.now() });
  } catch (err) {
    sendUpstreamError(res, ticker, err);
  }
});

router.get('/:ticker/peers', async (req, res) => {
  const ticker = req.params.ticker;
  try {
    res.json({ ticker, peers: await defaultPeers(ticker) });
  } catch (err) {
    sendUpstreamError(res, ticker, err);
  }
});

async function defaultPeers(ticker: string): Promise<Peer[]> {
  const f = await loadFinancials(ticker);
  const raw = await fmpGet<any[]>('/stock-peers', ticker);
  const candidates: Peer[] = (raw ?? []).map((p) => ({
    symbol: p.symbol,
    name: p.companyName ?? p.symbol,
    marketCap: p.mktCap ?? p.marketCap ?? null,
  }));
  return selectPeers({ symbol: ticker, name: ticker, marketCap: f.marketCap }, candidates);
}

router.post(
  '/:ticker/reports',
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: MAX_PDF_BYTES }),
  (req, res) => {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      return res.status(400).json({ error: 'year query parameter is required' });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'Body must be a PDF (Content-Type: application/pdf)' });
    }
    saveUpload(req.params.ticker, year, body);
    res.status(201).json({ ticker: req.params.ticker, year, bytes: body.length });
  }
);

router.post('/:ticker/qualitative', express.json(), async (req, res) => {
  const ticker = req.params.ticker;
  const peerOverride: string[] | undefined = Array.isArray(req.body?.peers)
    ? req.body.peers.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
    : undefined;
  try {
    const reports = await acquireReports(ticker, 3);
    if (!reports.length) {
      return res.status(422).json({
        error: 'no-reports',
        message: 'Annual reports could not be fetched from BSE/NSE. Upload PDFs via POST /api/analysis/:ticker/reports?year=YYYY.',
      });
    }
    const { model } = ollamaConfig();
    const key = `analysis:qual:${ticker}:${model}:${(peerOverride ?? ['default']).join(',')}:${reports.map((r) => `${r.year}-${r.data.length}`).join(',')}`;
    const hit = cacheGet<unknown>(key);
    if (hit) {
      console.log(`[analysis cache HIT] ${key}`);
      return res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
    }

    const summaries: YearSummary[] = [];
    const skipped: number[] = [];
    for (const r of reports) {
      const section = extractMdna(await pdfToText(r.data));
      if (!section) {
        skipped.push(r.year);
        continue;
      }
      const s = await summariseMdna(section);
      summaries.push({ year: r.year, summary: s.summary, excerpt: s.excerpt });
    }
    if (!summaries.length) {
      return res.status(422).json({ error: 'no-mdna', message: 'No Management Discussion and Analysis section found in the reports.', skippedYears: skipped });
    }

    const peers: Peer[] = peerOverride
      ? peerOverride.map((symbol) => ({ symbol, name: symbol, marketCap: null }))
      : await defaultPeers(ticker).catch(() => [] as Peer[]);
    summaries.sort((a, b) => b.year - a.year);
    const moat = await judgeMoat(summaries[0], peers);
    const management = await judgeManagement(summaries);
    const score = qualitativeScore(moat, management);
    const body = {
      ticker,
      model,
      peers,
      peersOverridden: !!peerOverride,
      yearsAnalysed: summaries.map((s) => s.year),
      skippedYears: skipped,
      moat,
      management,
      score: score.score,
      experimental: true,
      explanation: score.explanation,
      quotes: score.quotes,
    };
    cachePut(key, body);
    res.json({ ...body, cached: false, cachedAt: Date.now() });
  } catch (err: any) {
    console.error(`[qualitative error] ${ticker}: ${err?.message || err}`);
    if (err instanceof OllamaError) {
      return res.status(503).json({ error: 'llm-unavailable', message: err.message });
    }
    sendUpstreamError(res, ticker, err);
  }
});

export default router;
