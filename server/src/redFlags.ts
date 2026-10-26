import { YearFinancials } from './dcf.js';

// Ratios and growth rates are fractions; "pts" thresholds are fractions too (0.3 = 30 pts).
export const RED_FLAG_THRESHOLDS = {
  minCashConversion: 0.5,
  cashConversionDrop: 0.3,
  receivablesOverRevenueGrowth: 0.15,
  debtOverRevenueGrowth: 0.2,
  maxDebtToEquity: 1.5,
  promoterStakeDropPts: 5,
  promoterStakeYears: 2,
  maxPromoterPledged: 20,
} as const;

export type RedFlagSeverity = 'watch' | 'warning';

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
  severity: RedFlagSeverity;
  text: string;
  evidence: string;
}

export interface SkippedRule {
  id: RedFlagId;
  reason: string;
}

export interface PromoterHolding {
  /** ISO date of the shareholding filing. */
  date: string;
  /** Percentage points of total shares. */
  percent: number;
}

/**
 * Optional inputs are undefined when the data source does not supply them (the rule is listed as skipped),
 * and null or absent for a given year when the source supplies them but that value is missing (skipped silently).
 */
export interface RedFlagInputs {
  history: YearFinancials[];
  promoterHolding?: PromoterHolding[];
  /** Percentage of promoter holding that is pledged. */
  promoterPledged?: number | null;
}

type YearMetric = 'operatingCashFlow' | 'receivables' | 'totalDebt' | 'totalEquity';

const NOT_PROVIDED = 'not provided by data source';

const fy = (year: number) => `FY${String(year % 100).padStart(2, '0')}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${pct(v)}`;
const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pts = (v: number) => Number((v * 100).toFixed(1));
const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

// The latest n fiscal years, oldest first, or null unless they are consecutive.
function latestConsecutive(history: YearFinancials[], n: number): YearFinancials[] | null {
  const run = [...history].sort((a, b) => b.year - a.year).slice(0, n);
  if (run.length < n || run.some((y, i) => i > 0 && y.year !== run[i - 1].year - 1)) {
    return null;
  }
  return run.reverse();
}

const cashConversion = (y: YearFinancials): number | null =>
  known(y.operatingCashFlow) && y.netIncome > 0 ? y.operatingCashFlow / y.netIncome : null;

const growth = (prev: number | null | undefined, latest: number | null | undefined): number | null =>
  known(prev) && known(latest) && prev > 0 ? latest / prev - 1 : null;

const isoYearsBefore = (date: string, years: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

// Pure rules over the annual history and latest shareholding; never scored.
export function redFlagScan(inputs: RedFlagInputs): { flags: RedFlag[]; skipped: SkippedRule[] } {
  const T = RED_FLAG_THRESHOLDS;
  const flags: RedFlag[] = [];
  const skipped: SkippedRule[] = [];
  const { history } = inputs;
  const supplied = (...metrics: YearMetric[]) => metrics.every((m) => history.some((y) => y[m] !== undefined));
  const rule = (id: RedFlagId, needs: YearMetric[], check: () => void) => {
    if (needs.length && !supplied(...needs)) {
      skipped.push({ id, reason: NOT_PROVIDED });
    } else {
      check();
    }
  };
  const flag = (id: RedFlagId, severity: RedFlagSeverity, text: string, evidence: string) =>
    flags.push({ id, severity, text, evidence });
  const lastTwo = latestConsecutive(history, 2);

  rule('profit-not-backed-by-cash', ['operatingCashFlow'], () => {
    const ratios = lastTwo?.map(cashConversion);
    if (lastTwo && ratios?.every((r): r is number => r != null && r < T.minCashConversion)) {
      flag(
        'profit-not-backed-by-cash',
        'warning',
        `Operating cash flow below ${T.minCashConversion * 100}% of net income for 2 consecutive years`,
        `OCF/NI ${ratios.map((r) => r.toFixed(2)).join(', ')} (${lastTwo.map((y) => fy(y.year)).join(', ')})`
      );
    }
  });

  rule('cash-conversion-drop', ['operatingCashFlow'], () => {
    if (!lastTwo) return;
    const [prev, latest] = lastTwo;
    const [r0, r1] = [cashConversion(prev), cashConversion(latest)];
    if (r0 != null && r1 != null && r0 - r1 > T.cashConversionDrop) {
      flag(
        'cash-conversion-drop',
        'watch',
        `Cash conversion fell ${pts(r0 - r1)} pts in ${fy(latest.year)}`,
        `OCF/NI ${r0.toFixed(2)} → ${r1.toFixed(2)} (${fy(prev.year)} → ${fy(latest.year)})`
      );
    }
  });

  const outpacing = (id: RedFlagId, metric: 'receivables' | 'totalDebt', margin: number, label: string, text: string) =>
    rule(id, [metric], () => {
      if (!lastTwo) return;
      const [prev, latest] = lastTwo;
      const metricGrowth = growth(prev[metric], latest[metric]);
      const revenueGrowth = growth(prev.revenue, latest.revenue);
      if (metricGrowth != null && revenueGrowth != null && metricGrowth > revenueGrowth + margin) {
        flag(
          id,
          'watch',
          `${text} in ${fy(latest.year)}`,
          `${label} ${signedPct(metricGrowth)} vs revenue ${signedPct(revenueGrowth)} (${fy(prev.year)} → ${fy(latest.year)})`
        );
      }
    });
  outpacing('receivables-outpacing-sales', 'receivables', T.receivablesOverRevenueGrowth, 'Receivables', 'Receivables grew faster than sales');
  outpacing('debt-outpacing-revenue', 'totalDebt', T.debtOverRevenueGrowth, 'Total debt', 'Debt grew faster than revenue');

  rule('high-leverage', ['totalDebt', 'totalEquity'], () => {
    const latest = [...history].sort((a, b) => b.year - a.year)[0];
    if (latest && known(latest.totalDebt) && known(latest.totalEquity) && latest.totalEquity > 0) {
      const de = latest.totalDebt / latest.totalEquity;
      if (de > T.maxDebtToEquity) {
        flag('high-leverage', 'warning', 'High leverage', `Debt / equity ${de.toFixed(2)} (${fy(latest.year)})`);
      }
    }
  });

  rule('shrinking-margins', [], () => {
    // Three year-over-year declines need four fiscal years.
    const run = latestConsecutive(history, 4);
    const margins = run?.map((y) => y.netIncome / y.revenue);
    if (run && margins && margins.every((m, i) => i === 0 || m < margins[i - 1])) {
      flag(
        'shrinking-margins',
        'watch',
        'Net margin shrank in each of the last 3 years',
        `Net margin ${margins.map(pct).join(' → ')} (${fy(run[0].year)} → ${fy(run[run.length - 1].year)})`
      );
    }
  });

  if (inputs.promoterHolding === undefined) {
    skipped.push({ id: 'promoter-stake-falling', reason: NOT_PROVIDED });
  } else if (!inputs.promoterHolding.length) {
    skipped.push({ id: 'promoter-stake-falling', reason: 'no promoter holding reported' });
  } else {
    const holdings = [...inputs.promoterHolding].sort((a, b) => a.date.localeCompare(b.date));
    const latest = holdings[holdings.length - 1];
    const cutoff = isoYearsBefore(latest.date, T.promoterStakeYears);
    const base = holdings.filter((h) => h.date <= cutoff).pop();
    if (!base) {
      skipped.push({ id: 'promoter-stake-falling', reason: `data source provides less than ${T.promoterStakeYears} years of promoter holding` });
    } else if (base.percent - latest.percent > T.promoterStakeDropPts) {
      flag(
        'promoter-stake-falling',
        'watch',
        `Promoter stake fell ${Number((base.percent - latest.percent).toFixed(1))} pts over ${T.promoterStakeYears} years`,
        `Promoter holding ${base.percent.toFixed(1)}% → ${latest.percent.toFixed(1)}% (${base.date} → ${latest.date})`
      );
    }
  }

  if (inputs.promoterPledged === undefined) {
    skipped.push({ id: 'promoter-pledging', reason: NOT_PROVIDED });
  } else if (known(inputs.promoterPledged) && inputs.promoterPledged > T.maxPromoterPledged) {
    flag('promoter-pledging', 'warning', 'High promoter pledging', `Pledged ${inputs.promoterPledged.toFixed(1)}% of promoter holding`);
  }

  rule('negative-free-cash-flow', [], () => {
    const run = latestConsecutive(history, 3);
    const fcf = run?.map((y) => y.netIncome + y.nonCashExpense - y.capex);
    if (run && fcf?.every((v) => v < 0)) {
      flag(
        'negative-free-cash-flow',
        'warning',
        'Negative free cash flow in each of the last 3 years',
        `FCF (net income + non-cash − capex) ${fcf.map(fmt).join(', ')} (${run.map((y) => fy(y.year)).join(', ')})`
      );
    }
  });

  return { flags, skipped };
}
