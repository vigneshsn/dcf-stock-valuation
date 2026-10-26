import { test } from 'node:test';
import assert from 'node:assert';
import { computeFairValue, computeScenarios, deriveDefaults, quantitativeScore, YearFinancials } from './dcf.js';

const history: YearFinancials[] = [
  { year: 2024, revenue: 1210, netIncome: 121, capex: 20, nonCashExpense: 30 },
  { year: 2023, revenue: 1100, netIncome: 110, capex: 20, nonCashExpense: 30 },
  { year: 2022, revenue: 1000, netIncome: 100, capex: 20, nonCashExpense: 30 },
];

test('score bands and boundaries', () => {
  assert.strictEqual(quantitativeScore(100, 60).score, 5);
  assert.strictEqual(quantitativeScore(100, 70).score, 4); // exactly 30% below
  assert.strictEqual(quantitativeScore(100, 75).score, 4);
  assert.strictEqual(quantitativeScore(100, 90).score, 3); // exactly 10% below
  assert.strictEqual(quantitativeScore(100, 100).score, 3);
  assert.strictEqual(quantitativeScore(100, 110).score, 3);
  assert.strictEqual(quantitativeScore(100, 120).score, 2);
  assert.strictEqual(quantitativeScore(100, 130).score, 2);
  assert.strictEqual(quantitativeScore(100, 131).score, 1);
});

test('score explanation mentions values', () => {
  const { explanation } = quantitativeScore(100, 60);
  assert.match(explanation, /60/);
  assert.match(explanation, /5\/5/);
});

test('score rejects non-positive input', () => {
  assert.throws(() => quantitativeScore(0, 10));
});

test('deriveDefaults: CAGR growth and bounded rates', () => {
  const d = deriveDefaults(history)!;
  assert.strictEqual(d.growthRate, 10);
  assert.ok(d.discountRate >= 11 && d.discountRate <= 15);
  assert.ok(d.terminalGrowthRate < d.discountRate);
});

test('deriveDefaults: insufficient history', () => {
  assert.strictEqual(deriveDefaults(history.slice(0, 1)), null);
});

test('computeFairValue: matches hand calculation with zero growth', () => {
  // margin 10%, capex 20, nonCash 30 -> fcf = 121 + 10 = 131... revenue 1210 flat
  const fv = computeFairValue(history, { growthRate: 0, discountRate: 10, terminalGrowthRate: 0 }, 10)!;
  const fcf = 1210 * 0.1 - 20 + 30;
  let total = 0;
  for (let t = 1; t <= 5; t++) total += fcf / Math.pow(1.1, t);
  total += (fcf / 0.1) / Math.pow(1.1, 5);
  assert.ok(Math.abs(fv - total / 10) < 0.01);
});

test('computeFairValue: higher discount rate lowers value; invalid inputs return null', () => {
  const a = computeFairValue(history, { growthRate: 8, discountRate: 10, terminalGrowthRate: 4 }, 10)!;
  const b = computeFairValue(history, { growthRate: 8, discountRate: 14, terminalGrowthRate: 4 }, 10)!;
  assert.ok(a > b);
  assert.strictEqual(computeFairValue(history, { growthRate: 8, discountRate: 4, terminalGrowthRate: 4 }, 10), null);
  assert.strictEqual(computeFairValue(history, { growthRate: 8, discountRate: 10, terminalGrowthRate: 4 }, 0), null);
});

test('computeScenarios: bear and bull shift growth by 5 pts and discount by 1 pt around the base', () => {
  const base = { growthRate: 5, discountRate: 10, terminalGrowthRate: 0 };
  const s = computeScenarios(history, base, 10, 100)!;
  assert.deepStrictEqual(s.base, { ...base, fairValuePerShare: computeFairValue(history, base, 10) });
  // Zero growth and terminal growth make every year's FCF 131, so value = 131 / 11% / 10 shares
  assert.deepStrictEqual(s.bear, { growthRate: 0, discountRate: 11, terminalGrowthRate: 0, fairValuePerShare: 119.09 });
  assert.strictEqual(s.bull.growthRate, 10);
  assert.strictEqual(s.bull.discountRate, 9);
  assert.ok(s.bull.fairValuePerShare! > s.base.fairValuePerShare!);
});

test('computeScenarios: grid spans growth ±4 pts in 2-pt steps and discount ±2 pts in 1-pt steps', () => {
  const { grid } = computeScenarios(history, { growthRate: 4, discountRate: 10, terminalGrowthRate: 0 }, 10, 100)!;
  assert.deepStrictEqual(grid.growth, [0, 2, 4, 6, 8]);
  assert.deepStrictEqual(grid.discount, [8, 9, 10, 11, 12]);
  // values[growth][discount]; zero growth at 10% discount is the 131-per-year perpetuity
  assert.strictEqual(grid.values[0][2], 131);
  assert.strictEqual(grid.values[0][3], 119.09);
});

test('computeScenarios: grid cells where discount ≤ terminal growth are null', () => {
  const { grid } = computeScenarios(history, { growthRate: 4, discountRate: 4, terminalGrowthRate: 3 }, 10, 100)!;
  assert.deepStrictEqual(grid.discount, [2, 3, 4, 5, 6]);
  assert.strictEqual(grid.values[2][0], null);
  assert.strictEqual(grid.values[2][1], null);
  assert.ok(grid.values[2][2]! > 0);
});

test('computeScenarios: impliedGrowth is the growth at which Fair value equals the price', () => {
  // At 0% growth and 10% discount the Fair value is exactly 131
  const s = computeScenarios(history, { growthRate: 8, discountRate: 10, terminalGrowthRate: 0 }, 10, 131)!;
  assert.strictEqual(s.impliedGrowth, 0);
});

test('computeScenarios: impliedGrowth is null when no growth in [-20%, 50%] justifies the price', () => {
  const s = computeScenarios(history, { growthRate: 8, discountRate: 10, terminalGrowthRate: 0 }, 10, 1_000_000)!;
  assert.strictEqual(s.impliedGrowth, null);
});

test('computeScenarios: not applicable when the latest year is loss-making or has negative free cash flow', () => {
  const base = { growthRate: 5, discountRate: 10, terminalGrowthRate: 0 };
  const lossYear = [{ ...history[0], netIncome: -10, nonCashExpense: 40 }, ...history.slice(1)];
  // 121 + 30 − 200 < 0
  const negativeFcf = [{ ...history[0], capex: 200 }, ...history.slice(1)];
  assert.strictEqual(computeScenarios(lossYear, base, 10, 100), null);
  assert.strictEqual(computeScenarios(negativeFcf, base, 10, 100), null);
});
