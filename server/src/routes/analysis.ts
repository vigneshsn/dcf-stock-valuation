import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { del, delPrefix, get, set } from '../cache.js';
import { fmpGet, FmpError } from '../fmp.js';
import { calculateROCE, calculateROE } from '../finance.js';
import { YearFinancials, deriveDefaults, computeFairValue, quantitativeScore, DcfAssumptions, QuantitativeInputs } from '../dcf.js';
import { fetchIndianApiQuantitativeInputs, StockNotFoundError } from '../indianapi.js';
import { configuredProvider, StockDataProvider } from '../provider.js';
import { saveUpload, listReports } from '../reports.js';
import { collectYearSummaries, forgetStoredYear } from '../yearSummaries.js';
import { OllamaError, ollamaConfig } from '../ollama.js';
import { ManagementJudgement, Peer, judgeManagement, judgeMoat, qualitativeScore, selectPeers } from '../qualitative.js';
import { forgetStoredQualitative, readStoredQualitative, writeStoredQualitative } from '../qualitativeStore.js';
import { ReportSwotDeps, financialSwot, forgetStoredSwot, latestReportSwot, mergeSwot } from '../swot.js';

const FINANCIALS_TTL_MS = Number(process.env.FINANCIALS_TTL_MS) || 60 * 60 * 1000;
const ANALYSIS_TTL_MS = Number(process.env.ANALYSIS_TTL_MS) || 6 * 60 * 60 * 1000;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

interface FmpFinancials extends QuantitativeInputs {
  marketCap: number;
}

interface AnalysisRouterOptions {
  provider?: StockDataProvider;
  indianApiKey?: string;
  indianApiBaseUrl?: string;
  fetcher?: typeof fetch;
  swot?: Partial<ReportSwotDeps>;
}

interface Stamped<T> {
  value: T;
  cachedAt: number;
}

function cacheGet<T>(key: string): Stamped<T> | undefined {
  return get<Stamped<T>>(key);
}

const swotKey = (ticker: string, model: string) => `analysis:swot:${ticker.trim().toUpperCase()}:${model}`;
const qualPrefix = (ticker: string) => `analysis:qual:${ticker.trim().toUpperCase()}:`;

function cachePut<T>(key: string, value: T): void {
  set<Stamped<T>>(key, { value, cachedAt: Date.now() }, ANALYSIS_TTL_MS);
}

async function loadFmpFinancials(ticker: string, fetcher?: typeof fetch): Promise<FmpFinancials> {
  const key = `financials:fmp:${ticker}`;
  const hit = get<FmpFinancials>(key);
  if (hit) {
    return hit;
  }
  const quotes = await fmpGet<any[]>('/quote', ticker, {}, fetcher);
  const quote = quotes?.[0];
  if (!quote || quote.price == null || quote.marketCap == null) {
    throw new FmpError('Ticker not found', 404);
  }
  const [income, cash, balance, ratios] = await Promise.all([
    fmpGet<any[]>('/income-statement', ticker, { limit: 5 }, fetcher),
    fmpGet<any[]>('/cash-flow-statement', ticker, { limit: 5 }, fetcher),
    fmpGet<any[]>('/balance-sheet-statement', ticker, { limit: 1 }, fetcher),
    fmpGet<any[]>('/ratios-ttm', ticker, {}, fetcher).catch(() => [] as any[]),
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
  const financials: FmpFinancials = {
    price: quote.price,
    marketCap: quote.marketCap,
    shares: quote.marketCap / quote.price,
    pe: r.priceToEarningsRatioTTM ?? quote.pe ?? null,
    pb: r.priceToBookRatioTTM ?? (bookPerShare ? quote.price / bookPerShare : null),
    roe: calculateROE(income?.[0]?.netIncome, balance?.[0]?.totalStockholdersEquity),
    roce: calculateROCE(income?.[0]?.operatingIncome, balance?.[0]?.totalAssets, balance?.[0]?.totalCurrentLiabilities),
    debtToEquity:
      balance?.[0]?.totalDebt != null && balance?.[0]?.totalStockholdersEquity > 0
        ? balance[0].totalDebt / balance[0].totalStockholdersEquity
        : null,
    history,
  };
  set(key, financials, FINANCIALS_TTL_MS);
  return financials;
}

// IndianAPI resolves bare NSE symbols, so accept the FMP-style `.NS` suffix but no other exchange.
function indianApiTicker(ticker: string): string {
  const symbol = ticker.trim().toUpperCase().replace(/\.NS$/, '');
  if (!symbol || symbol.includes('.')) {
    throw new StockNotFoundError('Only NSE tickers are supported');
  }
  return symbol;
}

async function loadIndianApiFinancials(ticker: string, options: AnalysisRouterOptions): Promise<QuantitativeInputs> {
  const symbol = indianApiTicker(ticker);
  const key = `financials:indianapi:${symbol}`;
  const hit = get<QuantitativeInputs>(key);
  if (hit) {
    return hit;
  }
  const financials = await fetchIndianApiQuantitativeInputs(
    symbol,
    options.indianApiKey ?? process.env.INDIANAPI_API_KEY,
    options.fetcher,
    options.indianApiBaseUrl
  );
  set(key, financials, FINANCIALS_TTL_MS);
  return financials;
}

function sendUpstreamError(res: express.Response, ticker: string, err: any) {
  console.error(`[analysis error] ${ticker}: ${err?.message || err}`);
  if (err instanceof StockNotFoundError) {
    return res.status(404).json({ error: 'Ticker not found' });
  }
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

export function createAnalysisRouter(options: AnalysisRouterOptions = {}): Router {
  const provider = configuredProvider(options.provider);
  const loadQuantitativeInputs = (ticker: string): Promise<QuantitativeInputs> =>
    provider === 'indianapi' ? loadIndianApiFinancials(ticker, options) : loadFmpFinancials(ticker, options.fetcher);
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
    const key = `analysis:quant:${provider}:${ticker}:${overrides.growthRate ?? ''}:${overrides.discountRate ?? ''}:${overrides.terminalGrowthRate ?? ''}`;
    const hit = cacheGet<unknown>(key);
    if (hit) {
      console.log(`[analysis cache HIT] ${key}`);
      return res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
    }
    try {
      const f = await loadQuantitativeInputs(ticker);
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
    // Qualitative peer selection stays on FMP regardless of the configured stock-data provider.
    const f = await loadFmpFinancials(ticker, options.fetcher);
    const raw = await fmpGet<any[]>('/stock-peers', ticker, {}, options.fetcher);
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
    async (req, res) => {
      const year = Number(req.query.year);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) {
        return res.status(400).json({ error: 'year query parameter is required' });
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0 || body.subarray(0, 5).toString() !== '%PDF-') {
        return res.status(400).json({ error: 'Body must be a PDF (Content-Type: application/pdf)' });
      }
      saveUpload(req.params.ticker, year, body);
      const { model } = ollamaConfig();
      del(swotKey(req.params.ticker, model));
      delPrefix(qualPrefix(req.params.ticker));
      await Promise.all([
        forgetStoredYear(req.params.ticker, year),
        forgetStoredSwot(req.params.ticker, year),
        forgetStoredQualitative(req.params.ticker),
      ]);
      res.status(201).json({ ticker: req.params.ticker, year, bytes: body.length });
    }
  );

  router.post('/:ticker/qualitative', express.json(), async (req, res) => {
    const ticker = req.params.ticker;
    const peerOverride: string[] | undefined = Array.isArray(req.body?.peers)
      ? req.body.peers.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : undefined;
    const { model } = ollamaConfig();
    const peerTag = (peerOverride ?? ['default']).join(',');
    // Checked before listing reports, so a repeat request makes no report, FMP or LLM calls.
    const key = `${qualPrefix(ticker)}${model}:${peerTag}`;
    const hit = cacheGet<unknown>(key);
    if (hit) {
      console.log(`[analysis cache HIT] ${key}`);
      return res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
    }
    try {
      const started = Date.now();
      const { reportCount, summaries, skippedYears: skipped } = await collectYearSummaries(ticker, model, 3);
      if (!reportCount) {
        return res.status(422).json({
          error: 'no-reports',
          message: 'Annual reports could not be fetched from BSE/NSE. Upload PDFs via POST /api/analysis/:ticker/reports?year=YYYY.',
        });
      }
      if (!summaries.length) {
        return res.status(422).json({ error: 'no-mdna', message: 'No Management Discussion and Analysis section found in the reports.', skippedYears: skipped });
      }

      const fingerprint = createHash('sha1').update(JSON.stringify(summaries)).digest('hex').slice(0, 16);
      const resultKey = `result:${model}:${peerTag}:${fingerprint}`;
      const stored = await readStoredQualitative<object>(ticker, resultKey);
      if (stored) {
        console.log(`[qualitative cache HIT] ${ticker} ${resultKey}`);
        cachePut(key, stored);
        return res.json({ ...stored, cached: true, cachedAt: Date.now() });
      }

      const peers: Peer[] = peerOverride
        ? peerOverride.map((symbol) => ({ symbol, name: symbol, marketCap: null }))
        : await defaultPeers(ticker).catch(() => [] as Peer[]);
      // Management depends only on the summaries, so a peer change re-runs just the Moat call.
      const mgmtKey = `management:${model}:${fingerprint}`;
      const [moat, management] = await Promise.all([
        judgeMoat(summaries[0], peers),
        readStoredQualitative<ManagementJudgement>(ticker, mgmtKey).then(
          (m) => m ?? judgeManagement(summaries).then(async (j) => (await writeStoredQualitative(ticker, mgmtKey, j), j))
        ),
      ]);
      console.log(`[qualitative] ${ticker}: ${summaries.length} year(s) analysed in ${Date.now() - started}ms`);
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
      await writeStoredQualitative(ticker, resultKey, body);
      res.json({ ...body, cached: false, cachedAt: Date.now() });
    } catch (err: any) {
      console.error(`[qualitative error] ${ticker}: ${err?.message || err}`);
      if (err instanceof OllamaError) {
        return res.status(503).json({ error: 'llm-unavailable', message: err.message });
      }
      sendUpstreamError(res, ticker, err);
    }
  });

  // SWOT returns a partial result: financials S/W survive a missing report or an unreachable LLM, and vice versa.
  router.post('/:ticker/swot', async (req, res) => {
    const ticker = req.params.ticker;
    const { model } = ollamaConfig();
    const key = swotKey(ticker, model);
    const hit = cacheGet<any>(key);
    if (hit) {
      console.log(`[analysis cache HIT] ${key}`);
      return res.json({ ...hit.value, report: { ...hit.value.report, cached: true }, cached: true, cachedAt: hit.cachedAt });
    }
    const [financialsResult, reportResult] = await Promise.allSettled([
      loadQuantitativeInputs(ticker),
      latestReportSwot(ticker, model, {
        listReports: options.swot?.listReports ?? ((t, n) => listReports(t, n, options.fetcher)),
        textOf: options.swot?.textOf,
        judge: options.swot?.judge,
      }),
    ]);

    const fin = financialsResult.status === 'fulfilled' ? financialSwot(financialsResult.value) : null;
    if (financialsResult.status === 'rejected') {
      console.error(`[swot financials error] ${ticker}: ${financialsResult.reason?.message || financialsResult.reason}`);
    }

    let report: { status: 'ok' | 'no-reports' | 'no-mdna' | 'llm-unavailable' | 'failed'; message: string | null; year: number | null; source: string | null; cached: boolean };
    const entry = reportResult.status === 'fulfilled' ? reportResult.value.entry : null;
    if (reportResult.status === 'rejected') {
      const err = reportResult.reason;
      console.error(`[swot report error] ${ticker}: ${err?.message || err}`);
      report = err instanceof OllamaError
        ? { status: 'llm-unavailable', message: `The local model is unavailable: ${err.message}`, year: null, source: null, cached: false }
        : { status: 'failed', message: 'The annual report could not be analysed.', year: null, source: null, cached: false };
    } else if (!entry) {
      report = {
        status: 'no-reports',
        message: 'No annual report could be fetched. Upload the latest annual report PDF.',
        year: null,
        source: null,
        cached: false,
      };
    } else {
      report = {
        status: entry.found ? 'ok' : 'no-mdna',
        message: entry.found ? null : 'No Management Discussion and Analysis or SWOT sections found in the report.',
        year: entry.year,
        source: entry.source,
        cached: reportResult.status === 'fulfilled' && reportResult.value.cached,
      };
    }

    const reason = financialsResult.status === 'rejected' ? financialsResult.reason : null;
    const notFound = reason instanceof StockNotFoundError || (reason instanceof FmpError && reason.status === 404);
    if (notFound && !entry) {
      return res.status(404).json({ error: 'Ticker not found' });
    }

    const body = {
      ticker,
      model,
      experimental: true,
      report,
      financials: fin
        ? { status: 'ok', year: fin.year, message: null }
        : { status: 'unavailable', year: null, message: 'Financial data could not be loaded.' },
      ...mergeSwot(entry?.swot ?? null, fin ?? { strengths: [], weaknesses: [] }),
    };
    // Only complete results are cached, so a missing report, LLM outage or provider failure is retried next time.
    if (fin && (report.status === 'ok' || report.status === 'no-mdna')) {
      cachePut(key, body);
    }
    res.json({ ...body, cached: false, cachedAt: Date.now() });
  });

  return router;
}

export default createAnalysisRouter();
