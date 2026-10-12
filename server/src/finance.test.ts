import { test } from 'node:test';
import assert from 'node:assert';
import { calculateROCE, calculateROE } from './finance.js';

test('calculateROCE: normal case with known inputs', () => {
  // ebit=200, totalAssets=1000, totalCurrentLiabilities=200 -> capitalEmployed=800
  assert.strictEqual(calculateROCE(200, 1000, 200), 0.25);
});

test('calculateROCE: zero denominator (capital employed = 0)', () => {
  assert.strictEqual(calculateROCE(200, 500, 500), null);
});

test('calculateROCE: negative denominator', () => {
  assert.strictEqual(calculateROCE(200, 300, 500), null);
});

test('calculateROCE: missing/undefined inputs', () => {
  assert.strictEqual(calculateROCE(undefined, 1000, 200), null);
  assert.strictEqual(calculateROCE(200, null, 200), null);
  assert.strictEqual(calculateROCE(200, 1000, undefined), null);
});

test('calculateROE: normal case with known inputs', () => {
  // netIncome=100, totalStockholderEquity=500 -> 0.2
  assert.strictEqual(calculateROE(100, 500), 0.2);
});

test('calculateROE: zero denominator (equity = 0)', () => {
  assert.strictEqual(calculateROE(100, 0), null);
});

test('calculateROE: negative denominator', () => {
  assert.strictEqual(calculateROE(100, -500), null);
});

test('calculateROE: missing/undefined inputs', () => {
  assert.strictEqual(calculateROE(undefined, 500), null);
  assert.strictEqual(calculateROE(null, 500), null);
  assert.strictEqual(calculateROE(100, undefined), null);
});
