import { Router } from 'express';
import { configuredProvider, StockDataProvider } from './provider.js';

export interface MarketDescriptor {
  edition: 'india' | 'us';
  currencySymbol: string;
  locale: string;
  /** Divides raw provider statement amounts into the reporting unit. */
  statementDivisor: number;
  unitLabel: string;
  /** Appended to a currency amount in running text, e.g. ' cr' or 'M'. */
  unitSuffix: string;
  marketCapNotation: 'standard' | 'compact';
  marketCapSuffix: string;
  /** What a ticker is called in the UI, e.g. 'NSE' or 'US'. */
  tickerLabel: string;
  /** Well-known tickers offered as one-click examples. */
  exampleTickers: string[];
}

const INDIA: MarketDescriptor = {
  edition: 'india',
  currencySymbol: '₹',
  locale: 'en-IN',
  statementDivisor: 1,
  unitLabel: '₹ crore',
  unitSuffix: ' cr',
  marketCapNotation: 'standard',
  marketCapSuffix: ' Cr',
  tickerLabel: 'NSE',
  exampleTickers: ['TCS', 'RELIANCE', 'INFY', 'ITC', 'HDFCBANK'],
};

const US: MarketDescriptor = {
  edition: 'us',
  currencySymbol: '$',
  locale: 'en-US',
  statementDivisor: 1e6,
  unitLabel: '$ millions',
  unitSuffix: 'M',
  marketCapNotation: 'compact',
  marketCapSuffix: '',
  tickerLabel: 'US',
  exampleTickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'],
};

export function marketDescriptor(provider: StockDataProvider): MarketDescriptor {
  return provider === 'fmp' ? US : INDIA;
}

export function createMarketRouter(provider?: StockDataProvider): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json(marketDescriptor(configuredProvider(provider)));
  });
  return router;
}

export default createMarketRouter();
