import { YearFinancials } from './dcf.js';

/** A finding is listed only when the metric differs from its benchmark by at least this fraction of the benchmark. */
export const MIN_RELATIVE_GAP = 0.2;
/** ...and by at least this absolute amount, so tiny bases (e.g. near-zero debt) do not produce large percentages. */
export const MIN_ABSOLUTE_GAP = { '%': 1, x: 0.1 } as const;
const MIN_HISTORY_YEARS = 2;
const MIN_PEERS = 2;
const MAX_YEARS = 5;

export type StrengthMetric = 'roce' | 'roe' | 'netMargin' | 'revenueGrowth' | 'debtToEquity' | 'cashConversion';
export type Benchmark = 'history' | 'peers';

/** Peer ratios as percentages (trailing twelve months); null when the peer does not report one. */
export interface PeerRatios {
  name: string;
  roe: number | null;
  netMargin: number | null;
}

export interface StrengthInputs {
  history: YearFinancials[];
  /** Undefined when the data source supplies no Peer set metrics. */
  peers?: PeerRatios[];
}

export interface Finding {
  metric: StrengthMetric;
  benchmark: Benchmark;
  text: string;
  value: number;
  benchmarkValue: number;
  /** Signed difference as a percent of the benchmark. */
  differencePct: number;
}

export interface SkippedComparison {
  metric: StrengthMetric;
  benchmark: Benchmark;
  reason: string;
}

export interface StrengthsWeaknesses {
  strengths: Finding[];
  weaknesses: Finding[];
  skipped: SkippedComparison[];
}

interface MetricDef {
  id: StrengthMetric;
  label: string;
  unit: '%' | 'x';
  higherIsBetter: boolean;
  /** Fields that must be supplied by the data source for the metric to be computed. */
  needs: (keyof YearFinancials)[];
  of: (y: YearFinancials) => number | null;
  peer?: (p: PeerRatios) => number | null;
}

const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const ratio = (num: number | null | undefined, den: number | null | undefined, scale = 100): number | null =>
  known(num) && known(den) && den > 0 ? (num / den) * scale : null;

const METRICS: MetricDef[] = [
  {
    id: 'roce',
    label: 'ROCE',
    unit: '%',
    higherIsBetter: true,
    needs: ['ebit', 'totalAssets', 'currentLiabilities'],
    of: (y) => ratio(y.ebit, known(y.totalAssets) && known(y.currentLiabilities) ? y.totalAssets - y.currentLiabilities : null),
  },
  {
    id: 'roe',
    label: 'ROE',
    unit: '%',
    higherIsBetter: true,
    needs: ['totalEquity'],
    of: (y) => ratio(y.netIncome, y.totalEquity),
    peer: (p) => p.roe,
  },
  {
    id: 'netMargin',
    label: 'Net margin',
    unit: '%',
    higherIsBetter: true,
    needs: [],
    of: (y) => ratio(y.netIncome, y.revenue),
    peer: (p) => p.netMargin,
  },
  // Revenue growth is special-cased: latest-year growth vs the CAGR of the earlier years.
  { id: 'revenueGrowth', label: 'Revenue growth', unit: '%', higherIsBetter: true, needs: [], of: () => null },
  {
    id: 'debtToEquity',
    label: 'Debt / equity',
    unit: 'x',
    higherIsBetter: false,
    needs: ['totalDebt', 'totalEquity'],
    of: (y) => ratio(y.totalDebt, y.totalEquity, 1),
  },
  {
    id: 'cashConversion',
    label: 'Cash conversion',
    unit: '%',
    higherIsBetter: true,
    needs: ['operatingCashFlow'],
    of: (y) => ratio(y.operatingCashFlow, y.netIncome),
  },
];

const fy = (year: number) => `FY${String(year % 100).padStart(2, '0')}`;
const span = (years: number[]) => (years.length === 1 ? fy(years[0]) : `${fy(years[0])}–${fy(years[years.length - 1])}`);
const show = (v: number, unit: '%' | 'x') => (unit === '%' ? `${v.toFixed(1)}%` : `${v.toFixed(2)}x`);
const average = (vs: number[]) => vs.reduce((s, v) => s + v, 0) / vs.length;
const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Pure: deterministic Strength / Weakness findings over the latest fiscal year; never scored.
export function strengthsWeaknesses({ history, peers }: StrengthInputs): StrengthsWeaknesses {
  const out: StrengthsWeaknesses = { strengths: [], weaknesses: [], skipped: [] };
  const seen = new Set<number>();
  const years = [...history]
    .sort((a, b) => b.year - a.year)
    .filter(({ year }) => !seen.has(year) && seen.add(year))
    .slice(0, MAX_YEARS)
    .reverse();
  const latest = years[years.length - 1];
  if (!latest) {
    return out;
  }
  const earlier = years.slice(0, -1);
  const skip = (metric: StrengthMetric, benchmark: Benchmark, reason: string) =>
    out.skipped.push({ metric, benchmark, reason });

  const compare = (m: MetricDef, benchmark: Benchmark, value: number | null, base: number | null, valueLabel: string, baseLabel: string) => {
    if (value == null || base == null) {
      return skip(m.id, benchmark, 'not enough data');
    }
    if (base <= 0) {
      return skip(m.id, benchmark, 'benchmark is zero or negative');
    }
    const gap = (value - base) / base;
    if (Math.abs(gap) < MIN_RELATIVE_GAP - 1e-9 || Math.abs(value - base) < MIN_ABSOLUTE_GAP[m.unit] - 1e-9) {
      return;
    }
    const finding: Finding = {
      metric: m.id,
      benchmark,
      text: `${m.label} ${show(value, m.unit)} ${valueLabel} vs ${show(base, m.unit)} ${baseLabel}`,
      value,
      benchmarkValue: base,
      differencePct: Number((gap * 100).toFixed(1)),
    };
    (gap > 0 === m.higherIsBetter ? out.strengths : out.weaknesses).push(finding);
  };

  for (const m of METRICS) {
    if (m.needs.some((field) => years.every((y) => y[field] === undefined))) {
      skip(m.id, 'history', 'not provided by data source');
      if (m.peer) skip(m.id, 'peers', 'not provided by data source');
      continue;
    }

    if (m.id === 'revenueGrowth') {
      const [first, prev] = [years[0], years[years.length - 2]];
      const consecutive = prev && latest.year - prev.year === 1;
      const periods = prev ? prev.year - first.year : 0;
      const growth = consecutive && prev.revenue > 0 ? (latest.revenue / prev.revenue - 1) * 100 : null;
      const cagr = periods >= 1 && first.revenue > 0 && prev.revenue > 0
        ? ((prev.revenue / first.revenue) ** (1 / periods) - 1) * 100
        : null;
      compare(m, 'history', growth, cagr, `in ${fy(latest.year)}`, `CAGR ${span([first.year, prev?.year ?? first.year])}`);
      continue;
    }

    const past = earlier.map((y) => ({ year: y.year, v: m.of(y) })).filter((p): p is { year: number; v: number } => p.v != null);
    compare(
      m,
      'history',
      m.of(latest),
      past.length >= MIN_HISTORY_YEARS ? average(past.map((p) => p.v)) : null,
      `in ${fy(latest.year)}`,
      `${span(past.map((p) => p.year))} average`
    );

    if (m.peer) {
      if (!peers) {
        skip(m.id, 'peers', 'not provided by data source');
        continue;
      }
      const values = peers.map(m.peer).filter(known);
      compare(
        m,
        'peers',
        m.of(latest),
        values.length >= MIN_PEERS ? median(values) : null,
        `in ${fy(latest.year)}`,
        `Peer set median (${values.length} peers, trailing 12 months)`
      );
    }
  }
  return out;
}
