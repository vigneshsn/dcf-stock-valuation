import { test } from 'node:test';
import assert from 'node:assert';
import { extractMdna, reportToText } from './mdna.js';
import { insightsInput } from './insights.js';
import { guidanceInput } from './guidance.js';
import { extractTenKSections, htmlToText } from './secSections.js';

const filler = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `We expect ${topic} revenue to grow in the coming year as our new products launch, number ${i}.`).join(' ');

const TEN_K = [
  'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
  'TABLE OF CONTENTS',
  'Item 1A. Risk Factors 5',
  'Item 1B. Unresolved Staff Comments 17',
  'Item 7. Management’s Discussion and Analysis of Financial Condition and Results of Operations 21',
  'Item 7A. Quantitative and Qualitative Disclosures About Market Risk 28',
  'Item 8. Financial Statements and Supplementary Data 29',
  'Item 1. Business',
  'The Company designs smartphones.',
  'Item 1A. Risk Factors',
  `Competition risk: ${filler('services', 25)}`,
  'Item 1B. Unresolved Staff Comments',
  'None.',
  'Item 7. Management’s Discussion and Analysis of Financial Condition and Results of Operations',
  `Our company outlook: ${filler('iPhone', 60)}`,
  'Item 7A. Quantitative and Qualitative Disclosures About Market Risk',
  'Interest rate risk text that must not be in MD&A.',
  'Item 8. Financial Statements and Supplementary Data',
  'Balance sheet.',
].join('\n');

test('US locator finds Item 7 and Item 1A, skipping table-of-contents entries', () => {
  const { mdna, risks } = extractTenKSections(TEN_K);
  assert.ok(mdna!.startsWith('Item 7. Management’s Discussion'));
  assert.match(mdna!, /Our company outlook/);
  assert.doesNotMatch(mdna!, /Interest rate risk text/);
  assert.ok(risks!.startsWith('Item 1A. Risk Factors'));
  assert.match(risks!, /Competition risk/);
  assert.doesNotMatch(risks!, /Unresolved Staff|Our company outlook/);
});

test('edition selects the locator', () => {
  assert.match(extractMdna(TEN_K, 'us')!, /Our company outlook/);
  assert.ok(extractMdna(TEN_K, 'india')!.startsWith('Management’s Discussion'), 'India heuristics start at the heading text, not the SEC item');
  assert.strictEqual(extractMdna('no sections here', 'us'), null);
});

test('US insights and guidance inputs carry the MD&A and the risk factors', () => {
  const insights = insightsInput(TEN_K, 20_000, 'us')!;
  assert.match(insights, /MANAGEMENT DISCUSSION AND ANALYSIS/);
  assert.match(insights, /OPPORTUNITIES, THREATS AND RISKS:\nItem 1A|OPPORTUNITIES, THREATS AND RISKS:\n.*Competition risk/s);
  assert.match(guidanceInput(TEN_K, 20_000, 'us')!, /We expect iPhone revenue/);
});

test('htmlToText turns an EDGAR HTML filing into lines, dropping hidden XBRL and decoding entities', () => {
  const html = `<html><head><style>p{}</style></head><body><div style="display:none"><ix:header>hidden facts</ix:header></div>
    <p><b>Item&#160;7.</b> Management&#8217;s Discussion &amp; Analysis</p><table><tr><td>Net sales</td><td>$&nbsp;391</td></tr></table><p>Next</p></body></html>`;
  const text = htmlToText(html);
  assert.ok(!text.includes('hidden facts'));
  assert.deepStrictEqual(text.split('\n').filter(Boolean), ['Item 7. Management’s Discussion & Analysis', 'Net sales $ 391', 'Next']);
});

test('reportToText reads HTML filings directly and leaves PDFs to the PDF parser', async () => {
  assert.match(await reportToText(Buffer.from('<html><body><p>Item 7. Hello</p></body></html>')), /^Item 7\. Hello/);
});
