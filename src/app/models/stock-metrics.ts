export interface StockMetrics {
    marketCap: number | null;
    currentPrice: number | null;
    week52High: number | null;
    week52Low: number | null;
    peRatio: number | null;
    bookValue: number | null;
    dividendYield: number | null;
    roce: number | null;
    roe: number | null;
    companyIntroduction: {
        name: string;
        industry: string | null;
        description: string | null;
    } | null;
    news: {
        headline: string;
        publishedAt: string;
        source: string | null;
        url: string;
    }[];
    peers: {
        name: string;
        price: number | null;
        marketCap: number | null;
        peRatio: number | null;
        pbRatio: number | null;
        roe: number | null;
        debtToEquity: number | null;
        profitMargin: number | null;
        dividendYield: number | null;
    }[];
    analystConsensus: {
        source: 'IndianAPI';
        recommendation: string | null;
        counts: {
            strongBuy: number | null;
            buy: number | null;
            hold: number | null;
            sell: number | null;
            strongSell: number | null;
        };
    } | null;
}

export type PeerRow = StockMetrics['peers'][number] & { current: boolean };

/** IndianAPI reports market cap in crores while FMP reports raw rupees; normalise to crores. */
export function marketCapCrores(value: number | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    return value >= 1e8 ? value / 1e7 : value;
}
