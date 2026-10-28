import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YearFinancials } from './dcf.js';
import { strengthsWeaknesses } from './strengths.js';

// Flat history: ROE 20%, net margin 10%, D/E 0.5x, cash conversion 100%, ROCE 10%, revenue growth 10%/yr.
const year = (y: number, extra: Partial<YearFinancials> = {}): YearFinancials => {
  const revenue = 1000 * 1.1 ** (y - 2022);
  const netIncome = revenue * 0.1;
  return {
    year: y,
    revenue,
    netIncome,
    capex: 0,
    nonCashExpense: 0,
    totalEquity: netIncome * 5,
    totalDebt: netIncome * 2.5,
    operatingCashFlow: netIncome,
    ebit: revenue * 0.1,
    totalAssets: revenue * 1.5,
    currentLiabilities: revenue * 0.5,
    ...extra,
  };
};
const history = (latest: Partial<YearFinancials> = {}) => [
  ...[2022, 2023, 2024, 2025].map((y) => year(y)),
  year(2026, latest),
];
const metrics = (fs: { metric: string; benchmark: string }[]) => fs.map((f) => `${f.metric}:${f.benchmark}`);

test('lists nothing when the latest year is in line with its own history', () => {
  const r = strengthsWeaknesses({ history: history() });
  assert.deepEqual([r.strengths, r.weaknesses], [[], []]);
});

test('flags a gap of at least 20% vs the average of the earlier years, with both numbers', () => {
  const y = year(2026);
  const r = strengthsWeaknesses({
    history: history({
      operatingCashFlow: y.netIncome * 0.8, // exactly 20% below → weakness
      totalDebt: y.totalEquity! * 0.61, // 22% above the 0.5x average → weakness (lower is better)
      ebit: y.revenue * 0.119, // 19% above → not listed
    }),
  });
  assert.deepEqual(metrics(r.weaknesses), ['debtToEquity:history', 'cashConversion:history']);
  assert.deepEqual(r.strengths, []);
  assert.equal(r.weaknesses[1].text, 'Cash conversion 80.0% in FY26 vs 100.0% FY22–FY25 average');
  assert.equal(r.weaknesses[1].differencePct, -20);
});

test('compares latest-year revenue growth with the CAGR of the earlier years', () => {
  const r = strengthsWeaknesses({ history: history({ revenue: year(2025).revenue * 1.2, netIncome: year(2026).netIncome }) });
  const growth = r.strengths.find((f) => f.metric === 'revenueGrowth')!;
  assert.equal(growth.text, 'Revenue growth 20.0% in FY26 vs 10.0% CAGR FY22–FY25');
});

test('ignores a large relative gap on a tiny base, such as near-zero debt', () => {
  const earlier = [2022, 2023, 2024, 2025].map((y) => year(y, { totalDebt: 0.004 * year(y).totalEquity! }));
  const r = strengthsWeaknesses({ history: [...earlier, year(2026, { totalDebt: 0.03 * year(2026).totalEquity! })] });
  assert.ok(!r.weaknesses.some((f) => f.metric === 'debtToEquity'));
});

test('compares ROE and net margin with the Peer set median', () => {
  const peers = [
    { name: 'A', roe: 30, netMargin: 10 },
    { name: 'B', roe: 26, netMargin: 7 },
    { name: 'C', roe: null, netMargin: 8 },
  ];
  const r = strengthsWeaknesses({ history: history(), peers });
  assert.deepEqual(metrics(r.strengths), ['netMargin:peers']);
  assert.deepEqual(metrics(r.weaknesses), ['roe:peers']);
  assert.equal(r.weaknesses[0].text, 'ROE 20.0% in FY26 vs 28.0% Peer set median (2 peers, trailing 12 months)');
});

test('skips comparisons the data cannot support', () => {
  const r = strengthsWeaknesses({
    history: [2025, 2026].map((y) => year(y, { operatingCashFlow: undefined, netIncome: -10 })),
    peers: [{ name: 'A', roe: 20, netMargin: 5 }],
  });
  const skipped = (metric: string, benchmark: string) =>
    r.skipped.find((s) => s.metric === metric && s.benchmark === benchmark)?.reason;
  assert.equal(skipped('cashConversion', 'history'), 'not provided by data source');
  assert.equal(skipped('roe', 'history'), 'not enough data');
  assert.equal(skipped('netMargin', 'peers'), 'not enough data');
  assert.equal(skipped('revenueGrowth', 'history'), 'not enough data');
});

test('skips a benchmark that is zero or negative, and peers the source does not provide', () => {
  const losses = [2022, 2023, 2024, 2025].map((y) => year(y, { netIncome: -50 }));
  const r = strengthsWeaknesses({ history: [...losses, year(2026)] });
  assert.equal(r.skipped.find((s) => s.metric === 'netMargin' && s.benchmark === 'history')?.reason, 'benchmark is zero or negative');
  assert.equal(r.skipped.find((s) => s.metric === 'roe' && s.benchmark === 'peers')?.reason, 'not provided by data source');
});
