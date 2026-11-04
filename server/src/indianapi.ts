import { calculateAnnualReturns, mapAnnualStatements } from './finance.js';
import { QuantitativeInputs, YearFinancials } from './dcf.js';
import { PromoterHolding } from './redFlags.js';
import { PeerRatios } from './strengths.js';

const DEFAULT_INDIANAPI_URL = 'https://stock.indianapi.in';

type JsonRecord = Record<string, unknown>;

export interface CompanyIntroduction {
  name: string;
  industry: string | null;
  description: string | null;
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
  peers: StockPeer[];
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

function annualRows(financials: unknown): JsonRecord[] {
  return (Array.isArray(financials) ? financials : [])
    .map(record)
    .filter((row) => stringValue(row.Type)?.toLowerCase() === 'annual');
}

function fiscalYear(row: JsonRecord): number | null {
  const year = numberValue(row.FiscalYear);
  return year != null && Number.isInteger(year) ? year : null;
}

function statement(row: JsonRecord, type: 'INC' | 'BAL' | 'CAS'): JsonRecord {
  return keyedValues(record(row.stockFinancialMap)[type]);
}

function annualReturns(rows: JsonRecord[]): { roce: number | null; roe: number | null } {
  const annualIncome = mapAnnualStatements(rows, fiscalYear, (row) => {
    const income = statement(row, 'INC');
    return {
      ebit: numberValue(income.OperatingIncome),
      netIncome: numberValue(income.NetIncome),
    };
  });
  const annualBalance = mapAnnualStatements(rows, fiscalYear, (row) => {
    const balance = statement(row, 'BAL');
    return {
      totalAssets: numberValue(balance.TotalAssets),
      totalCurrentLiabilities: numberValue(balance.TotalCurrentLiabilities),
      totalStockholdersEquity: numberValue(balance.TotalEquity),
    };
  });
  return calculateAnnualReturns(annualIncome, annualBalance);
}

// Banks report interest and non-interest income instead of a total revenue line.
function bankRevenue(income: JsonRecord): number | null {
  const interestIncome = numberValue(income.InterestIncomeBank);
  return interestIncome == null ? null : interestIncome + (numberValue(income['Non-InterestIncomeBank']) ?? 0);
}

// Newest first, limited to the five most recent fiscal years like the FMP history.
function annualHistory(rows: JsonRecord[]): YearFinancials[] {
  const seen = new Set<number>();
  return rows
    .flatMap((row) => {
      const year = fiscalYear(row);
      const income = statement(row, 'INC');
      const cash = statement(row, 'CAS');
      const balance = statement(row, 'BAL');
      const revenue = numberValue(income.TotalRevenue, income.Revenue) ?? bankRevenue(income);
      const netIncome = numberValue(income.NetIncome);
      const operatingIncome = numberValue(income.OperatingIncome);
      const depreciation = numberValue(cash['Depreciation/Depletion'], income['Depreciation/Amortization']);
      const capex = numberValue(cash.CapitalExpenditures);
      if (year == null || revenue == null || revenue <= 0 || netIncome == null) {
        return [];
      }
      return [{
        year,
        revenue,
        netIncome,
        capex: Math.abs(capex ?? 0),
        nonCashExpense: depreciation ?? 0,
        operatingCashFlow: numberValue(cash.CashfromOperatingActivities),
        receivables: numberValue(balance.TotalReceivablesNet),
        totalDebt: numberValue(balance.TotalDebt),
        totalEquity: numberValue(balance.TotalEquity),
        // IndianAPI has no EBITDA line, so it is operating income plus depreciation.
        reportedCapex: capex == null ? null : Math.abs(capex),
        ebitda: operatingIncome == null || depreciation == null ? null : operatingIncome + depreciation,
        totalAssets: numberValue(balance.TotalAssets),
        ebit: operatingIncome,
        currentLiabilities: numberValue(balance.TotalCurrentLiabilities),
      }];
    })
    .sort((a, b) => b.year - a.year)
    .filter(({ year }) => {
      if (seen.has(year)) {
        return false;
      }
      seen.add(year);
      return true;
    })
    .slice(0, 5);
}

// Quarterly promoter holding, oldest first; undefined when the response has no shareholding section.
// A company without a promoter group (e.g. ITC) reports an empty list.
function promoterHolding(shareholding: unknown): PromoterHolding[] | undefined {
  if (!Array.isArray(shareholding)) {
    return undefined;
  }
  const promoter = shareholding.map(record).find((group) =>
    /promoter/i.test(stringValue(group.displayName, group.categoryName) ?? ''));
  return (Array.isArray(promoter?.categories) ? promoter.categories : [])
    .map(record)
    .flatMap((entry) => {
      const date = stringValue(entry.holdingDate);
      const percent = numberValue(entry.percentage);
      return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && percent != null ? [{ date, percent }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
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

interface VerifiedStock {
  response: JsonRecord;
  profile: JsonRecord;
  companyName: string;
  currentPrice: number;
}

async function fetchVerifiedStock(
  ticker: string,
  apiKey: string | undefined,
  fetcher: typeof fetch,
  baseUrl: string
): Promise<VerifiedStock> {
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
  const companyName = stringValue(response.companyName);
  if (!companyName) {
    throw new IndianApiError('IndianAPI returned an unusable company identity');
  }
  if (searchMatch && comparableName(companyName) !== comparableName(searchName)) {
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
  return { response, profile, companyName, currentPrice };
}

function keyMetricGroups(response: JsonRecord) {
  const keyMetrics = record(response.keyMetrics);
  return {
    details: record(response.stockDetailsReusableData),
    valuation: keyedValues(keyMetrics.valuation),
    perShare: keyedValues(keyMetrics.persharedata),
    priceAndVolume: keyedValues(keyMetrics.priceandVolume),
  };
}

export async function fetchIndianApiStock(
  ticker: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  baseUrl: string = process.env.INDIANAPI_BASE_URL || DEFAULT_INDIANAPI_URL
): Promise<StockData> {
  const { response, profile, companyName, currentPrice } = await fetchVerifiedStock(ticker, apiKey, fetcher, baseUrl);
  const { details, valuation, perShare, priceAndVolume } = keyMetricGroups(response);
  const description = stringValue(profile.companyDescription, profile.description);
  const industry = stringValue(response.industry, profile.mgIndustry, profile.industry);
  const returns = annualReturns(annualRows(response.financials));
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
      name: companyName,
      industry,
      description: description?.slice(0, 500) ?? null,
    },
    peers,
  };
}

export async function fetchIndianApiQuantitativeInputs(
  ticker: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  baseUrl: string = process.env.INDIANAPI_BASE_URL || DEFAULT_INDIANAPI_URL
): Promise<QuantitativeInputs> {
  const { response, currentPrice } = await fetchVerifiedStock(ticker, apiKey, fetcher, baseUrl);
  const { details, valuation, perShare } = keyMetricGroups(response);
  const rows = annualRows(response.financials);
  const latestBalance = [...rows]
    .filter((row) => fiscalYear(row) != null)
    .sort((a, b) => fiscalYear(b)! - fiscalYear(a)!)
    .map((row) => statement(row, 'BAL'))[0] ?? {};
  // Use the reported share count rather than market cap / price: IndianAPI does not document the
  // market-cap unit, whereas the share count shares the statements' unit scale. Zero yields no DCF.
  const shares = numberValue(latestBalance.TotalCommonSharesOutstanding) ?? 0;
  const bookValue = numberValue(perShare.bookValuePerShareMostRecentFiscalYear);
  const { roe, roce } = annualReturns(rows);
  const totalDebt = numberValue(latestBalance.TotalDebt);
  const totalEquity = numberValue(latestBalance.TotalEquity);

  return {
    price: currentPrice,
    shares,
    pe: numberValue(
      details.pPerEBasicExcludingExtraordinaryItemsTTM,
      valuation.pPerEBasicExcludingExtraordinaryItemsTTM
    ),
    pb: numberValue(valuation.priceToBookMostRecentFiscalYear) ??
      (bookValue != null && bookValue > 0 ? currentPrice / bookValue : null),
    // The quantitative analysis contract expresses ROE as a fraction, not percentage points.
    roe: roe == null ? null : roe / 100,
    roce: roce == null ? null : roce / 100,
    debtToEquity: totalDebt != null && totalEquity != null && totalEquity > 0 ? totalDebt / totalEquity : null,
    history: annualHistory(rows),
    promoterHolding: promoterHolding(response.shareholding),
    peers: peerRatios(record(response.companyProfile).peerCompanyList ?? response.peerCompanyList),
  };
}

// Undefined when the response has no peer list, so the peer benchmark is reported as not provided.
// IndianAPI sends 0 for ratios it does not have, so an exact 0 is treated as not reported.
function peerRatios(value: unknown): PeerRatios[] | undefined {
  const reported = (v: number | null) => (v === 0 ? null : v);
  return Array.isArray(value)
    ? normalizePeers(value).map((p) => ({ name: p.name, roe: reported(p.roe), netMargin: reported(p.profitMargin) }))
    : undefined;
}
