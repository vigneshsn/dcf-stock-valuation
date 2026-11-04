export interface MarketDescriptor {
    edition: 'india' | 'us';
    currencySymbol: string;
    locale: string;
    statementDivisor: number;
    unitLabel: string;
    unitShort: string;
}

/** Fallback used until the server's descriptor arrives. */
export const INDIA_MARKET: MarketDescriptor = {
    edition: 'india',
    currencySymbol: '₹',
    locale: 'en-IN',
    statementDivisor: 1,
    unitLabel: '₹ crore',
    unitShort: '₹ cr'
};

const RUPEES_PER_CRORE = 1e7;

/** Formats money and market-cap figures for one Market edition. */
export class MarketFormat {
    constructor(private readonly market: MarketDescriptor) {}

    get unitLabel(): string {
        return this.market.unitLabel;
    }

    get unitShort(): string {
        return this.market.unitShort;
    }

    get currencySymbol(): string {
        return this.market.currencySymbol;
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

    /** A statement amount with its short unit, e.g. ₹1,000 cr or $1,000M. */
    statementAmount(value: number): string {
        return this.money(value) + this.market.unitShort.slice(this.market.currencySymbol.length);
    }

    marketCap(value: number | null | undefined): string {
        if (value == null) {
            return 'N/A';
        }
        if (this.market.edition === 'us') {
            const compact = new Intl.NumberFormat(this.market.locale, {
                notation: 'compact',
                maximumFractionDigits: 2
            }).format(value);
            return `${this.market.currencySymbol}${compact}`;
        }
        // IndianAPI reports crores while raw-rupee sources report rupees; normalise to crores.
        const crores = value >= 1e8 ? value / RUPEES_PER_CRORE : value;
        return `${this.market.currencySymbol}${this.number(crores)} Cr`;
    }
}
