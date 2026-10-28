import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { del, delPrefix, get, set } from '../cache.js';
import { fmpGet, FmpError } from '../fmp.js';
import { calculateROCE, calculateROE } from '../finance.js';
import { YearFinancials, deriveDefaults, computeFairValue, computeScenarios, quantitativeScore, reverseDcf, reverseDcfUnavailable, DcfAssumptions, QuantitativeInputs } from '../dcf.js';
import { fetchIndianApiQuantitativeInputs, StockNotFoundError } from '../indianapi.js';
import { configuredProvider, StockDataProvider } from '../provider.js';
import { saveUpload, listReports } from '../reports.js';
import { collectYearSummaries, forgetStoredYear } from '../yearSummaries.js';
import { LlmError, llmConfig } from '../llm.js';
import { ManagementJudgement, Peer, judgeManagement, judgeMoat, qualitativeScore, selectPeers } from '../qualitative.js';
import { forgetStoredQualitative, readStoredQualitative, writeStoredQualitative } from '../qualitativeStore.js';
import { ReportSwotDeps, financialSwot, forgetStoredSwot, latestReportSwot, mergeSwot } from '../swot.js';
import { ReportInsightsDeps, forgetStoredInsights, latestReportInsights, readStoredInsights } from '../insights.js';
import { GuidanceDeps, GuidanceYear, collectGuidance, forgetStoredGuidance, guidanceScorecard } from '../guidance.js';
import { Features, features } from '../features.js';
import { redFlagScan } from '../redFlags.js';
import { financialStatements } from '../statements.js';
import { strengthsWeaknesses } from '../strengths.js';

const FINANCIALS_TTL_MS = Number(process.env.FINANCIALS_TTL_MS) || 60 * 60 * 1000;
const ANALYSIS_TTL_MS = Number(process.env.ANALYSIS_TTL_MS) || 6 * 60 * 60 * 1000;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
// IndianAPI statements are already in ₹ crore; FMP reports raw rupees.
const RUPEES_PER_CRORE = 1e7;

interface FmpFinancials extends QuantitativeInputs {
  marketCap: number;
}

interface AnalysisRouterOptions {
  provider?: StockDataProvider;
  indianApiKey?: string;
  indianApiBaseUrl?: string;
  fetcher?: typeof fetch;
  swot?: Partial<ReportSwotDeps>;
  insights?: Partial<ReportInsightsDeps>;
  guidance?: Partial<GuidanceDeps>;
  // Overrides the ENABLE_* environment flags (tests).
  features?: Partial<Features>;
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
const insightsKey = (ticker: string, model: string) => `analysis:insights:${ticker.trim().toUpperCase()}:${model}`;
const guidanceKey = (ticker: string, model: string) => `analysis:guidance:${ticker.trim().toUpperCase()}:${model}`;

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
    fmpGet<any[]>('/balance-sheet-statement', ticker, { limit: 5 }, fetcher),
    fmpGet<any[]>('/ratios-ttm', ticker, {}, fetcher).catch(() => [] as any[]),
  ]);
  const yearOf = (row: any) => Number(row.fiscalYear ?? row.calendarYear ?? String(row.date ?? '').slice(0, 4));
  const cashByYear = new Map<number, any>((cash ?? []).map((c) => [yearOf(c), c]));
  const balanceByYear = new Map<number, any>((balance ?? []).map((b) => [yearOf(b), b]));
  const metric = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const history: YearFinancials[] = (income ?? [])
    .map((row) => {
      const year = yearOf(row);
      const cf = cashByYear.get(year) ?? {};
      const bs = balanceByYear.get(year) ?? {};
      const reportedCapex = metric(cf.capitalExpenditure);
      return {
        year,
        revenue: Number(row.revenue ?? 0),
        netIncome: Number(row.netIncome ?? 0),
        capex: Math.abs(Number(cf.capitalExpenditure ?? 0)),
        nonCashExpense: Number(cf.depreciationAndAmortization ?? row.depreciationAndAmortization ?? 0),
        operatingCashFlow: metric(cf.operatingCashFlow),
        receivables: metric(bs.netReceivables),
        totalDebt: metric(bs.totalDebt),
        totalEquity: metric(bs.totalStockholdersEquity),
        reportedCapex: reportedCapex == null ? null : Math.abs(reportedCapex),
        ebitda: metric(row.ebitda),
        totalAssets: metric(bs.totalAssets),
        ebit: metric(row.operatingIncome),
        currentLiabilities: metric(bs.totalCurrentLiabilities),
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

type AssumptionOverrides = { [K in keyof DcfAssumptions]: number | undefined };

// null when any supplied override is not a number
function parseAssumptionOverrides(query: express.Request['query']): AssumptionOverrides | null {
  const overrides = {
    growthRate: parseOverride(query.growth),
    discountRate: parseOverride(query.discount),
    terminalGrowthRate: parseOverride(query.terminal),
  };
  return Object.values(overrides).some((v) => Number.isNaN(v)) ? null : overrides;
}

const overridesKey = (o: AssumptionOverrides) => `${o.growthRate ?? ''}:${o.discountRate ?? ''}:${o.terminalGrowthRate ?? ''}`;

const resolveAssumptions = (defaults: DcfAssumptions, o: AssumptionOverrides): DcfAssumptions => ({
  growthRate: o.growthRate ?? defaults.growthRate,
  discountRate: o.discountRate ?? defaults.discountRate,
  terminalGrowthRate: o.terminalGrowthRate ?? defaults.terminalGrowthRate,
});

const invalidOverridesError = { error: 'Overrides must be numbers' };
const discountNotAboveTerminalError = { error: 'Discount rate must be greater than terminal growth rate' };

function sendCacheHit(res: express.Response, key: string): boolean {
  const hit = cacheGet<unknown>(key);
  if (!hit) {
    return false;
  }
  console.log(`[analysis cache HIT] ${key}`);
  res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
  return true;
}

export function createAnalysisRouter(options: AnalysisRouterOptions = {}): Router {
  const provider = configuredProvider(options.provider);
  const loadQuantitativeInputs = (ticker: string): Promise<QuantitativeInputs> =>
    provider === 'indianapi' ? loadIndianApiFinancials(ticker, options) : loadFmpFinancials(ticker, options.fetcher);
  const router = Router();
  const enabled = (): Features => ({ ...features(), ...options.features });

  function sendDisabled(res: express.Response, feature: string, flag: string) {
    return res.status(404).json({ error: 'disabled', message: `${feature} is disabled on this server. Set ${flag}=true to enable it.` });
  }

  router.get('/features', (_req, res) => {
    res.json(enabled());
  });

  router.get('/:ticker/quantitative', async (req, res) => {
    const ticker = req.params.ticker;
    const overrides = parseAssumptionOverrides(req.query);
    if (!overrides) {
      return res.status(400).json(invalidOverridesError);
    }
    const key = `analysis:quant:${provider}:${ticker}:${overridesKey(overrides)}`;
    if (sendCacheHit(res, key)) {
      return;
    }
    try {
      const f = await loadQuantitativeInputs(ticker);
      const defaults = deriveDefaults(f.history);
      if (!defaults) {
        return res.status(422).json({ error: 'Not enough historical financials to run a DCF' });
      }
      const assumptions = resolveAssumptions(defaults, overrides);
      if (assumptions.discountRate <= assumptions.terminalGrowthRate) {
        return res.status(400).json(discountNotAboveTerminalError);
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
        scenarios: computeScenarios(f.history, assumptions, f.shares, f.price),
      };
      cachePut(key, body);
      res.json({ ...body, cached: false, cachedAt: Date.now() });
    } catch (err) {
      sendUpstreamError(res, ticker, err);
    }
  });

  // Growth is what we solve for, so only discount and terminal growth can be overridden.
  router.get('/:ticker/reverse-dcf', async (req, res) => {
    const ticker = req.params.ticker;
    const parsed = parseAssumptionOverrides(req.query);
    if (!parsed) {
      return res.status(400).json(invalidOverridesError);
    }
    const overrides = { ...parsed, growthRate: undefined };
    const key = `analysis:reverse-dcf:${provider}:${ticker}:${overridesKey(overrides)}`;
    if (sendCacheHit(res, key)) {
      return;
    }
    try {
      const f = await loadQuantitativeInputs(ticker);
      const defaults = deriveDefaults(f.history);
      const assumptions = defaults && resolveAssumptions(defaults, overrides);
      if (assumptions && assumptions.discountRate <= assumptions.terminalGrowthRate) {
        return res.status(400).json(discountNotAboveTerminalError);
      }
      const body = {
        ticker,
        price: f.price,
        assumptions: assumptions && {
          discountRate: assumptions.discountRate,
          terminalGrowthRate: assumptions.terminalGrowthRate,
        },
        ...(assumptions
          ? reverseDcf(f.history, assumptions, f.shares, f.price)
          : reverseDcfUnavailable('Not enough historical financials to run a DCF')),
      };
      cachePut(key, body);
      res.json({ ...body, cached: false, cachedAt: Date.now() });
    } catch (err) {
      sendUpstreamError(res, ticker, err);
    }
  });

  // Deterministic, so it is computed on every request from the cached financials.
  router.get('/:ticker/red-flags', async (req, res) => {
    const ticker = req.params.ticker;
    try {
      const f = await loadQuantitativeInputs(ticker);
      res.json(f.history.length
        ? { ticker, status: 'ok', message: null, ...redFlagScan(f) }
        : { ticker, status: 'unavailable', message: 'No annual financials available to scan', flags: [], skipped: [] });
    } catch (err) {
      sendUpstreamError(res, ticker, err);
    }
  });

  router.get('/:ticker/strengths-weaknesses', async (req, res) => {
    const ticker = req.params.ticker;
    try {
      const f = await loadQuantitativeInputs(ticker);
      res.json(f.history.length
        ? { ticker, status: 'ok', message: null, ...strengthsWeaknesses(f) }
        : { ticker, status: 'unavailable', message: 'No annual financials available to compare', strengths: [], weaknesses: [], skipped: [] });
    } catch (err) {
      sendUpstreamError(res, ticker, err);
    }
  });

  router.get('/:ticker/statements', async (req, res) => {
    const ticker = req.params.ticker;
    try {
      const f = await loadQuantitativeInputs(ticker);
      res.json({ ticker, years: financialStatements(f.history, provider === 'fmp' ? RUPEES_PER_CRORE : 1) });
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
      const { model } = llmConfig();
      del(swotKey(req.params.ticker, model));
      del(insightsKey(req.params.ticker, model));
      del(guidanceKey(req.params.ticker, model));
      delPrefix(qualPrefix(req.params.ticker));
      await Promise.all([
        forgetStoredYear(req.params.ticker, year),
        forgetStoredSwot(req.params.ticker, year),
        forgetStoredInsights(req.params.ticker, year),
        forgetStoredGuidance(req.params.ticker, year),
        forgetStoredQualitative(req.params.ticker),
      ]);
      res.status(201).json({ ticker: req.params.ticker, year, bytes: body.length });
    }
  );

  // One LLM call on the Latest annual report; repeat requests are served from memory, then disk.
  router.get('/:ticker/insights', async (req, res) => {
    const ticker = req.params.ticker;
    const { model } = llmConfig();
    const key = insightsKey(ticker, model);
    const hit = cacheGet<unknown>(key);
    if (hit) {
      console.log(`[analysis cache HIT] ${key}`);
      return res.json({ ...(hit.value as object), cached: true, cachedAt: hit.cachedAt });
    }
    try {
      const { entry, cached } = await latestReportInsights(ticker, model, {
        listReports: options.insights?.listReports ?? ((t, n) => listReports(t, n, options.fetcher)),
        textOf: options.insights?.textOf,
        judge: options.insights?.judge,
      });
      if (!entry) {
        return res.status(422).json({
          error: 'no-reports',
          message: 'The latest annual report could not be fetched. Upload it as a PDF.',
        });
      }
      const body = {
        ticker,
        model,
        experimental: true,
        year: entry.year,
        source: entry.source,
        status: entry.found ? 'ok' : 'no-mdna',
        message: entry.found ? null : 'No Management Discussion and Analysis or risk sections found in the report.',
        insights: entry.insights,
      };
      cachePut(key, body);
      res.json({ ...body, cached, cachedAt: Date.now() });
    } catch (err: any) {
      console.error(`[insights error] ${ticker}: ${err?.message || err}`);
      if (err instanceof LlmError) {
        return res.status(503).json({ error: 'llm-unavailable', message: `The language model is unavailable: ${err.message}` });
      }
      res.status(502).json({ error: 'failed', message: 'The annual report could not be analysed.' });
    }
  });

  // At most one LLM call per annual report, ever (stored on disk); scoring against the financials is deterministic.
  // Returns a partial result: a year whose extraction fails does not hide the cached years.
  router.post('/:ticker/guidance', async (req, res) => {
    const ticker = req.params.ticker;
    const { model } = llmConfig();
    const key = guidanceKey(ticker, model);
    try {
      let years = cacheGet<GuidanceYear[]>(key)?.value;
      if (!years) {
        years = await collectGuidance(ticker, model, 3, {
          listReports: options.guidance?.listReports ?? ((t, n) => listReports(t, n, options.fetcher)),
          textOf: options.guidance?.textOf,
          extract: options.guidance?.extract,
          sharedClaims:
            options.guidance?.sharedClaims ?? (async (year) => (await readStoredInsights(ticker, year, model))?.insights?.guidance),
        });
        if (years.every((y) => y.status === 'ok' || y.status === 'no-guidance')) {
          cachePut(key, years);
        }
      }
      if (!years.length) {
        return res.status(422).json({
          error: 'no-reports',
          message: 'Annual reports could not be fetched. Upload them as PDFs via POST /api/analysis/:ticker/reports?year=YYYY.',
        });
      }
      const financials = await loadQuantitativeInputs(ticker);
      res.json({ ticker, model, experimental: true, ...guidanceScorecard(years, financials.history) });
    } catch (err: any) {
      console.error(`[guidance error] ${ticker}: ${err?.message || err}`);
      sendUpstreamError(res, ticker, err);
    }
  });

  router.post('/:ticker/qualitative', express.json(), async (req, res) => {
    if (!enabled().qualitative) {
      return sendDisabled(res, 'The Qualitative analysis', 'ENABLE_QUALITATIVE');
    }
    const ticker = req.params.ticker;
    const peerOverride: string[] | undefined = Array.isArray(req.body?.peers)
      ? req.body.peers.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : undefined;
    const { model } = llmConfig();
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
      if (err instanceof LlmError) {
        return res.status(503).json({ error: 'llm-unavailable', message: err.message });
      }
      sendUpstreamError(res, ticker, err);
    }
  });

  // SWOT returns a partial result: financials S/W survive a missing report or an unreachable LLM, and vice versa.
  router.post('/:ticker/swot', async (req, res) => {
    if (!enabled().swot) {
      return sendDisabled(res, 'The SWOT analysis', 'ENABLE_SWOT');
    }
    const ticker = req.params.ticker;
    const { model } = llmConfig();
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
      report = err instanceof LlmError
        ? { status: 'llm-unavailable', message: `The language model is unavailable: ${err.message}`, year: null, source: null, cached: false }
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
