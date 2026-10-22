import { test } from 'node:test';
import assert from 'node:assert';
import { parseAnnualReportLinks } from './reports.js';

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
