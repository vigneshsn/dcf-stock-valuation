export interface MarketDescriptor {
    edition: 'india' | 'us';
    currencySymbol: string;
    locale: string;
    statementDivisor: number;
    unitLabel: string;
    /** Appended to a currency amount in running text, e.g. ' cr' or 'M'. */
    unitSuffix: string;
    marketCapNotation: 'standard' | 'compact';
    marketCapSuffix: string;
    tickerLabel: string;
    exampleTickers: string[];
}

/** Formats money and market-cap figures for one Market edition. */
export class MarketFormat {
    constructor(private readonly market: MarketDescriptor) {}

    get unitShort(): string {
        return this.market.currencySymbol + this.market.unitSuffix;
    }

    number(value: number, maxFractionDigits = 0): string {
        return value.toLocaleString(this.market.locale, { maximumFractionDigits: maxFractionDigits });
    }

    price(value: number | null | undefined, maxFractionDigits = 2): string {
        return value == null ? 'N/A' : `${this.market.currencySymbol}${this.number(value, maxFractionDigits)}`;
    }

    money(value: number): string {
        return `${value < 0 ? '−' : ''}${this.market.currencySymbol}${this.number(Math.abs(value))}`;
    }

    /** A statement amount with its unit suffix, e.g. ₹1,000 cr or $1,000M. */
    statementAmount(value: number): string {
        return this.money(value) + this.market.unitSuffix;
    }

    marketCap(value: number | null | undefined): string {
        if (value == null) {
            return 'N/A';
        }
        const compact = this.market.marketCapNotation === 'compact';
        const formatted = new Intl.NumberFormat(this.market.locale, {
            notation: this.market.marketCapNotation,
            maximumFractionDigits: compact ? 2 : 0
        }).format(value);
        return `${this.market.currencySymbol}${formatted}${this.market.marketCapSuffix}`;
    }
}
