import { test } from 'node:test';
import assert from 'node:assert';
import { listReports, parseAnnualReportLinks, saveUpload } from './reports.js';

test('listReports lists years without downloading PDFs; uploads take precedence', async () => {
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('screener.in')) {
      return new Response(`<h3>Annual reports</h3><ul>
        <li><a href="https://b/a26.pdf">Annual Report 2026</a></li>
        <li><a href="https://b/a25.pdf">Annual Report 2025</a></li>
        <li><a href="https://b/a24.pdf">Annual Report 2024</a></li></ul>`);
    }
    return new Response('%PDF-1.7 fetched');
  }) as typeof fetch;
  saveUpload('LISTTEST', 2025, Buffer.from('%PDF-1.7 uploaded'));

  const refs = await listReports('LISTTEST', 3, fetcher);
  assert.deepStrictEqual(refs.map((r) => [r.year, r.source]), [[2026, 'screener'], [2025, 'upload'], [2024, 'screener']]);
  assert.strictEqual(requested.filter((u) => u.endsWith('.pdf')).length, 0);

  assert.strictEqual((await refs[1].load())!.toString(), '%PDF-1.7 uploaded');
  assert.strictEqual((await refs[0].load())!.toString(), '%PDF-1.7 fetched');
  assert.deepStrictEqual(requested.filter((u) => u.endsWith('.pdf')), ['https://b/a26.pdf']);
});

test('parseAnnualReportLinks reads years and urls from the Annual reports list only', () => {
  const html = `<h3>Concalls</h3><ul><li><a href="https://x/c.pdf">Transcript 2025</a></li></ul>
  <h3>Annual reports</h3><ul class="list-links">
  <li><a href="https://b/a26.pdf?x=1&amp;y=2" target="_blank">Annual Report 2026</a><span>from bse</span></li>
  <li><a href="https://b/a25.pdf">Financial Year 2025</a></li></ul><h3>Credit ratings</h3><ul><li><a href="https://z/2024.pdf">Rating 2024</a></li></ul>`;
  assert.deepStrictEqual(parseAnnualReportLinks(html), [
    { year: 2026, url: 'https://b/a26.pdf?x=1&y=2' },
    { year: 2025, url: 'https://b/a25.pdf' },
  ]);
  assert.deepStrictEqual(parseAnnualReportLinks('<html></html>'), []);
});
