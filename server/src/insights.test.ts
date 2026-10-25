import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Insights,
  InsightsJudge,
  MAX_INSIGHT_ITEMS,
  forgetStoredInsights,
  insightsFromReportText,
  insightsInput,
  judgeInsights,
  latestReportInsights,
} from './insights.js';
import { AnnualReportRef } from './reports.js';

const filler = (topic: string) => Array.from({ length: 12 }, (_, i) => `We expect ${topic} number ${i} to lift our revenue growth next year.`).join('\n');

const report = [
  'Contents',
  'Management Discussion and Analysis 12',
  'Directors Report 30',
  'Management Discussion and Analysis',
  'Our market share in the premium segment rose to a record level and revenue grew 18% this year.',
  filler('capacity expansion'),
  'Opportunities and Threats',
  'Rising rural demand offers a large growth runway for our products.',
  filler('new product launch'),
  'Risks and Concerns',
  'Volatile raw material prices could compress margins significantly.',
  filler('pricing action'),
  'Directors Report',
  'Board matters.',
].join('\n');

const emptyInsights = (): Insights => ({
  keyPoints: [],
  growthStrategy: [],
  tailwinds: [],
  headwinds: [],
  risks: [],
  moat: { rating: 'none', reasoning: '', quote: null },
});

test('insightsInput: combines MD&A passages with the risk and opportunity sections within the budget', () => {
  const input = insightsInput(report)!;
  assert.match(input, /^MANAGEMENT DISCUSSION AND ANALYSIS \(excerpts\):\n/);
  assert.match(input, /market share in the premium segment/);
  assert.match(input, /OPPORTUNITIES, THREATS AND RISKS:\nOpportunities and Threats\nRising rural demand/);
  assert.match(input, /Volatile raw material prices/);

  const long = report.replace('Board matters.', '') + '\n' + filler('x').repeat(200);
  assert.ok(insightsInput(`Management Discussion and Analysis\n${filler('capacity').repeat(100)}`, 5000)!.length < 5200);
  assert.ok(insightsInput(long)!.length < 21_000);
  assert.equal(insightsInput('An annual report with no discussion at all.'), null);
});

test('judgeInsights: one LLM call, verified quotes only, capped and de-duplicated lists, normalised moat', async () => {
  const saved = { providers: process.env.LLM_PROVIDERS };
  const realFetch = globalThis.fetch;
  process.env.LLM_PROVIDERS = 'ollama';
  let calls = 0;
  const text = insightsInput(report)!;
  const answer = {
    keyPoints: [
      { point: 'Premium share at a record', quote: 'Our market share in the premium segment rose to a record level' },
      { point: 'Invented fact', quote: 'this sentence is not in the report at all' },
      { point: 'premium share at a record', quote: 'revenue grew 18% this year' },
    ],
    growthStrategy: Array.from({ length: 6 }, (_, i) => ({ point: `Lever ${i}`, quote: 'Rising rural demand offers a large growth runway' })),
    tailwinds: ['Rural demand'],
    headwinds: 'not a list',
    risks: [{ point: 'Raw material volatility', quote: 'Volatile raw material prices could compress margins significantly' }],
    moat: { rating: 'Narrow', reasoning: ' Premium brand. ', quote: 'market share in the premium segment rose' },
  };
  globalThis.fetch = (async () => (calls++, new Response(JSON.stringify({ response: JSON.stringify(answer) })))) as typeof fetch;
  try {
    const r = await judgeInsights(2025, text);
    assert.equal(calls, 1);
    assert.deepEqual(r.keyPoints, [
      { point: 'Premium share at a record', quote: 'Our market share in the premium segment rose to a record level' },
      { point: 'Invented fact', quote: null },
    ]);
    assert.equal(r.growthStrategy.length, MAX_INSIGHT_ITEMS);
    assert.deepEqual(r.tailwinds, [{ point: 'Rural demand', quote: null }]);
    assert.deepEqual(r.headwinds, []);
    assert.equal(r.risks[0].quote, 'Volatile raw material prices could compress margins significantly');
    assert.deepEqual(r.moat, { rating: 'narrow', reasoning: 'Premium brand.', quote: 'market share in the premium segment rose' });
  } finally {
    globalThis.fetch = realFetch;
    if (saved.providers === undefined) delete process.env.LLM_PROVIDERS;
    else process.env.LLM_PROVIDERS = saved.providers;
  }
});

test('insightsFromReportText: skips the LLM when the report has no usable sections', async () => {
  let judged = 0;
  const judge: InsightsJudge = async () => (judged++, emptyInsights());
  assert.deepEqual(await insightsFromReportText(2025, 'Nothing useful here.', judge), { found: false, insights: null });
  assert.equal(judged, 0);
  assert.equal((await insightsFromReportText(2025, report, judge)).found, true);
  assert.equal(judged, 1);
});

test('latestReportInsights: analyses only the newest report once and reuses the stored result', async () => {
  process.env.INSIGHTS_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'insights-'));
  let loads = 0;
  let judged = 0;
  const requested: number[] = [];
  const ref = (y: number, source: AnnualReportRef['source'] = 'screener'): AnnualReportRef => ({
    year: y,
    source,
    load: async () => (loads++, Buffer.from(`report ${y}`)),
  });
  const deps = {
    listReports: async (_t: string, n: number) => (requested.push(n), [ref(2025)]),
    textOf: async () => report,
    judge: (async () => (judged++, emptyInsights())) as InsightsJudge,
  };

  const [first, concurrent] = await Promise.all([latestReportInsights('ABC', 'm', deps), latestReportInsights('ABC', 'm', deps)]);
  assert.equal(first.entry?.year, 2025);
  assert.equal(first.cached, false);
  assert.equal(concurrent.entry?.year, 2025);
  assert.deepEqual(requested, [1, 1]);
  assert.equal(judged, 1);

  const second = await latestReportInsights('ABC', 'm', deps);
  assert.equal(second.cached, true);
  assert.equal(loads, 1);

  // An uploaded report supersedes a stored result from a fetched one.
  const uploaded = await latestReportInsights('ABC', 'm', { ...deps, listReports: async () => [ref(2025, 'upload')] });
  assert.equal(uploaded.entry?.source, 'upload');
  assert.equal(judged, 2);

  // Listing unavailable: the stored year still answers.
  const offline = await latestReportInsights('ABC', 'm', { ...deps, listReports: async () => [] });
  assert.equal(offline.entry?.year, 2025);
  assert.equal(offline.cached, true);

  await forgetStoredInsights('ABC', 2025);
  assert.deepEqual(await latestReportInsights('ABC', 'm', { ...deps, listReports: async () => [] }), { entry: null, cached: false });
});

test('latestReportInsights: an LLM failure is not stored', async () => {
  process.env.INSIGHTS_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'insights-'));
  let attempt = 0;
  const deps = {
    listReports: async () => [{ year: 2025, source: 'screener' as const, load: async () => Buffer.from('pdf') }],
    textOf: async () => report,
    judge: (async () => {
      if (attempt++ === 0) throw new Error('quota');
      return emptyInsights();
    }) as InsightsJudge,
  };
  await assert.rejects(latestReportInsights('XYZ', 'm', deps), /quota/);
  const retry = await latestReportInsights('XYZ', 'm', deps);
  assert.equal(retry.cached, false);
  assert.equal(retry.entry?.found, true);
});
