import type { PromoterHolding } from './redFlags.js';

export interface YearFinancials {
  year: number;
  revenue: number;
  netIncome: number;
  capex: number;
  nonCashExpense: number;
  // Only used by the Red-flag scan. Undefined when the provider does not supply the metric, null when missing that year.
  operatingCashFlow?: number | null;
  receivables?: number | null;
  totalDebt?: number | null;
  totalEquity?: number | null;
  // Only used by the Financial statements; reportedCapex is null when the year has no capex line (capex is then 0).
  reportedCapex?: number | null;
  ebitda?: number | null;
  totalAssets?: number | null;
}

// Statement totals and share count must share a unit scale so totals / shares is a per-share price.
export interface QuantitativeInputs {
  price: number;
  shares: number;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  // Latest fiscal year, as fractions; only used by the SWOT analysis.
  roce?: number | null;
  debtToEquity?: number | null;
  // Only used by the Red-flag scan; undefined when the provider does not supply it.
  promoterHolding?: PromoterHolding[];
  history: YearFinancials[];
}

export interface DcfAssumptions {
  growthRate: number;
  discountRate: number;
  terminalGrowthRate: number;
}

export interface DcfResult {
  assumptions: DcfAssumptions;
  fairValuePerShare: number;
}

export interface QuantitativeScore {
  score: 1 | 2 | 3 | 4 | 5;
  explanation: string;
}

const PROJECTION_YEARS = 5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// history is ordered newest first
export function deriveDefaults(history: YearFinancials[]): DcfAssumptions | null {
  const usable = history.filter((y) => y.revenue > 0);
  if (usable.length < 2) {
    return null;
  }
  const newest = usable[0];
  const oldest = usable[usable.length - 1];
  const years = usable.length - 1;
  const cagr = (Math.pow(newest.revenue / oldest.revenue, 1 / years) - 1) * 100;
  const growthRate = round2(clamp(cagr, 0, 25));

  const yoy: number[] = [];
  for (let i = 0; i < usable.length - 1; i++) {
    yoy.push(((usable[i].revenue / usable[i + 1].revenue) - 1) * 100);
  }
  const mean = avg(yoy);
  const stdev = Math.sqrt(avg(yoy.map((g) => (g - mean) ** 2)));
  // Base 11% plus up to 4 points for revenue volatility
  const discountRate = round2(11 + clamp(stdev / 5, 0, 4));
  const terminalGrowthRate = round2(clamp(growthRate / 2, 2, Math.min(5, discountRate - 1)));
  return { growthRate, discountRate, terminalGrowthRate };
}

// Owner-earnings DCF, same method as the client-side DCF calculator.
export function computeFairValue(
  history: YearFinancials[],
  assumptions: DcfAssumptions,
  shares: number
): number | null {
  const { growthRate, discountRate, terminalGrowthRate } = assumptions;
  const usable = history.filter((y) => y.revenue > 0);
  if (!usable.length || !(shares > 0) || discountRate <= terminalGrowthRate) {
    return null;
  }
  const revenue = usable[0].revenue;
  const margin = avg(usable.map((y) => y.netIncome / y.revenue));
  const capex = avg(usable.map((y) => Math.abs(y.capex)));
  const nonCash = avg(usable.map((y) => y.nonCashExpense));

  let total = 0;
  let lastFcf = 0;
  for (let t = 1; t <= PROJECTION_YEARS; t++) {
    const projectedRevenue = revenue * Math.pow(1 + growthRate / 100, t);
    lastFcf = projectedRevenue * margin - capex + nonCash;
    total += lastFcf / Math.pow(1 + discountRate / 100, t);
  }
  const terminal = (lastFcf * (1 + terminalGrowthRate / 100)) / ((discountRate - terminalGrowthRate) / 100);
  total += terminal / Math.pow(1 + discountRate / 100, PROJECTION_YEARS);
  const perShare = total / shares;
  return Number.isFinite(perShare) ? round2(perShare) : null;
}

// Positive gap = market price is above Fair value.
export function quantitativeScore(fairValue: number, price: number): QuantitativeScore {
  if (!(fairValue > 0) || !(price > 0)) {
    throw new Error('Fair value and price must be positive');
  }
  const gap = (price - fairValue) / fairValue;
  const pct = Math.abs(gap * 100).toFixed(1);
  let score: QuantitativeScore['score'];
  let band: string;
  if (gap < -0.3) {
    score = 5;
    band = `${pct}% below Fair value (more than 30% below)`;
  } else if (gap < -0.1) {
    score = 4;
    band = `${pct}% below Fair value (10-30% below)`;
  } else if (gap <= 0.1) {
    score = 3;
    band = gap === 0 ? 'equal to Fair value' : `${pct}% ${gap < 0 ? 'below' : 'above'} Fair value (within ±10%)`;
  } else if (gap <= 0.3) {
    score = 2;
    band = `${pct}% above Fair value (10-30% above)`;
  } else {
    score = 1;
    band = `${pct}% above Fair value (more than 30% above)`;
  }
  return {
    score,
    explanation: `Market price ${round2(price)} is ${band} of ${round2(fairValue)}, giving a score of ${score}/5. Ratios do not affect this score.`,
  };
}

export interface Scenario extends DcfAssumptions {
  // null when the DCF is undefined for these assumptions (e.g. discount rate ≤ terminal growth)
  fairValuePerShare: number | null;
}

export interface Scenarios {
  bear: Scenario;
  base: Scenario;
  bull: Scenario;
  grid: SensitivityGrid;
  // Implied growth (percent): Fair value equals the price; null when none in the search range
  impliedGrowth: number | null;
}

export interface SensitivityGrid {
  growth: number[];
  discount: number[];
  // values[i][j] is the Fair value per share for growth[i] and discount[j]
  values: (number | null)[][];
}

// Percentage-point offsets around the base assumptions.
const SCENARIO_GROWTH_OFFSET = 5;
const SCENARIO_DISCOUNT_OFFSET = 1;
const IMPLIED_GROWTH_MIN = -20;
const IMPLIED_GROWTH_MAX = 50;
const GRID_GROWTH_STEPS = [-4, -2, 0, 2, 4];
const GRID_DISCOUNT_STEPS = [-2, -1, 0, 1, 2];

// A loss-making or cash-burning base year makes scenarios and Implied growth meaningless.
function hasMeaningfulBaseYear(history: YearFinancials[]): boolean {
  const latest = history.find((y) => y.revenue > 0);
  return !!latest && latest.netIncome >= 0 && latest.netIncome + latest.nonCashExpense - Math.abs(latest.capex) >= 0;
}

export function computeScenarios(
  history: YearFinancials[],
  base: DcfAssumptions,
  shares: number,
  price: number
): Scenarios | null {
  if (!hasMeaningfulBaseYear(history)) {
    return null;
  }
  const scenario = (assumptions: DcfAssumptions): Scenario => ({
    ...assumptions,
    fairValuePerShare: computeFairValue(history, assumptions, shares),
  });
  return {
    bear: scenario({
      ...base,
      growthRate: round2(base.growthRate - SCENARIO_GROWTH_OFFSET),
      discountRate: round2(base.discountRate + SCENARIO_DISCOUNT_OFFSET),
    }),
    base: scenario(base),
    bull: scenario({
      ...base,
      growthRate: round2(base.growthRate + SCENARIO_GROWTH_OFFSET),
      discountRate: round2(base.discountRate - SCENARIO_DISCOUNT_OFFSET),
    }),
    grid: sensitivityGrid(history, base, shares),
    impliedGrowth: impliedGrowthOrNull(solveImpliedGrowth(history, base, shares, price)),
  };
}

const impliedGrowthOrNull = (solution: ImpliedGrowthSolution) =>
  solution && 'growth' in solution ? solution.growth : null;

function sensitivityGrid(history: YearFinancials[], base: DcfAssumptions, shares: number): SensitivityGrid {
  const growth = GRID_GROWTH_STEPS.map((d) => round2(base.growthRate + d));
  const discount = GRID_DISCOUNT_STEPS.map((d) => round2(base.discountRate + d));
  const values = growth.map((growthRate) =>
    discount.map((discountRate) => computeFairValue(history, { ...base, growthRate, discountRate }, shares))
  );
  return { growth, discount, values };
}

type ImpliedGrowthSolution = { growth: number } | { bound: number } | null;

const SOLVE_TOLERANCE = 0.01; // ₹ per share
const SOLVE_MAX_ITERATIONS = 100;

// Bisection over growth, holding discount and terminal growth at the base values.
// Returns the search bound reached when no growth in range matches the price; null when the DCF is undefined
// or Fair value does not rise with growth (e.g. earlier losses make the average margin negative).
function solveImpliedGrowth(
  history: YearFinancials[],
  base: DcfAssumptions,
  shares: number,
  price: number
): ImpliedGrowthSolution {
  const gap = (growthRate: number) => {
    const fv = computeFairValue(history, { ...base, growthRate }, shares);
    return fv == null ? null : fv - price;
  };
  let lo = IMPLIED_GROWTH_MIN;
  let hi = IMPLIED_GROWTH_MAX;
  const gapLo = gap(lo);
  const gapHi = gap(hi);
  if (!(price > 0) || gapLo == null || gapHi == null || gapHi <= gapLo) {
    return null;
  }
  if (gapLo >= 0) return gapLo <= SOLVE_TOLERANCE ? { growth: lo } : { bound: lo };
  if (gapHi <= 0) return gapHi >= -SOLVE_TOLERANCE ? { growth: hi } : { bound: hi };
  let mid = (lo + hi) / 2;
  for (let i = 0; i < SOLVE_MAX_ITERATIONS; i++) {
    const g = gap(mid)!;
    if (Math.abs(g) <= SOLVE_TOLERANCE) break;
    if (g < 0) lo = mid;
    else hi = mid;
    mid = (lo + hi) / 2;
  }
  // + 0 turns -0 into 0
  return { growth: round2(mid) + 0 };
}

export type ReverseDcfVerdict = 'expects-acceleration' | 'in-line' | 'expects-slowdown';

export interface ReverseDcf {
  status: 'ok' | 'no-solution' | 'not-applicable' | 'unavailable';
  message: string | null;
  // Percent; null unless status is ok
  impliedGrowth: number | null;
  // Search bound reached when status is no-solution
  bound: number | null;
  historicalCagr: number | null;
  // Filled from the Guidance scorecard once it exists
  guidedGrowth: number | null;
  verdict: ReverseDcfVerdict | null;
}

const CAGR_MAX_YEARS = 5;
const VERDICT_BAND = 3;

const withoutResult = (
  status: 'not-applicable' | 'unavailable',
  message: string,
  historicalCagr: number | null
): ReverseDcf => ({ status, message, impliedGrowth: null, bound: null, historicalCagr, guidedGrowth: null, verdict: null });

export const reverseDcfUnavailable = (message: string): ReverseDcf => withoutResult('unavailable', message, null);

export function reverseDcf(
  history: YearFinancials[],
  assumptions: DcfAssumptions,
  shares: number,
  price: number
): ReverseDcf {
  const historicalCagr = revenueCagr(history);
  if (!hasMeaningfulBaseYear(history)) {
    return withoutResult(
      'not-applicable',
      'The latest year is loss-making or has negative free cash flow, so a DCF base is meaningless',
      historicalCagr
    );
  }
  const solution = solveImpliedGrowth(history, assumptions, shares, price);
  if (!solution) {
    return withoutResult(
      'not-applicable',
      'Fair value does not rise with growth for this history, so the price cannot be solved for growth',
      historicalCagr
    );
  }
  const impliedGrowth = 'growth' in solution ? solution.growth : null;
  const bound = 'bound' in solution ? solution.bound : null;
  const compared = impliedGrowth ?? bound!;
  return {
    status: bound == null ? 'ok' : 'no-solution',
    message: bound == null ? null : `Price implies ${bound > 0 ? 'more than' : 'less than'} ${formatPct(bound)} annual growth`,
    impliedGrowth,
    bound,
    historicalCagr,
    guidedGrowth: null,
    verdict: historicalCagr == null ? null : verdictFor(compared, historicalCagr),
  };
}

// Typographic minus so messages read "−20%"
const formatPct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v)}%`;

// history is ordered newest first; the window covers at most CAGR_MAX_YEARS calendar years
function revenueCagr(history: YearFinancials[]): number | null {
  const usable = history.filter((y) => y.revenue > 0);
  if (usable.length < 2) {
    return null;
  }
  const latest = usable[0];
  const earliest = usable.filter((y) => latest.year - y.year <= CAGR_MAX_YEARS).at(-1)!;
  const years = latest.year - earliest.year;
  if (years <= 0) {
    return null;
  }
  return round2((Math.pow(latest.revenue / earliest.revenue, 1 / years) - 1) * 100);
}

function verdictFor(impliedGrowth: number, historicalCagr: number): ReverseDcfVerdict {
  if (impliedGrowth > historicalCagr + VERDICT_BAND) return 'expects-acceleration';
  if (impliedGrowth < historicalCagr - VERDICT_BAND) return 'expects-slowdown';
  return 'in-line';
}
