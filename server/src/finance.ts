export function calculateROCE(
  ebit: number | null | undefined,
  totalAssets: number | null | undefined,
  totalCurrentLiabilities: number | null | undefined
): number | null {
  if (ebit == null || totalAssets == null || totalCurrentLiabilities == null) {
    return null;
  }
  const capitalEmployed = totalAssets - totalCurrentLiabilities;
  if (capitalEmployed <= 0) {
    return null;
  }
  return ebit / capitalEmployed;
}

export function calculateROE(
  netIncome: number | null | undefined,
  totalStockholderEquity: number | null | undefined
): number | null {
  if (netIncome == null || totalStockholderEquity == null) {
    return null;
  }
  if (totalStockholderEquity <= 0) {
    return null;
  }
  return netIncome / totalStockholderEquity;
}

export interface AnnualIncomeMetrics {
  year: number;
  ebit: number | null;
  netIncome: number | null;
}

export interface AnnualBalanceMetrics {
  year: number;
  totalAssets: number | null;
  totalCurrentLiabilities: number | null;
  totalStockholdersEquity: number | null;
}

export function mapAnnualStatements<T, Metrics extends object>(
  rows: T[],
  yearOf: (row: T) => number | null,
  metricsOf: (row: T) => Metrics
): Array<Metrics & { year: number }> {
  return rows.flatMap((row) => {
    const year = yearOf(row);
    return year == null ? [] : [{ ...metricsOf(row), year }];
  });
}

export function calculateAnnualReturns(
  incomeStatements: AnnualIncomeMetrics[],
  balanceSheets: AnnualBalanceMetrics[]
): { roce: number | null; roe: number | null } {
  const incomeByYear = new Map<number, AnnualIncomeMetrics>();
  const balanceByYear = new Map<number, AnnualBalanceMetrics>();
  for (const statement of incomeStatements) {
    if (!incomeByYear.has(statement.year)) {
      incomeByYear.set(statement.year, statement);
    }
  }
  for (const statement of balanceSheets) {
    if (!balanceByYear.has(statement.year)) {
      balanceByYear.set(statement.year, statement);
    }
  }

  const years = [...incomeByYear.keys()].filter((year) => balanceByYear.has(year)).sort((a, b) => b - a);
  for (const year of years) {
    const income = incomeByYear.get(year)!;
    const balance = balanceByYear.get(year)!;
    const inputs = [
      income.ebit,
      income.netIncome,
      balance.totalAssets,
      balance.totalCurrentLiabilities,
      balance.totalStockholdersEquity,
    ];
    if (inputs.some((value) => value == null || !Number.isFinite(value))) {
      continue;
    }
    const roce = calculateROCE(income.ebit, balance.totalAssets, balance.totalCurrentLiabilities);
    const roe = calculateROE(income.netIncome, balance.totalStockholdersEquity);
    return {
      roce: roce == null ? null : roce * 100,
      roe: roe == null ? null : roe * 100,
    };
  }
  return { roce: null, roe: null };
}
