import { MarketDescriptor } from '../models/market';
import { MarketService } from '../services/market.service';

export const INDIA_TEST_MARKET: MarketDescriptor = {
    edition: 'india',
    currencySymbol: '₹',
    locale: 'en-IN',
    statementDivisor: 1,
    unitLabel: '₹ crore',
    unitSuffix: ' cr',
    marketCapNotation: 'standard',
    marketCapSuffix: ' Cr'
};

export const US_TEST_MARKET: MarketDescriptor = {
    edition: 'us',
    currencySymbol: '$',
    locale: 'en-US',
    statementDivisor: 1e6,
    unitLabel: '$ millions',
    unitSuffix: 'M',
    marketCapNotation: 'compact',
    marketCapSuffix: ''
};

/** A MarketService with the given edition already applied, for specs. */
export function marketServiceFor(descriptor: MarketDescriptor = INDIA_TEST_MARKET): MarketService {
    const service = new MarketService();
    service.apply(descriptor);
    return service;
}
