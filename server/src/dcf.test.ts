import { test } from 'node:test';
import assert from 'node:assert';
import { computeFairValue, deriveDefaults, quantitativeScore, YearFinancials } from './dcf.js';

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
