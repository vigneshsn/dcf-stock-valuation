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
