import { Router } from 'express';
import { configuredProvider, StockDataProvider } from './provider.js';

export interface MarketDescriptor {
  edition: 'india' | 'us';
  currencySymbol: string;
  locale: string;
  /** Divides raw provider statement amounts into the reporting unit. */
  statementDivisor: number;
  unitLabel: string;
  unitShort: string;
}

const INDIA: MarketDescriptor = {
  edition: 'india',
  currencySymbol: '₹',
  locale: 'en-IN',
  statementDivisor: 1,
  unitLabel: '₹ crore',
  unitShort: '₹ cr',
};

const US: MarketDescriptor = {
  edition: 'us',
  currencySymbol: '$',
  locale: 'en-US',
  statementDivisor: 1e6,
  unitLabel: '$ millions',
  unitShort: '$M',
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
