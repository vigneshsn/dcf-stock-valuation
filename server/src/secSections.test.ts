import { test } from 'node:test';
import assert from 'node:assert';
import { extractMdna, reportToText } from './mdna.js';
import { INDIA_REPORTS, US_REPORTS } from './reportProfiles.js';
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
  `The Company designs smartphones. ${filler('hardware', 25)}`,
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

test('the edition profile selects the locator', () => {
  assert.match(US_REPORTS.locate(TEN_K).mdna!, /Our company outlook/);
  assert.ok(INDIA_REPORTS.locate(TEN_K).mdna!.startsWith('Management’s Discussion'), 'India heuristics start at the heading text, not the SEC item');
  assert.strictEqual(US_REPORTS.locate('no sections here').mdna, null);
  assert.strictEqual(extractMdna('no sections here'), null);
});

test('US insights and guidance inputs carry the business, MD&A and risk factors', () => {
  const insights = insightsInput(TEN_K, 20_000, US_REPORTS)!;
  assert.match(insights, /BUSINESS AND COMPETITION[^]*The Company designs smartphones/);
  assert.match(insights, /MANAGEMENT DISCUSSION AND ANALYSIS/);
  assert.match(insights, /OPPORTUNITIES, THREATS AND RISKS:\nItem 1A/);
  assert.match(guidanceInput(TEN_K, 20_000, US_REPORTS)!, /We expect iPhone revenue/);
});

test('US locator copes with item numbers and titles on separate lines and ignores body cross-references', () => {
  const split = [
    'Item 1A.', 'Risk Factors', filler('risk', 25), 'Item 1B.', 'Unresolved Staff Comments', 'None.',
    'Item 7.', 'Management’s Discussion and Analysis of Financial Condition and Results of Operations', filler('growth', 30),
    'Item 7A.', 'Quantitative and Qualitative Disclosures About Market Risk', 'x',
  ].join('\n');
  const { mdna, risks } = extractTenKSections(split);
  assert.match(mdna!, /expect growth revenue/);
  assert.doesNotMatch(mdna!, /Quantitative and Qualitative/);
  assert.match(risks!, /expect risk revenue/);
  assert.doesNotMatch(risks!, /Unresolved Staff/);

  const crossRef = `Item 1A. Risk Factors\n${filler('risk', 25)}\nItem 7. Management’s Discussion and Analysis is discussed in ${'a very long sentence '.repeat(15)} below.\n${filler('late', 40)}\nItem 1B. Unresolved Staff Comments\nNone.`;
  assert.strictEqual(extractTenKSections(crossRef).mdna, null, 'a long body line that starts with Item 7 is not a heading');
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
