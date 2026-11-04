import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmpFiscalYear } from './fmp.js';
import { financialStatements } from './statements.js';
import { scoreClaim } from './guidance.js';

test('fmpFiscalYear uses the company fiscal-year label over calendar year and date', () => {
  // AAPL: year ends late September; MSFT: year ends 30 June.
  assert.equal(fmpFiscalYear({ date: '2025-09-27', fiscalYear: '2025', calendarYear: '2025' }), 2025);
  assert.equal(fmpFiscalYear({ date: '2025-06-30', fiscalYear: '2025', calendarYear: '2025' }), 2025);
  // A January year end is labelled with the earlier fiscal year.
  assert.equal(fmpFiscalYear({ date: '2025-01-31', fiscalYear: '2024', calendarYear: '2025' }), 2024);
  assert.equal(fmpFiscalYear({ date: '2024-12-31', calendarYear: '2024' }), 2024);
  assert.equal(fmpFiscalYear({ date: '2023-09-30' }), 2023);
  assert.equal(fmpFiscalYear({}), null);
  assert.equal(fmpFiscalYear({ fiscalYear: 'abc' }), null);
});

test('a FY2025 Guidance horizon lines up with the history row labelled FY2025', () => {
  const history = [
    { fiscalYear: '2025', date: '2025-09-27', revenue: 440e9, netIncome: 110e9 },
    { fiscalYear: '2024', date: '2024-09-28', revenue: 400e9, netIncome: 90e9 },
  ].map((row) => ({ year: fmpFiscalYear(row)!, revenue: row.revenue, netIncome: row.netIncome, capex: 0, nonCashExpense: 0 }));

  assert.deepEqual(financialStatements(history, 1e6).map((s) => s.year), [2024, 2025]);
  const scored = scoreClaim(
    { metric: 'revenueGrowth', target: { min: 0.1, max: 0.1 }, horizon: 2025, quote: 'q' },
    history
  );
  assert.equal(scored.verdict, 'met');
  assert.ok(Math.abs(scored.actual! - 0.1) < 1e-9);
});
