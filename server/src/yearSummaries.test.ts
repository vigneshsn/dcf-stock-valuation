import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnnualReportRef } from './reports.js';
import { MdnaSummary } from './mdna.js';
import { collectYearSummaries, forgetStoredYear, storedYears } from './yearSummaries.js';

const MODEL = 'qwen3:8b';

beforeEach(() => {
  process.env.MDNA_CACHE_DIR = mkdtempSync(path.join(tmpdir(), 'mdna-cache-'));
});

function harness(years: number[], opts: { noMdna?: number[]; source?: AnnualReportRef['source'] } = {}) {
  const loads: number[] = [];
  const summarised: number[] = [];
  const refs = (): AnnualReportRef[] =>
    years.map((year) => ({
      year,
      source: opts.source ?? 'screener',
      load: async () => {
        loads.push(year);
        return Buffer.from(`pdf-${year}`);
      },
    }));
  const deps = {
    listReports: async () => refs(),
    summarise: async (pdf: Buffer): Promise<MdnaSummary | null> => {
      const year = Number(pdf.toString().slice(4));
      summarised.push(year);
      await new Promise((r) => setTimeout(r, 5));
      return opts.noMdna?.includes(year) ? null : { chunkCount: 3, summary: `summary ${year}`, excerpt: `excerpt ${year}` };
    },
  };
  return { deps, loads, summarised };
}

test('summarises years newest first and serves repeats from disk without downloading', async () => {
  const first = harness([2024, 2026, 2025]);
  const r1 = await collectYearSummaries('ACME', MODEL, 3, first.deps);
  assert.deepStrictEqual(r1.summaries.map((s) => s.year), [2026, 2025, 2024]);
  assert.strictEqual(r1.summaries[0].summary, 'summary 2026');
  assert.strictEqual(r1.reportCount, 3);
  assert.deepStrictEqual(first.loads.sort(), [2024, 2025, 2026]);

  const second = harness([2024, 2026, 2025]);
  const r2 = await collectYearSummaries('ACME', MODEL, 3, second.deps);
  assert.deepStrictEqual(r2, r1);
  assert.deepStrictEqual(second.loads, []);
  assert.deepStrictEqual(second.summarised, []);
});

test('stored summaries are per model', async () => {
  await collectYearSummaries('ACME', MODEL, 3, harness([2026]).deps);
  const other = harness([2026]);
  await collectYearSummaries('ACME', 'llama3.1:8b', 3, other.deps);
  assert.deepStrictEqual(other.summarised, [2026]);
});

test('reports without MD&A are remembered as skipped years', async () => {
  const first = harness([2026, 2025], { noMdna: [2025] });
  const r1 = await collectYearSummaries('ACME', MODEL, 3, first.deps);
  assert.deepStrictEqual(r1.skippedYears, [2025]);
  assert.deepStrictEqual(r1.summaries.map((s) => s.year), [2026]);

  const second = harness([2026, 2025]);
  const r2 = await collectYearSummaries('ACME', MODEL, 3, second.deps);
  assert.deepStrictEqual(r2.skippedYears, [2025]);
  assert.deepStrictEqual(second.loads, []);
});

test('failed downloads are not counted or stored', async () => {
  const deps = {
    listReports: async (): Promise<AnnualReportRef[]> => [{ year: 2026, source: 'screener', load: async () => null }],
    summarise: async () => assert.fail('should not summarise'),
  };
  const r = await collectYearSummaries('ACME', MODEL, 3, deps);
  assert.strictEqual(r.reportCount, 0);
  assert.deepStrictEqual(await storedYears('ACME', MODEL), []);
});

test('stored years are used when the report listing is unavailable', async () => {
  await collectYearSummaries('ACME', MODEL, 3, harness([2026, 2025]).deps);
  const offline = harness([]);
  const r = await collectYearSummaries('ACME', MODEL, 3, offline.deps);
  assert.deepStrictEqual(r.summaries.map((s) => s.year), [2026, 2025]);
});

test('an upload replaces a summary derived from a fetched report', async () => {
  await collectYearSummaries('ACME', MODEL, 3, harness([2026]).deps);
  const uploaded = harness([2026], { source: 'upload' });
  await collectYearSummaries('ACME', MODEL, 3, uploaded.deps);
  assert.deepStrictEqual(uploaded.summarised, [2026]);

  await forgetStoredYear('ACME', 2026);
  assert.deepStrictEqual(await storedYears('ACME', MODEL), []);
});

test('concurrent requests for the same year share one computation', async () => {
  const h = harness([2026]);
  await Promise.all([collectYearSummaries('ACME', MODEL, 3, h.deps), collectYearSummaries('ACME', MODEL, 3, h.deps)]);
  assert.deepStrictEqual(h.summarised, [2026]);
});
