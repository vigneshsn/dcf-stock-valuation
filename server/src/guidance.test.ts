import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YearFinancials } from './dcf.js';
import { LlmError } from './llm.js';
import { AnnualReportRef } from './reports.js';
import {
  GuidanceClaim,
  GuidanceExtractor,
  collectGuidance,
  forgetStoredGuidance,
  guidanceInput,
  guidanceScorecard,
  parseGuidanceClaims,
  scoreClaim,
} from './guidance.js';

const text = [
  'Management Discussion and Analysis',
  ...Array.from({ length: 30 }, (_, i) => `We expect revenue growth of 15% in FY24 and our outlook ${i} remains strong.`),
  'Directors Report',
  'Board matters.',
].join('\n');

const claim = (over: Partial<GuidanceClaim> = {}): GuidanceClaim => ({
  metric: 'revenueGrowth',
  target: { min: 0.15, max: 0.15 },
  horizon: 2024,
  quote: 'We expect revenue growth of 15% in FY24',
  ...over,
});

const row = (year: number, revenue: number, netIncome: number, extra: Partial<YearFinancials> = {}): YearFinancials => ({
  year,
  revenue,
  netIncome,
  capex: revenue * 0.05,
  nonCashExpense: 0,
  ...extra,
});

test('guidanceInput: MD&A only, nothing when there is no MD&A', () => {
  const input = guidanceInput(text)!;
  assert.match(input, /revenue growth of 15% in FY24/);
  assert.doesNotMatch(input, /Board matters/);
  assert.equal(guidanceInput('No discussion here.'), null);
});

test('parseGuidanceClaims: percent to fraction, unverifiable quotes dropped, vague claims unscored', () => {
  const claims = parseGuidanceClaims(
    [
      { metric: 'revenueGrowth', target: { min: 12, max: 15 }, horizon: 2024, quote: 'We expect revenue growth of 15% in FY24' },
      { metric: 'margin', target: 20, horizon: '2025', quote: 'our outlook 1 remains strong' },
      { metric: 'debt', target: { min: 0.5, max: 0.5 }, horizon: 2025, quote: 'our outlook 2 remains strong' },
      { metric: 'revenueGrowth', target: 99, horizon: 2024, quote: 'a sentence the report never contained' },
      { metric: 'whatever', target: 5, horizon: null, quote: 'our outlook 3 remains strong' },
      { metric: 'capex', target: 'n/a', horizon: 1800, quote: 'our outlook 4 remains strong' },
    ],
    text
  );
  assert.deepEqual(claims, [
    { metric: 'revenueGrowth', target: { min: 0.12, max: 0.15 }, horizon: 2024, quote: 'We expect revenue growth of 15% in FY24' },
    { metric: 'margin', target: { min: 0.2, max: 0.2 }, horizon: 2025, quote: 'our outlook 1 remains strong' },
    { metric: 'debt', target: { min: 0.5, max: 0.5 }, horizon: 2025, quote: 'our outlook 2 remains strong' },
    { metric: 'other', target: null, horizon: null, quote: 'our outlook 3 remains strong' },
    { metric: 'capex', target: null, horizon: null, quote: 'our outlook 4 remains strong' },
  ]);
  assert.deepEqual(parseGuidanceClaims('nope', text), []);
});

test('scoreClaim: met, near, missed against the horizon year; ranges and ceilings', () => {
  const history = [row(2023, 1000, 100), row(2024, 1000 * 1.2, 100 * 1.14)];
  assert.equal(scoreClaim(claim({ target: { min: 0.15, max: 0.15 } }), history).verdict, 'met');
  assert.equal(scoreClaim(claim({ target: { min: 0.21, max: 0.21 } }), history).verdict, 'near');
  assert.equal(scoreClaim(claim({ target: { min: 0.21, max: 0.25 } }), history).verdict, 'missed');
  assert.equal(scoreClaim(claim({ target: { min: 0.3, max: 0.3 } }), history).verdict, 'missed');
  // inside or above a range is met
  assert.equal(scoreClaim(claim({ target: { min: 0.1, max: 0.3 } }), history).verdict, 'met');
  assert.equal(scoreClaim(claim({ metric: 'netProfitGrowth', target: { min: 0.15, max: 0.15 } }), history).verdict, 'near');
  assert.equal(scoreClaim(claim({ metric: 'margin', target: { min: 0.09, max: 0.09 } }), history).actual?.toFixed(4), '0.0950');

  // capex and debt are ceilings
  const withDebt = [row(2024, 1000, 100, { totalDebt: 300, totalEquity: 1000 })];
  assert.equal(scoreClaim(claim({ metric: 'capex', target: { min: 0.06, max: 0.06 } }), withDebt).verdict, 'met');
  assert.equal(scoreClaim(claim({ metric: 'capex', target: { min: 0.04, max: 0.04 } }), withDebt).verdict, 'missed');
  assert.equal(scoreClaim(claim({ metric: 'debt', target: { min: 0.3, max: 0.3 } }), withDebt).verdict, 'met');
  assert.equal(scoreClaim(claim({ metric: 'debt', target: { min: 0.2, max: 0.2 } }), withDebt).verdict, 'missed');
});

test('scoreClaim: pending without horizon-year financials, unscored when vague or not computable', () => {
  const history = [row(2023, 1000, 100)];
  assert.deepEqual(scoreClaim(claim(), history), { ...claim(), actual: null, verdict: 'pending' });
  assert.equal(scoreClaim(claim({ metric: 'other', target: null }), history).verdict, 'unscored');
  assert.equal(scoreClaim(claim({ horizon: null }), history).verdict, 'unscored');
  // horizon year present but no prior year to compute growth, or no debt data
  assert.equal(scoreClaim(claim({ horizon: 2023 }), history).verdict, 'unscored');
  assert.equal(scoreClaim(claim({ metric: 'debt', horizon: 2023 }), history).verdict, 'unscored');
});

test('guidanceScorecard: hit rate over scored claims and the lower-confidence flag', () => {
  const history = [row(2023, 1000, 100), row(2024, 1200, 120)];
  const year = (y: number, status: 'ok' | 'no-report', claims: GuidanceClaim[]) => ({ year: y, status, cached: true, claims });
  const claims = [claim(), claim({ target: { min: 0.5, max: 0.5 } }), claim({ metric: 'other', target: null }), claim({ horizon: 2030 })];
  const full = guidanceScorecard([year(2023, 'ok', claims), year(2022, 'ok', []), year(2021, 'ok', [])], history);
  assert.equal(full.hitRate, 0.5);
  assert.equal(full.lowerConfidence, false);
  assert.deepEqual(full.years[0].claims.map((c) => c.verdict), ['met', 'missed', 'unscored', 'pending']);

  const partial = guidanceScorecard([year(2023, 'ok', [claim({ metric: 'other', target: null })]), year(2022, 'no-report', [])], history);
  assert.equal(partial.hitRate, null);
  assert.equal(partial.lowerConfidence, true);
});

test('collectGuidance: one extraction per report ever, shared latest-year claims, degraded years', async () => {
  process.env.GUIDANCE_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'guidance-'));
  const loads: number[] = [];
  const ref = (year: number, source: AnnualReportRef['source'] = 'screener', ok = true): AnnualReportRef => ({
    year,
    source,
    load: async () => (loads.push(year), ok ? Buffer.from(`report ${year}`) : null),
  });
  const extracted: number[] = [];
  const extract: GuidanceExtractor = async (year) => (extracted.push(year), year === 2022 ? [] : [claim({ horizon: year + 1 })]);
  const deps = {
    listReports: async () => [ref(2024), ref(2023), ref(2022)],
    textOf: async () => text,
    extract,
    sharedClaims: async (year: number) => (year === 2024 ? [claim({ horizon: 2025 })] : undefined),
  };

  const first = await collectGuidance('ABC', 'm', 3, deps);
  assert.deepEqual(first.map((y) => [y.year, y.status, y.cached]), [[2024, 'ok', true], [2023, 'ok', false], [2022, 'no-guidance', false]]);
  assert.deepEqual(extracted.sort(), [2022, 2023]);
  assert.ok(!loads.includes(2024));

  const second = await collectGuidance('ABC', 'm', 3, deps);
  assert.ok(second.slice(1).every((y) => y.cached));
  assert.deepEqual(extracted.length, 2);

  // listing unavailable: stored years still answer
  const offline = await collectGuidance('ABC', 'm', 3, { ...deps, listReports: async () => { throw new Error('down'); } });
  assert.deepEqual(offline.map((y) => y.year), [2023, 2022]);

  // an upload supersedes claims from a fetched report; forgetting drops them
  await collectGuidance('ABC', 'm', 3, { ...deps, listReports: async () => [ref(2023, 'upload')] });
  assert.deepEqual(extracted.sort(), [2022, 2023, 2023]);
  await forgetStoredGuidance('ABC', 2023);
  assert.deepEqual((await collectGuidance('ABC', 'm', 3, { ...deps, listReports: async () => [] })).map((y) => y.year), [2022]);

  const noReport = await collectGuidance('NOPE', 'm', 3, { ...deps, listReports: async () => [ref(2023, 'screener', false)] });
  assert.equal(noReport[0].status, 'no-report');
  const noMdna = await collectGuidance('NOMDNA', 'm', 3, { ...deps, listReports: async () => [ref(2023)], textOf: async () => 'nothing' });
  assert.equal(noMdna[0].status, 'no-guidance');
});

test('collectGuidance: LLM failure yields llm-unavailable and is not stored', async () => {
  process.env.GUIDANCE_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'guidance-'));
  let fail = true;
  const deps = {
    listReports: async () => [{ year: 2023, source: 'screener' as const, load: async () => Buffer.from('pdf') }],
    textOf: async () => text,
    extract: (async () => {
      if (fail) throw new LlmError('quota');
      return [claim()];
    }) as GuidanceExtractor,
  };
  assert.equal((await collectGuidance('FLK', 'm', 3, deps))[0].status, 'llm-unavailable');
  fail = false;
  const retry = await collectGuidance('FLK', 'm', 3, deps);
  assert.deepEqual([retry[0].status, retry[0].cached], ['ok', false]);
  fail = true;
  const failed = await collectGuidance('BAD', 'm', 3, { ...deps, extract: async () => { throw new Error('boom'); } });
  assert.equal(failed[0].status, 'failed');
});
