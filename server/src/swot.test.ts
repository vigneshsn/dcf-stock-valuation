import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ReportSwotJudge,
  extractSwotSections,
  financialSwot,
  forgetStoredSwot,
  isHeading,
  latestReportSwot,
  mergeSwot,
  swotFromReportText,
  verifiedItems,
} from './swot.js';
import { AnnualReportRef } from './reports.js';

const year = (y: number, revenue: number, netIncome: number, capex = 0, nonCashExpense = 0) => ({ year: y, revenue, netIncome, capex, nonCashExpense });

test('financialSwot: flags strengths and weaknesses from the latest fiscal year', () => {
  const strong = financialSwot({
    roe: 0.22,
    roce: 0.19,
    debtToEquity: 0.1,
    history: [year(2024, 1000, 100), year(2025, 1200, 140)],
  });
  assert.equal(strong.year, 2025);
  // Net margin moved 10.0% → 11.7% (< 2 pts), so it produces no item.
  assert.deepEqual(strong.strengths.map((s) => s.evidence), [
    'Revenue growth YoY: 20.0%',
    'Net profit growth YoY: 40.0%',
    'ROE: 22.0%',
    'ROCE: 19.0%',
    'Debt / equity: 0.10',
  ]);
  assert.deepEqual(strong.weaknesses, []);
  assert.ok(strong.strengths.every((s) => s.source === 'financials'));

  const weak = financialSwot({
    roe: 0.05,
    roce: null,
    debtToEquity: 1.5,
    history: [year(2025, 900, 50, 200, 20), year(2024, 1000, 100)],
  });
  assert.deepEqual(weak.weaknesses.map((w) => w.text), [
    'Revenue declined 10.0% in FY2025',
    'Net profit fell 50.0% in FY2025',
    'Net margin contracted in FY2025',
    'Low ROE of 5.0%',
    'Negative free cash flow in FY2025',
    'High leverage',
  ]);
  assert.deepEqual(weak.strengths, []);
});

test('financialSwot: neutral band, missing metrics and non-consecutive years produce nothing', () => {
  const r = financialSwot({ roe: 0.12, history: [year(2025, 1100, 110), year(2022, 500, 10)] });
  assert.deepEqual(r, { year: 2025, strengths: [], weaknesses: [] });
  assert.deepEqual(financialSwot({ roe: null, history: [] }), { year: null, strengths: [], weaknesses: [] });
});

test('isHeading: matches heading lines but not wrapped body text', () => {
  const ot = /opportunities\s+(?:and|&)\s+(?:threats|challenges)/;
  assert.ok(isHeading('Opportunities and Threats', ot));
  assert.ok(isHeading('3.2 OPPORTUNITIES & CHALLENGES:', ot));
  assert.ok(isHeading('Opportunities and Threats for the Indian IT Industry', ot));
  assert.ok(!isHeading('opportunities and threats in the market remain balanced as', ot));
  assert.ok(!isHeading('see Opportunities and Threats', ot));
  assert.ok(!isHeading('Opportunities and Threats 14', ot));
  assert.ok(isHeading('Opportunities and threats for our business', ot, 'The market grew.'));
  assert.ok(!isHeading('Opportunities and threats for our business', ot, 'are discussed below.'));
});

test('extractSwotSections: recognises integrated-report risk headings', () => {
  const text = ['Critical risks and mitigation strategies', 'Counterfeit products pose a serious threat to brand equity.', filler('risk')].join('\n');
  assert.match(extractSwotSections(text).risks!, /^Critical risks/);
  assert.match(extractSwotSections(text.replace('Critical risks and mitigation strategies', 'Risks and Opportunities')).opportunitiesAndThreats!, /^Risks and Opportunities/);
});

const filler = (topic: string) => Array.from({ length: 12 }, (_, i) => `The company sees ${topic} number ${i} in its markets this year.`).join('\n');

const report = [
  'Contents',
  'Management Discussion and Analysis 12',
  'Opportunities and Threats 14',
  'Directors Report 30',
  'Management Discussion and Analysis',
  'Our market share in premium segment rose to a record level this year.',
  filler('competitive strength'),
  'Opportunities and Threats',
  'Rising rural demand offers a large growth runway for our products.',
  filler('opportunity'),
  'Outlook',
  'We expect steady growth next year.',
  filler('outlook item'),
  'Risks and Concerns',
  'Volatile raw material prices could compress margins significantly.',
  filler('risk'),
  'Internal Control Systems',
  filler('control item'),
  'Directors Report',
  'Board matters.',
].join('\n');

test('extractSwotSections: finds the body sections, not table-of-contents hits', () => {
  const s = extractSwotSections(report);
  assert.match(s.opportunitiesAndThreats!, /^Opportunities and Threats\nRising rural demand/);
  assert.doesNotMatch(s.opportunitiesAndThreats!, /We expect steady growth/);
  assert.match(s.risks!, /^Risks and Concerns\nVolatile raw material/);
  assert.doesNotMatch(s.risks!, /control item/);
});

test('verifiedItems: keeps ranked items with verbatim quotes, dedupes and caps', () => {
  const source = 'Rising rural demand offers a large growth runway for our products.';
  const items = verifiedItems(
    [
      { point: 'Rural demand', quote: 'rural demand offers a large growth runway' },
      { point: 'Invented', quote: 'this sentence is not in the report' },
      { point: 'rural demand', quote: 'large growth runway for our products' },
      { point: '', quote: 'large growth runway for our products' },
      ...Array.from({ length: 6 }, (_, i) => ({ point: `P${i}`, quote: 'growth runway for our products' })),
    ],
    source
  );
  assert.deepEqual(items.map((i) => i.text), ['Rural demand', 'P0', 'P1', 'P2', 'P3']);
  assert.equal(items[0].source, 'report');
  assert.deepEqual(verifiedItems('nope', source), []);
});

const echoJudge = (): ReportSwotJudge & { seen: { sw?: string; ot?: string } } => {
  const seen: { sw?: string; ot?: string } = {};
  return {
    seen,
    strengthsWeaknesses: async (_y, text) => ((seen.sw = text), { strengths: [{ text: 'S', source: 'report', evidence: 'q' }], weaknesses: [] }),
    opportunitiesThreats: async (_y, text) => ((seen.ot = text), { opportunities: [], threats: [{ text: 'T', source: 'report', evidence: 'q' }] }),
  };
};

test('swotFromReportText: uses dedicated O/T sections when present', async () => {
  const judge = echoJudge();
  const r = await swotFromReportText(2025, report, judge);
  assert.equal(r.found, true);
  assert.match(judge.seen.ot!, /Rising rural demand/);
  assert.match(judge.seen.ot!, /Volatile raw material/);
  assert.equal(r.swot.opportunities.lowerConfidence, false);
  assert.equal(r.swot.threats.lowerConfidence, false);
  assert.equal(r.swot.strengths.items[0].text, 'S');
});

test('swotFromReportText: falls back to MD&A passages and flags O/T lower-confidence', async () => {
  const judge = echoJudge();
  const noSections = report.replace(/^Opportunities and Threats$/m, 'Our Business').replace(/^Risks and Concerns$/m, 'Our People');
  const r = await swotFromReportText(2025, noSections, judge);
  assert.equal(r.found, true);
  assert.ok(judge.seen.ot && judge.seen.ot.length > 0);
  assert.equal(r.swot.opportunities.lowerConfidence, true);
  assert.equal(r.swot.threats.lowerConfidence, true);
  assert.equal(r.swot.strengths.lowerConfidence, false);

  const none = await swotFromReportText(2025, 'An annual report with no discussion at all.', judge);
  assert.equal(none.found, false);
});

test('latestReportSwot: analyses the newest report once and reuses the stored result', async () => {
  process.env.SWOT_CACHE_DIR = await mkdtemp(path.join(tmpdir(), 'swot-'));
  let loads = 0;
  const ref = (y: number, source: AnnualReportRef['source'] = 'screener'): AnnualReportRef => ({
    year: y,
    source,
    load: async () => (loads++, Buffer.from(`report ${y}`)),
  });
  const deps = { listReports: async () => [ref(2024), ref(2025)], textOf: async () => report, judge: echoJudge() };

  const first = await latestReportSwot('ABC', 'm', deps);
  assert.equal(first.entry?.year, 2025);
  assert.equal(first.cached, false);
  const second = await latestReportSwot('ABC', 'm', deps);
  assert.equal(second.cached, true);
  assert.equal(loads, 1);

  // An uploaded report supersedes a stored result from a fetched one.
  const uploaded = await latestReportSwot('ABC', 'm', { ...deps, listReports: async () => [ref(2025, 'upload')] });
  assert.equal(uploaded.entry?.source, 'upload');
  assert.equal(loads, 2);

  // Listing unavailable: the stored year still answers.
  const offline = await latestReportSwot('ABC', 'm', { ...deps, listReports: async () => [] });
  assert.equal(offline.entry?.year, 2025);

  await forgetStoredSwot('ABC', 2025);
  assert.deepEqual(await latestReportSwot('ABC', 'm', { ...deps, listReports: async () => [] }), { entry: null, cached: false });
});

test('mergeSwot: report items first, financials S/W appended', () => {
  const fin = financialSwot({ roe: 0.3, history: [year(2025, 100, 10)] });
  const merged = mergeSwot(null, fin);
  assert.deepEqual(merged.strengths.items.map((i) => i.source), ['financials']);
  assert.deepEqual(merged.opportunities, { items: [], lowerConfidence: false });
});
