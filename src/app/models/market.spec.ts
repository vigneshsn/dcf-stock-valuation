import { MarketDescriptor, MarketFormat } from './market';

const INDIA: MarketDescriptor = {
    edition: 'india', currencySymbol: '₹', locale: 'en-IN', statementDivisor: 1, unitLabel: '₹ crore', unitShort: '₹ cr'
};
const US: MarketDescriptor = {
    edition: 'us', currencySymbol: '$', locale: 'en-US', statementDivisor: 1e6, unitLabel: '$ millions', unitShort: '$M'
};

describe('MarketFormat', () => {
    it('formats prices with the edition currency and locale grouping', () => {
        expect(new MarketFormat(INDIA).price(123456.5)).toBe('₹1,23,456.5');
        expect(new MarketFormat(US).price(1234.5)).toBe('$1,234.5');
        expect(new MarketFormat(US).price(null)).toBe('N/A');
    });

    it('formats market cap in crores for India, normalising raw rupees', () => {
        const india = new MarketFormat(INDIA);
        expect(india.marketCap(1750000)).toBe('₹17,50,000 Cr');
        expect(india.marketCap(1.75e13)).toBe('₹17,50,000 Cr');
        expect(india.marketCap(null)).toBe('N/A');
    });

    it('formats market cap compactly in dollars for the US', () => {
        expect(new MarketFormat(US).marketCap(5.09e12)).toBe('$5.09T');
        expect(new MarketFormat(US).marketCap(2.5e9)).toBe('$2.5B');
    });

    it('formats signed money amounts and statement numbers', () => {
        expect(new MarketFormat(INDIA).money(-1234567)).toBe('−₹12,34,567');
        expect(new MarketFormat(US).money(1234567)).toBe('$1,234,567');
        expect(new MarketFormat(US).number(1234567.4)).toBe('1,234,567');
    });

    it('formats statement amounts with the short unit', () => {
        expect(new MarketFormat(INDIA).statementAmount(1000)).toBe('₹1,000 cr');
        expect(new MarketFormat(US).statementAmount(-1000)).toBe('−$1,000M');
    });

    it('exposes the reporting unit labels', () => {
        expect(new MarketFormat(INDIA).unitLabel).toBe('₹ crore');
        expect(new MarketFormat(US).unitShort).toBe('$M');
    });
});
