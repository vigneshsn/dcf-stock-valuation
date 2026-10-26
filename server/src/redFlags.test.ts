import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedFlagInputs, redFlagScan } from './redFlags.js';
import { YearFinancials } from './dcf.js';

// A healthy year: cash-backed profit, modest debt, positive FCF.
const year = (y: number, overrides: Partial<YearFinancials> = {}): YearFinancials => ({
  year: y,
  revenue: 1000,
  netIncome: 100,
  capex: 50,
  nonCashExpense: 20,
  operatingCashFlow: 110,
  receivables: 200,
  totalDebt: 300,
  totalEquity: 1000,
  ...overrides,
});

const healthy = (): YearFinancials[] => [2025, 2024, 2023, 2022, 2021].map((y) => year(y));

const scan = (history: YearFinancials[], extra: Partial<RedFlagInputs> = {}) =>
  redFlagScan({ history, promoterHolding: [], promoterPledged: null, ...extra });

const ids = (r: ReturnType<typeof redFlagScan>) => r.flags.map((f) => f.id);

test('healthy financials raise no flags', () => {
  assert.deepEqual(scan(healthy()).flags, []);
});

test('profit not backed by cash: OCF below 50% of net income in the latest 2 consecutive years', () => {
  const h = healthy();
  h[0] = year(2025, { operatingCashFlow: 38 });
  h[1] = year(2024, { operatingCashFlow: 42 });
  const flag = scan(h).flags.find((f) => f.id === 'profit-not-backed-by-cash');
  assert.deepEqual(flag, {
    id: 'profit-not-backed-by-cash',
    severity: 'warning',
    text: 'Operating cash flow below 50% of net income for 2 consecutive years',
    evidence: 'OCF/NI 0.42, 0.38 (FY24, FY25)',
  });

  h[1] = year(2024, { operatingCashFlow: 60 });
  assert.ok(!ids(scan(h)).includes('profit-not-backed-by-cash'), 'only one weak year');
});

test('cash conversion drop: OCF / net income fell more than 30 pts year over year', () => {
  const h = healthy();
  h[0] = year(2025, { operatingCashFlow: 55 });
  h[1] = year(2024, { operatingCashFlow: 95 });
  const flag = scan(h).flags.find((f) => f.id === 'cash-conversion-drop');
  assert.deepEqual(flag, {
    id: 'cash-conversion-drop',
    severity: 'watch',
    text: 'Cash conversion fell 40 pts in FY25',
    evidence: 'OCF/NI 0.95 → 0.55 (FY24 → FY25)',
  });

  h[0] = year(2025, { operatingCashFlow: 70 });
  assert.ok(!ids(scan(h)).includes('cash-conversion-drop'), 'a 25 pt drop is under the threshold');
});

test('cash-flow rules ignore loss-making years', () => {
  const h = healthy();
  h[0] = year(2025, { netIncome: -50, operatingCashFlow: -100 });
  h[1] = year(2024, { netIncome: -40, operatingCashFlow: -90 });
  const found = ids(scan(h));
  assert.ok(!found.includes('profit-not-backed-by-cash'));
  assert.ok(!found.includes('cash-conversion-drop'));
});

test('receivables outpacing sales: receivables growth more than 15 pts above revenue growth', () => {
  const h = healthy();
  h[0] = year(2025, { revenue: 1100, receivables: 260 });
  const flag = scan(h).flags.find((f) => f.id === 'receivables-outpacing-sales');
  assert.deepEqual(flag, {
    id: 'receivables-outpacing-sales',
    severity: 'watch',
    text: 'Receivables grew faster than sales in FY25',
    evidence: 'Receivables +30.0% vs revenue +10.0% (FY24 → FY25)',
  });

  h[0] = year(2025, { revenue: 1100, receivables: 245 });
  assert.ok(!ids(scan(h)).includes('receivables-outpacing-sales'), '22.5% vs 10% is within 15 pts');
});

test('debt outpacing revenue: total debt growth more than 20 pts above revenue growth', () => {
  const h = healthy();
  h[0] = year(2025, { revenue: 1050, totalDebt: 390 });
  const flag = scan(h).flags.find((f) => f.id === 'debt-outpacing-revenue');
  assert.deepEqual(flag, {
    id: 'debt-outpacing-revenue',
    severity: 'watch',
    text: 'Debt grew faster than revenue in FY25',
    evidence: 'Total debt +30.0% vs revenue +5.0% (FY24 → FY25)',
  });

  h[1] = year(2024, { totalDebt: 0 });
  assert.ok(!ids(scan(h)).includes('debt-outpacing-revenue'), 'no growth rate from zero debt');
});

test('high leverage: latest debt / equity above 1.5', () => {
  const h = healthy();
  h[0] = year(2025, { totalDebt: 1800 });
  assert.deepEqual(scan(h).flags.find((f) => f.id === 'high-leverage'), {
    id: 'high-leverage',
    severity: 'warning',
    text: 'High leverage',
    evidence: 'Debt / equity 1.80 (FY25)',
  });

  h[0] = year(2025, { totalDebt: 1500 });
  assert.ok(!ids(scan(h)).includes('high-leverage'), 'exactly 1.5 is not above');
  h[0] = year(2025, { totalDebt: 1800, totalEquity: -100 });
  assert.ok(!ids(scan(h)).includes('high-leverage'), 'negative equity has no meaningful ratio');
});

test('shrinking margins: net margin down in each of the last 3 years', () => {
  const h = healthy();
  h[0] = year(2025, { netIncome: 140, operatingCashFlow: 150 });
  h[1] = year(2024, { netIncome: 160, operatingCashFlow: 170 });
  h[2] = year(2023, { netIncome: 180, operatingCashFlow: 190 });
  h[3] = year(2022, { netIncome: 200, operatingCashFlow: 210 });
  assert.deepEqual(scan(h).flags.find((f) => f.id === 'shrinking-margins'), {
    id: 'shrinking-margins',
    severity: 'watch',
    text: 'Net margin shrank in each of the last 3 years',
    evidence: 'Net margin 20.0% → 18.0% → 16.0% → 14.0% (FY22 → FY25)',
  });

  h[2] = year(2023, { netIncome: 150, operatingCashFlow: 160 });
  assert.ok(!ids(scan(h)).includes('shrinking-margins'), 'FY24 margin rose');
});

test('negative free cash flow in each of the last 3 years', () => {
  const h = healthy();
  h[0] = year(2025, { capex: 125 });
  h[1] = year(2024, { capex: 140 });
  h[2] = year(2023, { capex: 130 });
  assert.deepEqual(scan(h).flags.find((f) => f.id === 'negative-free-cash-flow'), {
    id: 'negative-free-cash-flow',
    severity: 'warning',
    text: 'Negative free cash flow in each of the last 3 years',
    evidence: 'FCF (net income + non-cash − capex) -10, -20, -5 (FY23, FY24, FY25)',
  });

  h[2] = year(2023);
  assert.ok(!ids(scan(h)).includes('negative-free-cash-flow'));
});

test('multi-year rules need consecutive fiscal years', () => {
  const h = [year(2025, { capex: 125 }), year(2023, { capex: 140 }), year(2022, { capex: 130 })];
  assert.ok(!ids(scan(h)).includes('negative-free-cash-flow'));
});

test('missing metrics are skipped silently', () => {
  const h = healthy().map((y) => ({ ...y, operatingCashFlow: null, receivables: null, totalDebt: null }));
  const r = scan(h);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.skipped.filter((s) => !s.id.startsWith('promoter-')), []);
});

test('promoter stake falling: down more than 5 pts over 2 years', () => {
  const promoterHolding = [
    { date: '2023-06-30', percent: 55 },
    { date: '2024-06-30', percent: 52 },
    { date: '2025-06-30', percent: 48.5 },
  ];
  assert.deepEqual(scan(healthy(), { promoterHolding }).flags.find((f) => f.id === 'promoter-stake-falling'), {
    id: 'promoter-stake-falling',
    severity: 'watch',
    text: 'Promoter stake fell 6.5 pts over 2 years',
    evidence: 'Promoter holding 55.0% → 48.5% (2023-06-30 → 2025-06-30)',
  });

  promoterHolding[2].percent = 50;
  assert.ok(!ids(scan(healthy(), { promoterHolding })).includes('promoter-stake-falling'));
});

test('promoter pledging: more than 20% of promoter holding pledged', () => {
  assert.deepEqual(scan(healthy(), { promoterPledged: 25 }).flags.find((f) => f.id === 'promoter-pledging'), {
    id: 'promoter-pledging',
    severity: 'warning',
    text: 'High promoter pledging',
    evidence: 'Pledged 25.0% of promoter holding',
  });
  assert.ok(!ids(scan(healthy(), { promoterPledged: 20 })).includes('promoter-pledging'));
});

test('rules whose data the provider does not supply are listed as skipped with a reason', () => {
  const bare = healthy().map(({ year, revenue, netIncome, capex, nonCashExpense }) => ({ year, revenue, netIncome, capex, nonCashExpense }));
  const r = redFlagScan({ history: bare });
  const notProvided = 'not provided by data source';
  assert.deepEqual(r.skipped, [
    { id: 'profit-not-backed-by-cash', reason: notProvided },
    { id: 'cash-conversion-drop', reason: notProvided },
    { id: 'receivables-outpacing-sales', reason: notProvided },
    { id: 'debt-outpacing-revenue', reason: notProvided },
    { id: 'high-leverage', reason: notProvided },
    { id: 'promoter-stake-falling', reason: notProvided },
    { id: 'promoter-pledging', reason: notProvided },
  ]);
});

test('promoter history shorter than 2 years, or none reported, is skipped with a reason', () => {
  const short = [{ date: '2025-09-30', percent: 50 }, { date: '2026-06-30', percent: 40 }];
  assert.deepEqual(scan(healthy(), { promoterHolding: short }).skipped.find((s) => s.id === 'promoter-stake-falling'), {
    id: 'promoter-stake-falling',
    reason: 'data source provides less than 2 years of promoter holding',
  });
  assert.deepEqual(scan(healthy(), { promoterHolding: [] }).skipped.find((s) => s.id === 'promoter-stake-falling'), {
    id: 'promoter-stake-falling',
    reason: 'no promoter holding reported',
  });
});
