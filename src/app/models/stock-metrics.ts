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
    /** Set by the server when expired FMP data was served because the API was unavailable or the daily call budget was spent. */
    stale?: boolean;
    dataAsOf?: number;
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
}

export type PeerRow = StockMetrics['peers'][number] & { current: boolean };
