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
