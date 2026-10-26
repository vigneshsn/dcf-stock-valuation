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
    /** null when the latest year is loss-making or has negative free cash flow. */
    scenarios: Scenarios | null;
    cached: boolean;
    cachedAt: number;
}

export interface Scenario extends DcfAssumptions {
    /** null when the DCF is undefined for these assumptions. */
    fairValuePerShare: number | null;
}

export interface Scenarios {
    bear: Scenario;
    base: Scenario;
    bull: Scenario;
    /** values[i][j] is the Fair value per share for growth[i] and discount[j]. */
    grid: { growth: number[]; discount: number[]; values: (number | null)[][] };
    /** Implied growth (percent): Fair value equals the price; null when none in [-20, 50]. */
    impliedGrowth: number | null;
}

export type ReverseDcfVerdict = 'expects-acceleration' | 'in-line' | 'expects-slowdown';

/** Rates are percentage points (9 = 9%). */
export interface ReverseDcfAnalysis {
    ticker: string;
    status: 'ok' | 'no-solution' | 'not-applicable' | 'unavailable';
    /** Why there is no Implied growth; null when status is ok. */
    message: string | null;
    price: number;
    assumptions: { discountRate: number; terminalGrowthRate: number } | null;
    impliedGrowth: number | null;
    /** Search bound reached when status is no-solution. */
    bound: number | null;
    historicalCagr: number | null;
    guidedGrowth: number | null;
    verdict: ReverseDcfVerdict | null;
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

/** Server feature flags; the Qualitative and SWOT analyses are off unless the server enables them. */
export interface Features {
    insights: boolean;
    qualitative: boolean;
    swot: boolean;
}

export type InsightListKey = 'keyPoints' | 'growthStrategy' | 'tailwinds' | 'headwinds' | 'risks';

export interface InsightItem {
    point: string;
    /** Verbatim report phrase backing the point, or null when it could not be verified. */
    quote: string | null;
}

export interface MdnaInsights {
    ticker: string;
    model: string;
    experimental: boolean;
    year: number;
    source: 'screener' | 'upload';
    status: 'ok' | 'no-mdna';
    message: string | null;
    insights: (Record<InsightListKey, InsightItem[]> & { moat: { rating: MoatRating; reasoning: string; quote: string | null } }) | null;
    cached: boolean;
    cachedAt: number;
}

export type RedFlagId =
    | 'profit-not-backed-by-cash'
    | 'cash-conversion-drop'
    | 'receivables-outpacing-sales'
    | 'debt-outpacing-revenue'
    | 'high-leverage'
    | 'shrinking-margins'
    | 'promoter-stake-falling'
    | 'promoter-pledging'
    | 'negative-free-cash-flow';

export interface RedFlag {
    id: RedFlagId;
    severity: 'watch' | 'warning';
    text: string;
    /** The metric values and years compared, so the flag can be verified. */
    evidence: string;
}

/** Red-flag scan: unscored, deterministic warnings; no flags is not a positive signal. */
export interface RedFlagScan {
    ticker: string;
    status: 'ok' | 'unavailable';
    message: string | null;
    flags: RedFlag[];
    /** Rules not evaluated because the data source does not supply their inputs. */
    skipped: { id: RedFlagId; reason: string }[];
}

export type GuidanceMetric = 'revenueGrowth' | 'netProfitGrowth' | 'margin' | 'capex' | 'debt' | 'other';
export type GuidanceVerdict = 'met' | 'near' | 'missed' | 'pending' | 'unscored';

export interface GuidanceClaim {
    metric: GuidanceMetric;
    /** Fractions for growth, margin and capex (share of revenue); debt-to-equity ratio for debt. */
    target: { min: number; max: number } | null;
    horizon: number | null;
    quote: string;
    actual: number | null;
    verdict: GuidanceVerdict;
}

export interface GuidanceYear {
    year: number;
    status: 'ok' | 'no-report' | 'no-guidance' | 'llm-unavailable' | 'failed';
    cached: boolean;
    claims: GuidanceClaim[];
}

/** Guidance scorecard: what management guided to in each report vs what the financials showed. Unscored. */
export interface GuidanceScorecard {
    ticker: string;
    model: string;
    experimental: true;
    lowerConfidence: boolean;
    /** met / (met + near + missed); null when nothing is scored. */
    hitRate: number | null;
    years: GuidanceYear[];
}
