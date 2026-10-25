export interface DcfAssumptions {
    growthRate: number;
    discountRate: number;
    terminalGrowthRate: number;
}

export interface QuantitativeAnalysis {
    ticker: string;
    price: number;
    ratios: { pe: number | null; pb: number | null; roe: number | null };
    defaults: DcfAssumptions;
    assumptions: DcfAssumptions;
    overridden: boolean;
    fairValue: number;
    score: number;
    explanation: string;
    cached: boolean;
    cachedAt: number;
}

export interface Peer {
    symbol: string;
    name: string;
    marketCap: number | null;
}

export type MoatRating = 'wide' | 'narrow' | 'none';
export type GuidanceOutcome = 'met' | 'partly' | 'missed';

export interface QualitativeAnalysis {
    ticker: string;
    model: string;
    peers: Peer[];
    peersOverridden: boolean;
    yearsAnalysed: number[];
    skippedYears: number[];
    moat: { rating: MoatRating; reasoning: string; quote: string | null };
    management: {
        lowerConfidence: boolean;
        comparisons: { guidanceYear: number; actualsYear: number; outcome: GuidanceOutcome; reasoning: string; quote: string | null }[];
    };
    score: number;
    experimental: boolean;
    explanation: string;
    quotes: string[];
    cached: boolean;
    cachedAt: number;
}

export type SwotQuadrantKey = 'strengths' | 'weaknesses' | 'opportunities' | 'threats';

export interface SwotItem {
    text: string;
    source: 'report' | 'financials';
    /** Verified quote for report items, "<metric>: <value>" for financials items. */
    evidence: string;
}

export interface SwotQuadrant {
    items: SwotItem[];
    lowerConfidence: boolean;
}

export type SwotReportStatus = 'ok' | 'no-reports' | 'no-mdna' | 'llm-unavailable' | 'failed';

export interface SwotAnalysis extends Record<SwotQuadrantKey, SwotQuadrant> {
    ticker: string;
    model: string;
    experimental: boolean;
    report: { status: SwotReportStatus; message: string | null; year: number | null; source: 'screener' | 'upload' | null; cached: boolean };
    financials: { status: 'ok' | 'unavailable'; year: number | null; message: string | null };
}
