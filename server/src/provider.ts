export type StockDataProvider = 'indianapi' | 'fmp';

export function configuredProvider(provider?: StockDataProvider): StockDataProvider {
  const configured = provider ?? (process.env.STOCK_DATA_PROVIDER?.trim().toLowerCase() || 'indianapi');
  if (configured !== 'indianapi' && configured !== 'fmp') {
    throw new Error(`Unsupported STOCK_DATA_PROVIDER: ${configured}`);
  }
  return configured;
}
