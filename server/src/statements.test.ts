import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YearFinancials } from './dcf.js';
import { financialStatements } from './statements.js';

const year = (y: number, extra: Partial<YearFinancials> = {}): YearFinancials => ({
  year: y,
  revenue: 1000,
  netIncome: 100,
  capex: 50,
  nonCashExpense: 20,
  ...extra,
});

test('lists the latest 5 fiscal years oldest first, without duplicates', () => {
  const history = [2026, 2025, 2025, 2024, 2023, 2022, 2021].map((y) => year(y));
  assert.deepEqual(financialStatements(history).map((s) => s.year), [2022, 2023, 2024, 2025, 2026]);
});

test('derives margins, leverage, free cash flow and cash conversion', () => {
  const [s] = financialStatements([year(2026, {
    ebitda: 180,
    totalAssets: 2000,
    totalDebt: 300,
    totalEquity: 600,
    operatingCashFlow: 120,
  })]);
  assert.deepEqual(s, {
    year: 2026,
    revenue: 1000,
    ebitda: 180,
    netProfit: 100,
    netMargin: 10,
    totalAssets: 2000,
    borrowings: 300,
    equity: 600,
    debtToEquity: 0.5,
    operatingCashFlow: 120,
    capex: 50,
    freeCashFlow: 70,
    cashConversion: 120,
  });
});

test('leaves metrics null when inputs are missing or ratios are meaningless', () => {
  const [s] = financialStatements([year(2026, { netIncome: -10, totalDebt: 300, totalEquity: -5, operatingCashFlow: null })]);
  assert.equal(s.ebitda, null);
  assert.equal(s.totalAssets, null);
  assert.equal(s.debtToEquity, null);
  assert.equal(s.operatingCashFlow, null);
  assert.equal(s.freeCashFlow, null);
  assert.equal(s.cashConversion, null);
});

test('leaves capex and free cash flow unknown when the year reports no capex', () => {
  const [s] = financialStatements([year(2026, { capex: 0, reportedCapex: null, operatingCashFlow: 120 })]);
  assert.equal(s.capex, null);
  assert.equal(s.freeCashFlow, null);
});

test('scales amounts to crores but not ratios', () => {
  const [s] = financialStatements([year(2026, {
    revenue: 2e10,
    netIncome: 2e9,
    capex: 1e9,
    totalDebt: 1e9,
    totalEquity: 4e9,
    operatingCashFlow: 3e9,
  })], 1e7);
  assert.equal(s.revenue, 2000);
  assert.equal(s.netProfit, 200);
  assert.equal(s.capex, 100);
  assert.equal(s.freeCashFlow, 200);
  assert.equal(s.netMargin, 10);
  assert.equal(s.debtToEquity, 0.25);
  assert.equal(s.cashConversion, 150);
});
