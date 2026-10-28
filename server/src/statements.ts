import { YearFinancials } from './dcf.js';

/** One fiscal year of the curated income statement, balance sheet and cash flow. Amounts in ₹ crore. */
export interface StatementYear {
  year: number;
  revenue: number | null;
  ebitda: number | null;
  netProfit: number | null;
  /** Percent of revenue. */
  netMargin: number | null;
  totalAssets: number | null;
  borrowings: number | null;
  equity: number | null;
  debtToEquity: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  /** Cash from operations as a percent of net profit. */
  cashConversion: number | null;
}

const MAX_YEARS = 5;

// Pure: the latest five fiscal years, oldest first. `toCrores` divides amounts (1e7 for raw rupees).
export function financialStatements(history: YearFinancials[], toCrores = 1): StatementYear[] {
  const seen = new Set<number>();
  const latest = [...history]
    .sort((a, b) => b.year - a.year)
    .filter(({ year }) => !seen.has(year) && seen.add(year))
    .slice(0, MAX_YEARS)
    .reverse();
  const amount = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v / toCrores);

  return latest.map((y) => {
    const revenue = amount(y.revenue);
    const netProfit = amount(y.netIncome);
    const borrowings = amount(y.totalDebt);
    const equity = amount(y.totalEquity);
    const operatingCashFlow = amount(y.operatingCashFlow);
    const capex = amount(y.reportedCapex !== undefined ? y.reportedCapex : y.capex);
    return {
      year: y.year,
      revenue,
      ebitda: amount(y.ebitda),
      netProfit,
      netMargin: revenue != null && revenue > 0 && netProfit != null ? (netProfit / revenue) * 100 : null,
      totalAssets: amount(y.totalAssets),
      borrowings,
      equity,
      debtToEquity: borrowings != null && equity != null && equity > 0 ? borrowings / equity : null,
      operatingCashFlow,
      capex,
      freeCashFlow: operatingCashFlow != null && capex != null ? operatingCashFlow - capex : null,
      cashConversion: operatingCashFlow != null && netProfit != null && netProfit > 0
        ? (operatingCashFlow / netProfit) * 100
        : null,
    };
  });
}
